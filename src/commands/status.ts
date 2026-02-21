import type { SlashCommandContext } from '../app-types';
import { getDB } from '../db';
import { requireName } from './util';

export async function handleStatus(ctx: SlashCommandContext, args: string): Promise<void> {
  const db = getDB();
  const name = requireName(args);
  if (!name) {
    await ctx.say('Please specify a standup name. Usage: `/standup status <name>`', 'ephemeral');
    return;
  }

  const standup = db.getStandupByName(ctx.payload.workspaceId, name);
  if (!standup) {
    await ctx.say(`Standup "${name}" not found.`, 'ephemeral');
    return;
  }

  const latestRun = db.getLatestRun(standup.id);
  if (!latestRun) {
    await ctx.say(
      `**${standup.name}** — No runs yet.\nStatus: ${standup.active ? 'Active' : 'Paused'}\nSchedule: \`${standup.cron_expr}\` (${standup.timezone})`,
      'ephemeral'
    );
    return;
  }

  const responses = db.getResponses(latestRun.id);
  const participants = db.getParticipants(standup.id);
  const respondedIds = new Set(responses.map((r) => r.user_id));
  const missing = participants.filter((uid) => !respondedIds.has(uid));
  const responded = responses.filter((r) => !r.is_skipped);
  const skipped = responses.filter((r) => r.is_skipped);

  const history = db.getRunHistory(standup.id, 5);
  const historyLines = history.map(
    (h) => `  ${h.triggered_at} — ${h.response_count}/${h.total_participants} responded (${h.triggered_by})`
  );

  const streakLines = participants.map((uid) => {
    const streak = db.getUserStreak(standup.id, uid);
    return `  <@${uid}>: ${streak} day streak`;
  });

  const lines = [
    `**${standup.name}** — ${standup.active ? 'Active' : 'Paused'}`,
    `Schedule: \`${standup.cron_expr}\` (${standup.timezone})`,
    `Channel: <#${standup.channel_id}>`,
    '',
    `**Latest Run** (${latestRun.triggered_at}, ${latestRun.status}):`,
    `  Responded: ${responded.length}/${participants.length}`,
    skipped.length > 0 ? `  Skipped: ${skipped.length}` : '',
    missing.length > 0
      ? `  Missing: ${missing.map((uid) => `<@${uid}>`).join(', ')}`
      : '  Everyone responded!',
    '',
    '**Recent History:**',
    ...historyLines,
    '',
    '**Streaks:**',
    ...streakLines,
  ].filter(Boolean);

  await ctx.say(lines.join('\n'), 'ephemeral');
}
