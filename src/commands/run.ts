import type { SlashCommandContext } from '../app-types';
import { createLogger } from '../logger';
import { getDB } from '../db';
import { requireName } from './util';
import { triggerStandupRun } from '../engine/runner';

const log = createLogger('command:run');

export async function handleRun(ctx: SlashCommandContext, args: string): Promise<void> {
  const db = getDB();
  const name = requireName(args);
  if (!name) {
    await ctx.say('Please specify a standup name. Usage: `/standup run <name>`', 'ephemeral');
    return;
  }

  const standup = db.getStandupByName(ctx.payload.workspaceId, name);
  if (!standup) {
    await ctx.say(`Standup "${name}" not found.`, 'ephemeral');
    return;
  }

  // Check for already running
  const existingRun = db.getCollectingRunForStandup(standup.id);
  if (existingRun) {
    await ctx.say(`A run is already in progress for "${name}".`, 'ephemeral');
    return;
  }

  const participants = db.getParticipants(standup.id);
  if (participants.length === 0) {
    await ctx.say(`Standup "${name}" has no participants. Add some with \`/standup participants ${name}\`.`, 'ephemeral');
    return;
  }

  const botClient = await ctx.getBotClient();
  if (!botClient) {
    await ctx.say('Bot client unavailable. Please reinstall the app.', 'ephemeral');
    return;
  }

  await ctx.say(`Triggering standup **${standup.name}** now...`, 'ephemeral');

  try {
    await triggerStandupRun(standup, botClient, 'manual');
  } catch (error) {
    log.error({ err: error, standupName: name }, 'Error triggering run');
    await ctx.say('Failed to trigger the standup run. Check the logs.', 'ephemeral');
  }
}
