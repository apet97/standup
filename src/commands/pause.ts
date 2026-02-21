import type { SlashCommandContext } from '../app-types';
import { getDB } from '../db';
import { requireName } from './util';
import { removeCronJob } from '../scheduler';

export async function handlePause(ctx: SlashCommandContext, args: string): Promise<void> {
  const db = getDB();
  const name = requireName(args);
  if (!name) {
    await ctx.say('Please specify a standup name. Usage: `/standup pause <name>`', 'ephemeral');
    return;
  }

  const standup = db.getStandupByName(ctx.payload.workspaceId, name);
  if (!standup) {
    await ctx.say(`Standup "${name}" not found.`, 'ephemeral');
    return;
  }

  if (!standup.active) {
    await ctx.say(`Standup "${name}" is already paused.`, 'ephemeral');
    return;
  }

  db.updateStandupActive(standup.id, false);
  removeCronJob(standup.id);

  await ctx.say(`Standup **${standup.name}** paused. Use \`/standup resume ${name}\` to restart.`, 'ephemeral');
}
