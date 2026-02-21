import { createLogger } from './logger';

const log = createLogger('retry');

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  context?: Record<string, unknown>;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 500, context = {} } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status ?? error?.status;

      // Don't retry on client errors (4xx) except 429
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw error;
      }

      if (attempt === maxAttempts) {
        log.error({ err: error, attempt, ...context }, 'All retry attempts exhausted');
        throw error;
      }

      // Calculate delay with exponential backoff
      let delayMs = baseDelayMs * Math.pow(2, attempt - 1);

      // Respect Retry-After header if present
      const retryAfter = error?.response?.headers?.['retry-after'];
      if (retryAfter) {
        const retryAfterMs = parseInt(retryAfter, 10) * 1000;
        if (!isNaN(retryAfterMs)) {
          delayMs = retryAfterMs;
        }
      }

      log.warn({ attempt, maxAttempts, delayMs, status, ...context }, 'Retrying after failure');
      await sleep(delayMs);
    }
  }

  // Unreachable but TypeScript needs it
  throw new Error('Retry loop exhausted');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
