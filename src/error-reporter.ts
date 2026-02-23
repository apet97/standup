import { createLogger } from './logger';

const log = createLogger('error-reporter');

export interface ErrorContext {
  workspaceId?: string;
  runId?: number;
  userId?: string;
  [key: string]: unknown;
}

export type ErrorReporter = (error: Error, context: ErrorContext) => void;

let reporter: ErrorReporter = defaultReporter;

function defaultReporter(error: Error, context: ErrorContext): void {
  log.fatal({ err: error, ...context }, 'Critical error');
}

export function setErrorReporter(fn: ErrorReporter): void {
  reporter = fn;
}

export function reportCriticalError(error: Error, context: ErrorContext = {}): void {
  try {
    reporter(error, context);
  } catch (reporterError) {
    // Fallback if the reporter itself fails
    log.fatal({ err: error, reporterError, ...context }, 'Critical error (reporter also failed)');
  }
}

/**
 * Initialize Sentry if SENTRY_DSN is set.
 * Uses dynamic require to avoid compile-time dependency on @sentry/node.
 */
export function initSentryIfConfigured(): void {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/node') as {
      init: (opts: { dsn: string }) => void;
      captureException: (err: Error) => void;
      setTag: (key: string, value: string) => void;
      setExtra: (key: string, value: unknown) => void;
    };

    Sentry.init({ dsn });

    setErrorReporter((error, context) => {
      defaultReporter(error, context);
      if (context.workspaceId) Sentry.setTag('workspaceId', context.workspaceId);
      if (context.runId !== undefined) Sentry.setTag('runId', String(context.runId));
      if (context.userId) Sentry.setTag('userId', context.userId);
      for (const [key, value] of Object.entries(context)) {
        Sentry.setExtra(key, value);
      }
      Sentry.captureException(error);
    });

    log.info('Sentry error reporting initialized');
  } catch {
    log.warn('SENTRY_DSN is set but @sentry/node is not installed — using default reporter');
  }
}
