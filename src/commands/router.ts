import type { SlashCommandContext } from '../app-types';
import { createLogger } from '../logger';
import { handleCreate } from './create';
import { handleList } from './list';
import { handleStatus } from './status';
import { handleRun } from './run';
import { handlePause } from './pause';
import { handleResume } from './resume';
import { handleQuestions } from './questions';
import { handleParticipants } from './participants';
import { handleHelp } from './help';

const log = createLogger('router');

type SubcommandHandler = (ctx: SlashCommandContext, args: string) => Promise<void>;

const subcommands: Record<string, SubcommandHandler> = {
  create: handleCreate,
  list: handleList,
  status: handleStatus,
  run: handleRun,
  pause: handlePause,
  resume: handleResume,
  questions: handleQuestions,
  participants: handleParticipants,
  help: handleHelp,
};

// Rate limiter: per-user, per-workspace
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(workspaceId: string, userId: string): number | null {
  const key = `${workspaceId}:${userId}`;
  const now = Date.now();
  const entry = rateLimits.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return Math.ceil((entry.resetAt - now) / 1000);
  }
  return null;
}

function sanitizeSubcommand(input: string): string {
  // Strip control characters and truncate
  return input.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 32);
}

export async function routeStandupCommand(ctx: SlashCommandContext): Promise<void> {
  await ctx.ack();

  // Rate limiting
  const retryAfter = checkRateLimit(ctx.payload.workspaceId, ctx.payload.userId);
  if (retryAfter !== null) {
    await ctx.say(
      `You're doing that too fast. Try again in ${retryAfter} seconds.`,
      'ephemeral'
    );
    return;
  }

  const text = (ctx.payload.text || '').trim();
  const spaceIndex = text.indexOf(' ');
  const subcommand = spaceIndex === -1 ? text : text.slice(0, spaceIndex);
  const args = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim();

  if (!subcommand || subcommand === 'help') {
    await handleHelp(ctx, args);
    return;
  }

  const handler = subcommands[subcommand.toLowerCase()];
  if (!handler) {
    const sanitized = sanitizeSubcommand(subcommand);
    await ctx.say(
      `Unknown subcommand: \`${sanitized}\`. Use \`/standup help\` to see available commands.`,
      'ephemeral'
    );
    return;
  }

  try {
    await handler(ctx, args);
  } catch (error) {
    log.error({ err: error, subcommand }, 'Error handling subcommand');
    await ctx.say('Something went wrong. Please try again.', 'ephemeral');
  }
}
