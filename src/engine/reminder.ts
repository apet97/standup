import type { ApiClient } from '../app-types';
import type { Standup, ActiveRun } from '../types';
import { createLogger } from '../logger';
import { getDB } from '../db';
import { getPendingPrompt } from './runner';
import { checkAndPostSummary } from './summary';
import { withRetry } from '../retry';

const log = createLogger('reminder');

export function scheduleReminder(
  botClient: ApiClient,
  standup: Standup,
  runId: number,
  delayMs: number
): NodeJS.Timeout {
  return setTimeout(async () => {
    try {
      const db = getDB();
      const run = db.getRun(runId);
      if (!run || run.status !== 'COLLECTING') return;

      const participants = db.getParticipants(standup.id);
      const responded = new Set(db.getRespondedUserIds(runId));
      const pending = participants.filter((uid) => !responded.has(uid));

      if (pending.length === 0) return;

      log.info({ runId, pending: pending.length }, 'Sending reminders');

      for (const userId of pending) {
        try {
          const prompt = getPendingPrompt(standup.workspace_id, userId);
          if (!prompt) continue;

          await withRetry(
            () => botClient.v1.messages.postMessageToChannel(prompt.channelId, {
              text: `Reminder: You have an unanswered standup prompt for **${standup.name}**. Please reply above when ready, or type "skip" to skip today.`,
            }),
            { context: { userId, runId, op: 'sendReminder' } }
          );
        } catch (error) {
          log.error({ err: error, userId, runId }, 'Failed to remind user');
        }
      }
    } catch (error) {
      log.error({ err: error, runId }, 'Error in reminder handler');
    }
  }, delayMs);
}

export function scheduleCutoff(
  botClient: ApiClient,
  standup: Standup,
  runId: number,
  delayMs: number
): NodeJS.Timeout {
  return setTimeout(async () => {
    try {
      const db = getDB();
      const run = db.getRun(runId);
      if (!run || run.status !== 'COLLECTING') return;

      log.info({ runId }, 'Cutoff reached, posting summary');
      await checkAndPostSummary(runId, standup.id, true);
    } catch (error) {
      log.error({ err: error, runId }, 'Error in cutoff handler');
    }
  }, delayMs);
}

export function clearRunTimers(run: ActiveRun): void {
  if (run.reminderTimer) {
    clearTimeout(run.reminderTimer);
    run.reminderTimer = undefined;
  }
  if (run.cutoffTimer) {
    clearTimeout(run.cutoffTimer);
    run.cutoffTimer = undefined;
  }
}
