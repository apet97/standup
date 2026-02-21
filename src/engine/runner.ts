import { getDB } from '../db';
import { createLogger } from '../logger';
import type { ApiClient } from '../app-types';
import type { V1 } from '../app-types';
import type { Standup, Question, PendingPrompt, ActiveRun } from '../types';
import { scheduleReminder, scheduleCutoff, clearRunTimers } from './reminder';
import { checkAndPostSummary } from './summary';
import { withRetry } from '../retry';
import { incCounter, observeHistogram } from '../metrics';

const log = createLogger('runner');

// Global pending prompts map: key = `${workspaceId}:${userId}`
const pendingPrompts = new Map<string, PendingPrompt>();

// Active runs map: key = runId
const activeRuns = new Map<number, ActiveRun>();

// Snooze timers: key = `${workspaceId}:${userId}`
const snoozeTimers = new Map<string, NodeJS.Timeout>();

export function getPendingPrompt(workspaceId: string, userId: string): PendingPrompt | undefined {
  return pendingPrompts.get(`${workspaceId}:${userId}`);
}

export function removePendingPrompt(workspaceId: string, userId: string): void {
  pendingPrompts.delete(`${workspaceId}:${userId}`);
}

export function getActiveRun(runId: number): ActiveRun | undefined {
  return activeRuns.get(runId);
}

export function removeActiveRun(runId: number): void {
  const run = activeRuns.get(runId);
  if (run) {
    clearRunTimers(run);
    activeRuns.delete(runId);
  }
}

export function getAllActiveRuns(): Map<number, ActiveRun> {
  return activeRuns;
}

export function shutdownActiveRuns(): void {
  const db = getDB();
  for (const [runId, run] of activeRuns) {
    clearRunTimers(run);
    try {
      db.markRunInterrupted(runId);
      log.info({ runId, standupId: run.standupId }, 'Marked run as INTERRUPTED on shutdown');
    } catch (error) {
      log.error({ err: error, runId }, 'Failed to mark run as INTERRUPTED');
    }
  }
  activeRuns.clear();

  // Clear all snooze timers
  for (const [, timer] of snoozeTimers) {
    clearTimeout(timer);
  }
  snoozeTimers.clear();

  // Clear pending prompts
  pendingPrompts.clear();
  log.info('All active runs shut down');
}

export async function triggerStandupRun(
  standup: Standup,
  botClient: ApiClient,
  triggeredBy: 'schedule' | 'manual'
): Promise<void> {
  const db = getDB();

  // Idempotency: check for existing COLLECTING run
  const existingRun = db.getCollectingRunForStandup(standup.id);
  if (existingRun) {
    log.warn({ standupId: standup.id, existingRunId: existingRun.id }, 'Run already in progress, skipping');
    return;
  }

  const participants = db.getParticipants(standup.id);
  if (participants.length === 0) {
    log.info({ standupName: standup.name }, 'Standup has no participants, skipping run');
    return;
  }

  const questions = db.getQuestions(standup.id);
  if (questions.length === 0) {
    log.info({ standupName: standup.name }, 'Standup has no questions, skipping run');
    return;
  }

  // Create the run record
  const runId = db.createRun(standup.id, triggeredBy);
  incCounter('standup_runs_total', { status: 'COLLECTING' });
  log.info({ runId, standupName: standup.name, triggeredBy }, 'Created run');

  // Register active run
  const activeRun: ActiveRun = {
    runId,
    standupId: standup.id,
    standup,
    questions,
    participants: [...participants],
  };
  activeRuns.set(runId, activeRun);

  // Send DM prompts to each participant
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  for (const userId of participants) {
    try {
      const blocks = buildPromptBlocks(standup.name, today, questions);
      const dmStart = Date.now();
      const dmChannel = await withRetry(
        () => botClient.v1.channels.getDirectChannel([userId]),
        { context: { userId, runId, op: 'getDirectChannel' } }
      );
      const channelId = dmChannel.channel.id;

      const msg = await withRetry(
        () => botClient.v1.messages.postMessageToChannel(channelId, {
          text: `Standup: ${standup.name} — Please answer your standup questions`,
          blocks,
        }),
        { context: { userId, runId, channelId, op: 'sendPrompt' } }
      );
      observeHistogram('standup_dm_send_duration_seconds', (Date.now() - dmStart) / 1000);

      // Track pending prompt
      const key = `${standup.workspace_id}:${userId}`;
      pendingPrompts.set(key, {
        runId,
        standupId: standup.id,
        userId,
        channelId,
        messageId: msg.id,
        sentAt: new Date(),
        questions,
        workspaceId: standup.workspace_id,
      });

      log.debug({ userId, channelId, runId }, 'Sent prompt to user');
    } catch (error) {
      log.error({ err: error, userId, runId }, 'Failed to DM user');
    }
  }

  // Schedule reminder and cutoff
  activeRun.reminderTimer = scheduleReminder(
    botClient,
    standup,
    runId,
    standup.reminder_mins * 60 * 1000
  );

  activeRun.cutoffTimer = scheduleCutoff(
    botClient,
    standup,
    runId,
    standup.cutoff_mins * 60 * 1000
  );
}

