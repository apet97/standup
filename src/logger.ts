import pino from 'pino';
import { getRequestContext } from './context';

const level = process.env['LOG_LEVEL'] || 'info';

export const logger = pino({
  level,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['bot_token', 'botToken', '*.bot_token', '*.botToken'],
    censor: '[REDACTED]',
  },
  mixin() {
    const ctx = getRequestContext();
    if (ctx) {
      const extra: Record<string, unknown> = { correlationId: ctx.correlationId };
      if (ctx.runId !== undefined) extra['runId'] = ctx.runId;
      return extra;
    }
    return {};
  },
});

export function createLogger(module: string): pino.Logger {
  return logger.child({ module });
}
