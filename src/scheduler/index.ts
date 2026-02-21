import cron from 'node-cron';
import type { Standup } from '../types';
import { createLogger } from '../logger';
import { getDB } from '../db';
import { triggerStandupRun } from '../engine/runner';
import { getAddonInstance } from '../addon-instance';

const log = createLogger('scheduler');

// Map of standup ID -> cron task
const cronJobs = new Map<number, cron.ScheduledTask>();

export function registerCronJob(standup: Standup): void {
  // Remove existing job if any
  removeCronJob(standup.id);

  if (!standup.active) return;

  if (!cron.validate(standup.cron_expr)) {
    log.error({ standupName: standup.name, cronExpr: standup.cron_expr }, 'Invalid cron expression');
    return;
  }

  const task = cron.schedule(
    standup.cron_expr,
    async () => {
      try {
        // Re-fetch standup to check if still active
        const db = getDB();
        const current = db.getStandupById(standup.id);
        if (!current || !current.active) {
          log.info({ standupName: standup.name }, 'Standup is paused/deleted, skipping');
          return;
        }

        const addon = getAddonInstance();
        if (!addon) {
          log.error('Addon instance not available');
          return;
        }

        const botClient = await addon.getBotClient(current.workspace_id);
        if (!botClient) {
          log.error({ workspaceId: current.workspace_id }, 'Bot client unavailable');
          return;
        }

        log.info({ standupName: current.name }, 'Cron fired');
        await triggerStandupRun(current, botClient, 'schedule');
      } catch (error) {
        log.error({ err: error, standupName: standup.name }, 'Error triggering standup');
      }
    },
    {
      timezone: standup.timezone || 'UTC',
    }
  );

  cronJobs.set(standup.id, task);
  log.info({ standupName: standup.name, cronExpr: standup.cron_expr, timezone: standup.timezone }, 'Registered cron job');
}

export function removeCronJob(standupId: number): void {
  const existing = cronJobs.get(standupId);
  if (existing) {
    existing.stop();
    cronJobs.delete(standupId);
    log.info({ standupId }, 'Removed cron job');
  }
}

export function loadAllCronJobs(): void {
  const db = getDB();
  const standups = db.getAllActiveStandups();

  log.info({ count: standups.length }, 'Loading active standup schedules');
  for (const standup of standups) {
    registerCronJob(standup);
  }
}

export function registerRetentionJob(retentionDays: number): void {
  const task = cron.schedule('0 3 * * *', () => {
    try {
      const db = getDB();
      const deleted = db.cleanupOldRuns(retentionDays);
      if (deleted > 0) {
        log.info({ deleted, retentionDays }, 'Cleaned up old runs');
      }
    } catch (error) {
      log.error({ err: error }, 'Error during retention cleanup');
    }
  });
  cronJobs.set(-1, task); // Use -1 as a special key for the retention job
  log.info({ retentionDays }, 'Registered daily retention cleanup job');
}

export function clearAllCronJobs(): void {
  for (const [, task] of cronJobs) {
    task.stop();
  }
  cronJobs.clear();
  log.info('Cleared all cron jobs');
}
