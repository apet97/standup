import type { SlashCommandContext } from '../app-types';
import { getDB } from '../db';

export async function handleList(ctx: SlashCommandContext, _args: string): Promise<void> {
  const db = getDB();
  const standups = db.getStandupsByWorkspace(ctx.payload.workspaceId);

  if (standups.length === 0) {
    await ctx.say(
      'No standups configured. Use `/standup create` to set one up.',
      'ephemeral'
    );
    return;
  }

  const lines = standups.map(
    (s) =>
      `• **${s.name}** → <#${s.channel_id}> | \`${s.cron_expr}\` (${s.timezone}) | ${s.active ? 'Active' : 'Paused'} | ${s.participant_count} participants`
  );

  await ctx.say(lines.join('\n'), 'ephemeral');
}
