import type { SlashCommandContext } from '../app-types';

export async function handleHelp(ctx: SlashCommandContext, _args: string): Promise<void> {
  await ctx.say(
    [
      '**Standup Bot Commands:**',
      '`/standup create` — Create a new standup',
      '`/standup list` — List all standups',
      '`/standup status <name>` — Show run status',
      '`/standup run <name>` — Trigger a run now',
      '`/standup pause <name>` — Pause schedule',
      '`/standup resume <name>` — Resume schedule',
      '`/standup questions <name>` — Edit questions',
      '`/standup participants <name>` — Manage participants',
      '`/standup help` — Show this message',
    ].join('\n'),
    'ephemeral'
  );
}
