import 'dotenv/config';
import { getConfig } from './config';
import { createLogger } from './logger';
import { start, App, JsonFileTokenStore } from 'pumble-sdk';
import type { OnMessageContext } from './app-types';
import type { PumbleEventContext } from 'pumble-sdk/lib/core/types/contexts';
import { setAddonInstance } from './addon-instance';

import { routeStandupCommand } from './commands/router';
import {
  onCreateStep1Submit,
  onCreateStep2Submit,
  onCreateStep3Submit,
  channelSelectProducer,
  participantSelectProducer,
} from './commands/create';
import { onEditQuestionsSubmit } from './commands/questions';
import { onEditParticipantsSubmit, onRemoveParticipant } from './commands/participants';
import { handleNewMessage } from './engine/collector';
import { reloadPendingFromDB, shutdownActiveRuns } from './engine/runner';
import { loadAllCronJobs, clearAllCronJobs, registerRetentionJob } from './scheduler';
import { getDB, closeDB } from './db';
import { runWithContext, generateCorrelationId } from './context';

const log = createLogger('main');

async function main(): Promise<void> {
  const config = getConfig();

  log.info('Starting Standup Bot...');

  // Initialize database — run integrity check on startup
  const db = getDB();
  const integrity = db.integrityCheck();
  if (integrity !== 'ok') {
    log.fatal({ integrity }, 'Database integrity check failed — refusing to start');
    process.exit(1);
  }
  log.info('Database initialized');

  const app: App = {
    tokenStore: new JsonFileTokenStore(config.tokenStorePath),
    redirect: {
      enable: true,
      onSuccess: (_tokens, _req, res) => {
        res.send('Authorization successful! You can close this window.');
      },
      onError: (error, _req, res) => {
        createLogger('auth').error({ err: error }, 'OAuth error');
        res.status(401).send('Authorization failed. Please try again.');
      },
    },

    slashCommands: [
      {
        command: '/standup',
        description: 'Manage async standups and check-ins',
        usageHint: '/standup [create|list|status|run|pause|resume|questions|participants|help] [name]',
        handler: (ctx) => runWithContext(
          { correlationId: generateCorrelationId() },
          () => routeStandupCommand(ctx)
        ),
      },
    ],

    events: [
      {
        name: 'NEW_MESSAGE' as const,
        handler: async (ctx: OnMessageContext) => {
          await runWithContext({ correlationId: generateCorrelationId() }, async () => {
            try {
              await handleNewMessage(ctx);
            } catch (error) {
              createLogger('event:NEW_MESSAGE').error({ err: error }, 'Error handling message');
            }
          });
        },
      },
      {
        name: 'APP_UNINSTALLED' as const,
        handler: async (ctx: PumbleEventContext<'APP_UNINSTALLED'>) => {
          await runWithContext({ correlationId: generateCorrelationId() }, async () => {
            const workspaceId = ctx.payload.workspaceId;
            const uninstallLog = createLogger('event:APP_UNINSTALLED');
            uninstallLog.info({ workspaceId }, 'Cleaning up workspace');
            try {
              const appDb = getDB();
              const { removeCronJob } = await import('./scheduler');
              const standups = appDb.getStandupsByWorkspace(workspaceId);
              for (const s of standups) {
                removeCronJob(s.id);
              }
              appDb.deleteWorkspaceData(workspaceId);
              uninstallLog.info({ workspaceId }, 'Cleaned up workspace');
            } catch (error) {
              uninstallLog.error({ err: error, workspaceId }, 'Error cleaning up workspace');
            }
          });
        },
      },
    ],

    viewAction: {
      onSubmit: {
        standup_create_step1: (ctx) => runWithContext(
          { correlationId: generateCorrelationId() },
          () => onCreateStep1Submit(ctx),
        ),
        standup_create_step2: (ctx) => runWithContext(
          { correlationId: generateCorrelationId() },
          () => onCreateStep2Submit(ctx),
        ),
        standup_create_step3: (ctx) => runWithContext(
          { correlationId: generateCorrelationId() },
          () => onCreateStep3Submit(ctx),
        ),
        standup_edit_questions: (ctx) => runWithContext(
          { correlationId: generateCorrelationId() },
          () => onEditQuestionsSubmit(ctx),
        ),
        standup_edit_participants: (ctx) => runWithContext(
          { correlationId: generateCorrelationId() },
          () => onEditParticipantsSubmit(ctx),
        ),
      },
      onClose: {},
    },

    blockInteraction: {
      interactions: [
        {
          sourceType: 'VIEW',
          handlers: {
            remove_participant_btn: (ctx) => runWithContext(
              { correlationId: generateCorrelationId() },
              () => onRemoveParticipant(ctx),
            ),
          },
        },
      ],
    },

    dynamicMenus: [
      {
        onAction: 'channel_select',
        producer: channelSelectProducer,
      },
      {
        onAction: 'participant_select',
        producer: participantSelectProducer,
      },
    ],

    onServerConfiguring: (expressApp: any) => {
      expressApp.get('/healthz', (_req: any, res: any) => {
        const startTime = Date.now();
        try {
          const healthDb = getDB();
          healthDb.healthCheck();
          const uptime = process.uptime();
          const version = process.env['npm_package_version'] || '1.0.0';
          res.status(200).json({
            status: 'ok',
            uptime: Math.floor(uptime),
            version,
            responseTime: Date.now() - startTime,
          });
        } catch (error) {
          res.status(503).json({
            status: 'degraded',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });
    },

    port: config.port,
  };

  // Start the Pumble SDK server
  const addonInstance = await start(app);
  setAddonInstance(addonInstance);
  addonInstance.onError((error) => {
    createLogger('addon').error({ err: error }, 'Uncaught handler error');
  });
  log.info({ port: config.port }, 'Pumble SDK server started');

  // Load cron jobs for all active standups
  loadAllCronJobs();

  // Register daily data retention cleanup
  registerRetentionJob(config.retentionDays);

  // Reload any in-progress runs from DB (crash recovery)
  reloadPendingFromDB();

  log.info('Standup Bot is ready!');

  // Graceful shutdown
  const shutdown = (): void => {
    log.info('Shutting down...');
    shutdownActiveRuns();
    clearAllCronJobs();
    closeDB();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  log.fatal({ err: error }, 'Fatal error');
  process.exit(1);
});