function buildPromptBlocks(standupName: string, dateStr: string, questions: Question[]): V1.MainBlock[] {
  const questionElements: V1.BlockBasic[] = [];

  questionElements.push({
    type: 'text',
    text: `\n\nPlease answer the following:\n\n`,
  });

  for (const q of questions) {
    questionElements.push({
      type: 'text',
      text: `${q.sort_order + 1}. ${q.text}\n`,
      style: { bold: true },
    });
  }

  questionElements.push({
    type: 'text',
    text: `\nReply with your answers (one per line, matching the numbers).\nType "skip" to skip today, or "snooze N" to delay by N minutes.`,
    style: { italic: true },
  });

  return [
    {
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_section',
          elements: [
            {
              type: 'emoji',
              name: 'clipboard',
            },
            {
              type: 'text',
              text: ` ${standupName} — ${dateStr}`,
              style: { bold: true },
            },
            ...questionElements,
          ],
        },
      ],
    },
  ];
}

export function parseNumberedResponse(text: string, questionCount: number): string[] {
  const lines = text.split('\n').filter((l) => l.trim());
  const answers: string[] = [];

  for (const line of lines) {
    const cleaned = line.replace(/^\d+[\.\)]\s*/, '').trim();
    if (cleaned) answers.push(cleaned);
  }

  // Pad with empty if fewer answers than questions
  while (answers.length < questionCount) answers.push('');
  return answers.slice(0, questionCount);
}

export async function handleSnooze(
  botClient: ApiClient,
  prompt: PendingPrompt,
  minutes: number
): Promise<void> {
  // Remove current pending
  removePendingPrompt(prompt.workspaceId, prompt.userId);

  // Send acknowledgment
  try {
    await withRetry(
      () => botClient.v1.messages.postMessageToChannel(prompt.channelId, {
        text: `Got it! I'll remind you again in ${minutes} minutes.`,
      }),
      { context: { userId: prompt.userId, op: 'snoozeAck' } }
    );
  } catch (error) {
    log.error({ err: error, userId: prompt.userId }, 'Failed to send snooze ack');
  }

  // Re-send prompt after delay — track the timer
  const snoozeKey = `${prompt.workspaceId}:${prompt.userId}`;
  const timer = setTimeout(async () => {
    snoozeTimers.delete(snoozeKey);
    try {
      const db = getDB();
      const run = db.getRun(prompt.runId);
      if (!run || run.status !== 'COLLECTING') return;

      const questions = db.getQuestions(prompt.standupId);
      const standup = db.getStandupById(prompt.standupId);
      if (!standup) return;

      const today = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      const blocks = buildPromptBlocks(standup.name, today, questions);
      const msg = await withRetry(
        () => botClient.v1.messages.postMessageToChannel(prompt.channelId, {
          text: `Reminder: ${standup.name} standup`,
          blocks,
        }),
        { context: { userId: prompt.userId, op: 'snoozeResend' } }
      );

      // Re-register pending prompt
      const key = `${prompt.workspaceId}:${prompt.userId}`;
      pendingPrompts.set(key, {
        ...prompt,
        messageId: msg.id,
        sentAt: new Date(),
      });
    } catch (error) {
      log.error({ err: error, userId: prompt.userId }, 'Failed to re-send prompt after snooze');
    }
  }, minutes * 60 * 1000);

  snoozeTimers.set(snoozeKey, timer);
}

// Reload pending prompts from DB on startup (for crash recovery)
export function reloadPendingFromDB(): void {
  const db = getDB();
  const collectingRuns = db.getCollectingRuns();

  for (const run of collectingRuns) {
    const standup = db.getStandupById(run.standup_id);
    if (!standup) continue;

    const questions = db.getQuestions(standup.id);
    const participants = db.getParticipants(standup.id);
    const responded = new Set(db.getRespondedUserIds(run.id));
    const pending = participants.filter((uid) => !responded.has(uid));

    if (pending.length === 0) {
      continue;
    }

    const activeRun: ActiveRun = {
      runId: run.id,
      standupId: standup.id,
      standup,
      questions,
      participants,
    };
    activeRuns.set(run.id, activeRun);

    // Reschedule cutoff timer based on elapsed time since trigger
    const triggeredAt = new Date(run.triggered_at).getTime();
    const elapsed = Date.now() - triggeredAt;
    const cutoffMs = standup.cutoff_mins * 60 * 1000;
    const remainingCutoff = Math.max(0, cutoffMs - elapsed);

    if (remainingCutoff === 0) {
      // Cutoff already passed — post summary immediately
      log.info({ runId: run.id, standupName: standup.name }, 'Cutoff passed during downtime, posting summary');
      void checkAndPostSummary(run.id, standup.id, true);
    } else {
      log.info(
        { runId: run.id, standupName: standup.name, pending: pending.length, remainingCutoffMins: Math.ceil(remainingCutoff / 60000) },
        'Reloaded active run'
      );
    }
  }
}

// Find an active run for a given workspace + user who has not yet responded
export function findPendingRunForUser(workspaceId: string, userId: string): {
  runId: number;
  standup: Standup;
  questions: Question[];
} | undefined {
  for (const [, run] of activeRuns) {
    if (run.standup.workspace_id !== workspaceId) continue;
    if (!run.participants.includes(userId)) continue;

    const db = getDB();
    const responded = db.getRespondedUserIds(run.runId);
    if (responded.includes(userId)) continue;

    return {
      runId: run.runId,
      standup: run.standup,
      questions: run.questions,
    };
  }
  return undefined;
}
