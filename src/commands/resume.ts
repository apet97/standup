import type { SlashCommandContext } from '../app-types';
import { getDB } from '../db';
import { requireName } from './util';
import { registerCronJob } from '../scheduler';

export async function handleResume(ctx: SlashCommandContext, args: string): Promise<void> {
  const db = getDB();
  const name = requireName(args);
  if (!name) {
    await ctx.say('Please specify a standup name. Usage: `/standup resume <name>`', 'ephemeral');
    return;
  }

  const standup = db.getStandupByName(ctx.payload.workspaceId, name);
  if (!standup) {
    await ctx.say(`Standup "${name}" not found.`, 'ephemeral');
    return;
  }

  if (standup.active) {
    await ctx.say(`Standup "${name}" is already active.`, 'ephemeral');
    return;
  }

  db.updateStandupActive(standup.id, true);
  registerCronJob(standup);

  await ctx.say(`Standup **${standup.name}** resumed. Next run: \`${standup.cron_expr}\` (${standup.timezone}).`, 'ephemeral');
}
