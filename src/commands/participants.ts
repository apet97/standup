import type { SlashCommandContext, ViewActionContext, BlockInteractionContext } from '../app-types';
import { createLogger } from '../logger';
import { getDB } from '../db';
import { requireName } from './util';
import type { V1 } from '../app-types';
import { getStateValue } from '../state-utils';
import { validateParticipantCount } from '../validation';

const log = createLogger('participants');

// Store standup ID for modal submissions
const participantsModalState = new Map<string, number>();

export async function handleParticipants(ctx: SlashCommandContext, args: string): Promise<void> {
  const db = getDB();
  const name = requireName(args);
  if (!name) {
    await ctx.say('Please specify a standup name. Usage: `/standup participants <name>`', 'ephemeral');
    return;
  }

  const standup = db.getStandupByName(ctx.payload.workspaceId, name);
  if (!standup) {
    await ctx.say(`Standup "${name}" not found.`, 'ephemeral');
    return;
  }

  const key = `${ctx.payload.workspaceId}:${ctx.payload.userId}`;
  participantsModalState.set(key, standup.id);

  await showParticipantsModal(ctx, standup.id, standup.name);
}

async function showParticipantsModal(
  ctx: { spawnModalView: (view: V1.View<'MODAL'>) => Promise<void>; getBotClient: () => Promise<any> },
  standupId: number,
  standupName: string
): Promise<void> {
  const db = getDB();
  const participants = db.getParticipants(standupId);

  const blocks: V1.MainBlock[] = [];

  // Current participants list
  if (participants.length > 0) {
    const participantElements: V1.BlockBasic[] = [
      { type: 'text', text: 'Current Participants:\n', style: { bold: true } },
    ];

    for (const uid of participants) {
      participantElements.push(
        { type: 'text', text: '• ' },
        { type: 'user', user_id: uid },
        { type: 'text', text: '\n' }
      );
    }

    blocks.push({
      type: 'rich_text',
      elements: [{ type: 'rich_text_section', elements: participantElements }],
    });

    // Remove buttons
    blocks.push({
      type: 'actions',
      elements: participants.map((uid) => ({
        type: 'button' as const,
        text: { type: 'plain_text' as const, text: `Remove` },
        value: `${standupId}:${uid}`,
        style: 'danger' as const,
        onAction: 'remove_participant_btn',
      })),
    });
  } else {
    blocks.push({
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_section',
          elements: [
            { type: 'text', text: 'No participants yet. Add some below.', style: { italic: true } },
          ],
        },
      ],
    });
  }

  // Add participant input
  blocks.push({
    type: 'input',
    blockId: 'add_participant_block',
    label: { type: 'plain_text', text: 'Add Participant' },
    element: {
      type: 'dynamic_select_menu',
      onAction: 'participant_select',
      placeholder: { type: 'plain_text', text: 'Search for a user' },
      min_query_length: 0,
    },
    optional: true,
  });

  await ctx.spawnModalView({
    callbackId: 'standup_edit_participants',
    type: 'MODAL',
    title: { type: 'plain_text', text: `Participants: ${standupName.substring(0, 15)}` },
    submit: { type: 'plain_text', text: 'Add & Close' },
    close: { type: 'plain_text', text: 'Close' },
    notifyOnClose: false,
    blocks,
  });
}

export async function onEditParticipantsSubmit(ctx: ViewActionContext): Promise<void> {
  await ctx.ack();

  const participantId = getStateValue(ctx.payload.view.state, 'add_participant_block', 'participant_select');

  const key = `${ctx.payload.workspaceId}:${ctx.payload.userId}`;
  const standupId = participantsModalState.get(key);
  if (!standupId) return;
  participantsModalState.delete(key);

  if (participantId) {
    const db = getDB();
    const currentParticipants = db.getParticipants(standupId);
    const countValidation = validateParticipantCount(currentParticipants.length);
    if (!countValidation.valid) {
      log.warn({ standupId, count: currentParticipants.length }, 'Participant limit reached');
      const botClient = await ctx.getBotClient();
      if (botClient && ctx.payload.channelId) {
        await botClient.v1.messages.postEphemeral(
          ctx.payload.channelId,
          countValidation.error || 'Maximum participant limit reached.',
          ctx.payload.userId
        );
      }
      return;
    }

    db.addParticipant(standupId, participantId);

    const botClient = await ctx.getBotClient();
    if (botClient && ctx.payload.channelId) {
      await botClient.v1.messages.postEphemeral(
        ctx.payload.channelId,
        `Added <@${participantId}> to the standup.`,
        ctx.payload.userId
      );
    }
  }
}

// Do NOT ack() when updating a modal view
export async function onRemoveParticipant(ctx: BlockInteractionContext<'VIEW'>): Promise<void> {
  const payload = ctx.payload.payload;
  let value: string;
  try {
    value = typeof payload === 'string' ? JSON.parse(payload).value || payload : payload;
  } catch {
    value = payload as string;
  }

  const parts = value.split(':');
  const standupIdStr = parts[0];
  const userId = parts[1];
  if (!standupIdStr || !userId) return;
  const standupId = parseInt(standupIdStr, 10);
  if (isNaN(standupId)) return;

  const db = getDB();
  db.removeParticipant(standupId, userId);

  // Refresh the modal
  const standup = db.getStandupById(standupId);
  if (standup) {
    try {
      await showParticipantsModalUpdate(ctx, standup.id, standup.name);
    } catch (error) {
      log.error({ err: error, standupId }, 'Failed to refresh modal');
    }
  }
}

async function showParticipantsModalUpdate(
  ctx: BlockInteractionContext<'VIEW'>,
  standupId: number,
  standupName: string
): Promise<void> {
  const db = getDB();
  const participants = db.getParticipants(standupId);

  const blocks: V1.MainBlock[] = [];

  if (participants.length > 0) {
    const participantElements: V1.BlockBasic[] = [
      { type: 'text', text: 'Current Participants:\n', style: { bold: true } },
    ];

    for (const uid of participants) {
      participantElements.push(
        { type: 'text', text: '• ' },
        { type: 'user', user_id: uid },
        { type: 'text', text: '\n' }
      );
    }

    blocks.push({
      type: 'rich_text',
      elements: [{ type: 'rich_text_section', elements: participantElements }],
    });

    blocks.push({
      type: 'actions',
      elements: participants.map((uid) => ({
        type: 'button' as const,
        text: { type: 'plain_text' as const, text: `Remove` },
        value: `${standupId}:${uid}`,
        style: 'danger' as const,
        onAction: 'remove_participant_btn',
      })),
    });
  } else {
    blocks.push({
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_section',
          elements: [
            { type: 'text', text: 'No participants. Add some below.', style: { italic: true } },
          ],
        },
      ],
    });
  }

  blocks.push({
    type: 'input',
    blockId: 'add_participant_block',
    label: { type: 'plain_text', text: 'Add Participant' },
    element: {
      type: 'dynamic_select_menu',
      onAction: 'participant_select',
      placeholder: { type: 'plain_text', text: 'Search for a user' },
      min_query_length: 0,
    },
    optional: true,
  });

  await ctx.updateView({
    callbackId: 'standup_edit_participants',
    type: 'MODAL',
    title: { type: 'plain_text', text: `Participants: ${standupName.substring(0, 15)}` },
    submit: { type: 'plain_text', text: 'Add & Close' },
    close: { type: 'plain_text', text: 'Close' },
    notifyOnClose: false,
    blocks,
  });
}
