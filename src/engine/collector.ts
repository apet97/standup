import type { OnMessageContext } from '../app-types';
import { createLogger } from '../logger';
import { getDB } from '../db';
import {
  getPendingPrompt,
  removePendingPrompt,
  parseNumberedResponse,
  handleSnooze,
  findPendingRunForUser,
} from './runner';
import { checkAndPostSummary } from './summary';
import { withRetry } from '../retry';

const log = createLogger('collector');

export async function handleNewMessage(ctx: OnMessageContext): Promise<void> {
  const { body, workspaceId } = ctx.payload;

  const botUserId = await ctx.getBotUserId();
  if (!botUserId) return;

  // Ignore bot's own messages
  if (body.aId === botUserId) return;

  // Ignore non-DM channels (ephemeral, etc.)
  if (body.eph) return;

  const userId = body.aId;
  const channelId = body.cId;
  const messageText = body.tx || '';
  const messageId = body.mId;

  // First check explicit pending prompt tracking
  let prompt = getPendingPrompt(workspaceId, userId);

  // If no exact pending prompt, check active runs for this user
  if (!prompt) {
    const runInfo = findPendingRunForUser(workspaceId, userId);
    if (!runInfo) return; // Not a response to any standup

    // Create a synthetic prompt for this user
    prompt = {
      runId: runInfo.runId,
      standupId: runInfo.standup.id,
      userId,
      channelId,
      messageId: '',
      sentAt: new Date(),
      questions: runInfo.questions,
      workspaceId,
    };
  }

  // Verify it's the right DM channel (if we have it tracked).
  // After crash recovery, prompt.channelId may be empty — allow any channel in that case.
  if (prompt.channelId && prompt.channelId !== channelId) return;

  const textLower = messageText.trim().toLowerCase();

  // Handle "skip"
  if (textLower === 'skip') {
    await handleSkip(ctx, prompt, messageId);
    return;
  }

  // Handle "snooze N"
  const snoozeMatch = textLower.match(/^snooze\s+(\d+)$/);
  if (snoozeMatch) {
    const minutes = parseInt(snoozeMatch[1]!, 10);
    if (minutes >= 1 && minutes <= 120) {
      const botClient = await ctx.getBotClient();
      if (botClient) {
        await handleSnooze(botClient, prompt, minutes);
      }
      return;
    }
  }

  // Parse the response
  const answers = parseNumberedResponse(messageText, prompt.questions.length);

  // Store the response
  const db = getDB();
  const run = db.getRun(prompt.runId);
  const isLate = run?.status === 'COMPLETE';

  const streak = db.getUserStreak(prompt.standupId, userId) + 1;
  db.storeResponse(prompt.runId, userId, answers, false, isLate, streak);

  // Remove from pending
  removePendingPrompt(workspaceId, userId);

  // React with checkmark
  const botClient = await ctx.getBotClient();
  if (botClient) {
    try {
      await withRetry(
        () => botClient.v1.messages.addReaction(messageId, { code: ':white_check_mark:' }),
        { context: { messageId, op: 'addReaction' } }
      );
    } catch (error) {
      log.error({ err: error, messageId }, 'Failed to add reaction');
    }

    // If late response, update the summary
    if (isLate && run?.summary_msg_id && run.summary_channel_id) {
      try {
        const { buildSummaryBlocks } = await import('./summary');
        const standup = db.getStandupById(prompt.standupId);
        if (standup) {
          const questions = db.getQuestions(standup.id);
          const responses = db.getResponses(prompt.runId);
          const participants = db.getParticipants(standup.id);
          const blockers = db.getBlockers(prompt.runId);
          const blocks = buildSummaryBlocks(standup, questions, responses, participants, blockers);
          const summaryMsgId = run.summary_msg_id;
          const summaryChannelId = run.summary_channel_id;
          await withRetry(
            () => botClient.v1.messages.editMessage(summaryMsgId, summaryChannelId, {
              text: `Standup summary: ${standup.name} (updated)`,
              blocks,
            }),
            { context: { runId: prompt.runId, op: 'editSummary' } }
          );
        }
      } catch (error) {
        log.error({ err: error, runId: prompt.runId }, 'Failed to update summary with late response');
      }
    }
  }

  log.info({ userId, runId: prompt.runId, streak, isLate }, 'Stored response');

  // Check if all participants have responded
  if (!isLate) {
    await checkAndPostSummary(prompt.runId, prompt.standupId);
  }
}

async function handleSkip(
  ctx: OnMessageContext,
  prompt: { runId: number; standupId: number; userId: string; workspaceId: string },
  messageId: string
): Promise<void> {
  const db = getDB();
  db.storeResponse(prompt.runId, prompt.userId, [], true, false, 0);
  removePendingPrompt(prompt.workspaceId, prompt.userId);

  const botClient = await ctx.getBotClient();
  if (botClient) {
    try {
      await withRetry(
        () => botClient.v1.messages.addReaction(messageId, { code: ':fast_forward:' }),
        { context: { messageId, op: 'addSkipReaction' } }
      );
    } catch (error) {
      log.error({ err: error, messageId }, 'Failed to add skip reaction');
    }
  }

  log.info({ userId: prompt.userId, runId: prompt.runId }, 'User skipped standup');

  await checkAndPostSummary(prompt.runId, prompt.standupId);
}
