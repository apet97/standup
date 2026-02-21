import type { SlashCommandContext, ViewActionContext } from '../app-types';
import { createLogger } from '../logger';
import { getDB } from '../db';
import { requireName } from './util';
import { getStateValue } from '../state-utils';
import { validateQuestions, validateBlockerIndex } from '../validation';

const log = createLogger('questions');

// Store standup ID for modal submissions
const questionsModalState = new Map<string, number>();

export async function handleQuestions(ctx: SlashCommandContext, args: string): Promise<void> {
  const db = getDB();
  const name = requireName(args);
  if (!name) {
    await ctx.say('Please specify a standup name. Usage: `/standup questions <name>`', 'ephemeral');
    return;
  }

  const standup = db.getStandupByName(ctx.payload.workspaceId, name);
  if (!standup) {
    await ctx.say(`Standup "${name}" not found.`, 'ephemeral');
    return;
  }

  const questions = db.getQuestions(standup.id);
  const questionsText = questions.map((q) => q.text).join('\n');
  const blockerIndices = questions
    .filter((q) => q.is_blocker)
    .map((q) => q.sort_order + 1)
    .join(', ');

  // Store state for the modal
  const key = `${ctx.payload.workspaceId}:${ctx.payload.userId}`;
  questionsModalState.set(key, standup.id);

  await ctx.spawnModalView({
    callbackId: 'standup_edit_questions',
    type: 'MODAL',
    title: { type: 'plain_text', text: `Edit: ${standup.name}` },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    notifyOnClose: false,
    blocks: [
      {
        type: 'input',
        blockId: 'questions_block',
        label: { type: 'plain_text', text: 'Questions (one per line)' },
        element: {
          type: 'plain_text_input',
          onAction: 'questions_input',
          line_mode: 'multiline',
          initial_value: questionsText,
        },
      },
      {
        type: 'input',
        blockId: 'blocker_block',
        label: { type: 'plain_text', text: 'Blocker question number(s) (comma-separated)' },
        element: {
          type: 'plain_text_input',
          onAction: 'blocker_input',
          initial_value: blockerIndices,
          placeholder: { type: 'plain_text', text: 'e.g. 3' },
        },
        optional: true,
      },
    ],
  });
}

export async function onEditQuestionsSubmit(ctx: ViewActionContext): Promise<void> {
  await ctx.ack();

  const questionsRaw = getStateValue(ctx.payload.view.state, 'questions_block', 'questions_input');
  const blockerRaw = getStateValue(ctx.payload.view.state, 'blocker_block', 'blocker_input');

  if (!questionsRaw) return;

  const key = `${ctx.payload.workspaceId}:${ctx.payload.userId}`;
  const standupId = questionsModalState.get(key);
  if (!standupId) return;
  questionsModalState.delete(key);

  const questions = questionsRaw.split('\n').map((q: string) => q.trim()).filter(Boolean);

  // Validate questions (length, count, control characters)
  const qValidation = validateQuestions(questions);
  if (!qValidation.valid) {
    log.warn({ standupId, error: qValidation.error }, 'Question edit validation failed');
    return;
  }

  const blockerNums = new Set(
    (blockerRaw || '').split(',').map((n) => parseInt(n.trim(), 10) - 1).filter((n) => !isNaN(n))
  );

  // Validate blocker indices against question count
  for (const idx of blockerNums) {
    const bValidation = validateBlockerIndex(idx, questions.length);
    if (!bValidation.valid) {
      blockerNums.delete(idx);
    }
  }

  const db = getDB();
  db.replaceQuestions(
    standupId,
    questions.map((text, i) => ({
      text: text.slice(0, 500),
      sort_order: i,
      is_blocker: blockerNums.has(i) ? 1 : 0,
    }))
  );

  const botClient = await ctx.getBotClient();
  if (botClient && ctx.payload.channelId) {
    await botClient.v1.messages.postEphemeral(
      ctx.payload.channelId,
      `Questions updated (${questions.length} questions).`,
      ctx.payload.userId
    );
  }
}
