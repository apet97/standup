import type { V1 } from '../app-types';
import type { Standup, Question, Response, BlockerEntry } from '../types';
import { createLogger } from '../logger';
import { getDB } from '../db';
import { removeActiveRun } from './runner';
import { getAddonInstance } from '../addon-instance';
import { withRetry } from '../retry';

const log = createLogger('summary');

export async function checkAndPostSummary(
  runId: number,
  standupId: number,
  forceCutoff = false
): Promise<void> {
  const db = getDB();
  const standup = db.getStandupById(standupId);
  if (!standup) return;

  const participants = db.getParticipants(standup.id);
  const responded = db.getRespondedUserIds(runId);
  const allResponded = participants.every((uid) => responded.includes(uid));

  if (!allResponded && !forceCutoff) return;

  // Post summary
  const questions = db.getQuestions(standup.id);
  const responses = db.getResponses(runId);
  const blockers = db.getBlockers(runId);

  const blocks = buildSummaryBlocks(standup, questions, responses, participants, blockers);

  const addon = getAddonInstance();
  if (!addon) {
    log.error('Addon instance not available');
    return;
  }

  const botClient = await addon.getBotClient(standup.workspace_id);
  if (!botClient) {
    log.error({ workspaceId: standup.workspace_id }, 'Bot client not available');
    return;
  }

  try {
    const msg = await withRetry(
      () => botClient.v1.messages.postMessageToChannel(standup.channel_id, {
        text: `Standup summary: ${standup.name}`,
        blocks,
      }),
      { context: { runId, channelId: standup.channel_id, op: 'postSummary' } }
    );

    // Mark run complete
    db.completeRun(runId, msg.id, standup.channel_id);
    log.info({ runId, channelId: standup.channel_id }, 'Posted summary');
  } catch (error) {
    log.error({ err: error, runId }, 'Failed to post summary');
    // Still mark complete to prevent repeated attempts
    db.completeRun(runId, '', standup.channel_id);
  }

  // Clean up active run tracking
  removeActiveRun(runId);
}

export function buildSummaryBlocks(
  standup: Standup,
  questions: Question[],
  responses: Response[],
  participantIds: string[],
  blockers: BlockerEntry[]
): V1.MainBlock[] {
  const blocks: V1.MainBlock[] = [];
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Header
  blocks.push({
    type: 'rich_text',
    elements: [
      {
        type: 'rich_text_section',
        elements: [
          { type: 'emoji', name: 'clipboard' },
          {
            type: 'text',
            text: ` ${standup.name} — ${today}`,
            style: { bold: true },
          },
        ],
      },
    ],
  });

  // Respondents
  const respondedIds = new Set(responses.map((r) => r.user_id));
  const actualResponses = responses.filter((r) => !r.is_skipped);
  const skippedResponses = responses.filter((r) => r.is_skipped);

  for (const resp of actualResponses) {
    let answers: string[];
    try {
      answers = JSON.parse(resp.answers);
    } catch {
      answers = [];
    }

    const answerElements: (V1.BlockRichTextSection | V1.BlockRichTextQuote)[] = [];

    // User header
    const headerEls: V1.BlockBasic[] = [
      { type: 'text' as const, text: '\n' },
      { type: 'emoji' as const, name: 'white_check_mark' },
      { type: 'text' as const, text: ' ' },
      { type: 'user' as const, user_id: resp.user_id },
    ];
    if (resp.is_late) {
      headerEls.push({ type: 'text' as const, text: ' (late response)', style: { italic: true } });
    }
    if (resp.streak > 1) {
      headerEls.push({ type: 'text' as const, text: ` — ${resp.streak} day streak`, style: { italic: true } });
    }
    answerElements.push({
      type: 'rich_text_section',
      elements: headerEls,
    });

    // Each answer
    for (let i = 0; i < questions.length; i++) {
      const questionLabel = questions[i]!.text.replace(/\?$/, '');
      const answerText = answers[i] || '(no answer)';
      answerElements.push({
        type: 'rich_text_section',
        elements: [
          { type: 'text', text: `  ${questionLabel}: `, style: { bold: true } },
          { type: 'text', text: answerText },
        ],
      });
    }

    blocks.push({
      type: 'rich_text',
      elements: answerElements,
    });
  }

  // Skipped users
  if (skippedResponses.length > 0) {
    blocks.push({
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_section',
          elements: [
            { type: 'text', text: '\n' },
            { type: 'emoji', name: 'fast_forward' },
            { type: 'text', text: ' Skipped: ' },
            ...skippedResponses.flatMap((r, i) => {
              const els: V1.BlockBasic[] = [{ type: 'user', user_id: r.user_id }];
              if (i < skippedResponses.length - 1) {
                els.push({ type: 'text', text: ', ' });
              }
              return els;
            }),
          ],
        },
      ],
    });
  }

  // Non-responders
  const missingIds = participantIds.filter((uid) => !respondedIds.has(uid));
  if (missingIds.length > 0) {
    blocks.push({
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_section',
          elements: [
            { type: 'text', text: '\n' },
            { type: 'emoji', name: 'hourglass_flowing_sand' },
            { type: 'text', text: ' Did not respond: ' },
            ...missingIds.flatMap((uid, i) => {
              const els: V1.BlockBasic[] = [{ type: 'user', user_id: uid }];
              if (i < missingIds.length - 1) {
                els.push({ type: 'text', text: ', ' });
              }
              return els;
            }),
          ],
        },
      ],
    });
  }

  // Blockers section
  if (blockers.length > 0) {
    const blockerElements: V1.BlockBasic[] = [
      { type: 'text', text: '\n' },
      { type: 'emoji', name: 'construction' },
      { type: 'text', text: ' Blockers:\n', style: { bold: true } },
    ];

    for (const b of blockers) {
      blockerElements.push(
        { type: 'text', text: '  • ' },
        { type: 'user', user_id: b.user_id },
        { type: 'text', text: `: ${b.blocker_text}`, style: { bold: true } },
        { type: 'text', text: '\n' }
      );
    }

    blocks.push({
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_section',
          elements: blockerElements,
        },
      ],
    });
  }

  return blocks;
}
