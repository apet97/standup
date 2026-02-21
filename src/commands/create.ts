import type { SlashCommandContext, ViewActionContext, DynamicMenuContext } from '../app-types';
import type { V1 } from '../app-types';
import { createLogger } from '../logger';
import { getDB } from '../db';
import { registerCronJob } from '../scheduler';
import { getStateValue, getStateValues } from '../state-utils';

const log = createLogger('create');

// In-memory state for multi-step modal wizard
const createWizardState = new Map<string, {
  name: string;
  channelId: string;
  channelName: string;
  questions: { text: string; is_blocker: boolean }[];
  cronExpr: string;
  timezone: string;
  reminderMins: number;
  cutoffMins: number;
}>();

function wizardKey(workspaceId: string, userId: string): string {
  return `${workspaceId}:${userId}`;
}

export async function handleCreate(ctx: SlashCommandContext, _args: string): Promise<void> {
  // Open step 1 modal: name + channel
  await ctx.spawnModalView({
    callbackId: 'standup_create_step1',
    type: 'MODAL',
    title: { type: 'plain_text', text: 'Create Standup (1/3)' },
    submit: { type: 'plain_text', text: 'Next' },
    close: { type: 'plain_text', text: 'Cancel' },
    notifyOnClose: false,
    blocks: [
      {
        type: 'input',
        blockId: 'name_block',
        label: { type: 'plain_text', text: 'Standup Name' },
        element: {
          type: 'plain_text_input',
          onAction: 'name_input',
          placeholder: { type: 'plain_text', text: 'e.g. Daily Standup' },
        },
      },
      {
        type: 'input',
        blockId: 'channel_block',
        label: { type: 'plain_text', text: 'Summary Channel' },
        element: {
          type: 'dynamic_select_menu',
          onAction: 'channel_select',
          placeholder: { type: 'plain_text', text: 'Select a channel' },
          min_query_length: 0,
        },
      },
    ],
  });
}

// Step 1 submission handler — do NOT ack() when opening a modal
export async function onCreateStep1Submit(ctx: ViewActionContext): Promise<void> {
  const state_ = ctx.payload.view.state;

  const name = getStateValue(state_, 'name_block', 'name_input');
  const channelId = getStateValue(state_, 'channel_block', 'channel_select');

  if (!name || !channelId) return;

  // Validate standup name
  const trimmedName = name.trim();
  if (trimmedName.length > 64) return;
  if (!/^[\w\s-]+$/.test(trimmedName)) return;

  // Check if standup name already exists
  const db = getDB();
  const existing = db.getStandupByName(ctx.payload.workspaceId, trimmedName);
  if (existing) {
    // Can't push error easily, so we'll proceed and fail on final save
  }

  // Store partial state
  const key = wizardKey(ctx.payload.workspaceId, ctx.payload.userId);
  createWizardState.set(key, {
    name: trimmedName,
    channelId,
    channelName: '', // Will be resolved later
    questions: [],
    cronExpr: '',
    timezone: 'UTC',
    reminderMins: 30,
    cutoffMins: 120,
  });

  // Push step 2: questions + schedule
  await ctx.spawnModalView({
    callbackId: 'standup_create_step2',
    type: 'MODAL',
    title: { type: 'plain_text', text: 'Questions & Schedule (2/3)' },
    submit: { type: 'plain_text', text: 'Next' },
    close: { type: 'plain_text', text: 'Back' },
    notifyOnClose: false,
    blocks: [
      {
        type: 'input',
        blockId: 'questions_block',
        label: { type: 'plain_text', text: 'Questions (one per line)' },
        element: {
          type: 'plain_text_input',
          onAction: 'questions_input',
          line_mode: 'multiline',
          placeholder: {
            type: 'plain_text',
            text: 'What did you accomplish yesterday?\nWhat will you work on today?\nAny blockers or concerns?',
          },
        },
      },
      {
        type: 'input',
        blockId: 'blocker_q_block',
        label: { type: 'plain_text', text: 'Which question is the blocker question? (number)' },
        element: {
          type: 'plain_text_input',
          onAction: 'blocker_q_input',
          placeholder: { type: 'plain_text', text: 'e.g. 3 (for the 3rd question)' },
        },
        optional: true,
      },
      {
        type: 'input',
        blockId: 'days_block',
        label: { type: 'plain_text', text: 'Days to Run' },
        element: {
          type: 'checkboxes',
          onAction: 'days_select',
          options: [
            { text: { type: 'plain_text', text: 'Monday' }, value: '1' },
            { text: { type: 'plain_text', text: 'Tuesday' }, value: '2' },
            { text: { type: 'plain_text', text: 'Wednesday' }, value: '3' },
            { text: { type: 'plain_text', text: 'Thursday' }, value: '4' },
            { text: { type: 'plain_text', text: 'Friday' }, value: '5' },
            { text: { type: 'plain_text', text: 'Saturday' }, value: '6' },
            { text: { type: 'plain_text', text: 'Sunday' }, value: '0' },
          ],
          initial_options: [
            { text: { type: 'plain_text', text: 'Monday' }, value: '1' },
            { text: { type: 'plain_text', text: 'Tuesday' }, value: '2' },
            { text: { type: 'plain_text', text: 'Wednesday' }, value: '3' },
            { text: { type: 'plain_text', text: 'Thursday' }, value: '4' },
            { text: { type: 'plain_text', text: 'Friday' }, value: '5' },
          ],
        },
      },
      {
        type: 'input',
        blockId: 'time_block',
        label: { type: 'plain_text', text: 'Time (HH:MM, 24h format)' },
        element: {
          type: 'plain_text_input',
          onAction: 'time_input',
          placeholder: { type: 'plain_text', text: '09:00' },
        },
      },
      {
        type: 'input',
        blockId: 'timezone_block',
        label: { type: 'plain_text', text: 'Timezone' },
        element: {
          type: 'static_select_menu',
          onAction: 'timezone_select',
          placeholder: { type: 'plain_text', text: 'Select timezone' },
          options: TIMEZONE_OPTIONS,
        },
      },
    ],
  });
}

// Step 2 submission handler — do NOT ack() when opening a modal
export async function onCreateStep2Submit(ctx: ViewActionContext): Promise<void> {
  const state_ = ctx.payload.view.state;

  const questionsRaw = getStateValue(state_, 'questions_block', 'questions_input');
  const blockerQRaw = getStateValue(state_, 'blocker_q_block', 'blocker_q_input');
  const timeRaw = getStateValue(state_, 'time_block', 'time_input');
  const timezoneVal = getStateValue(state_, 'timezone_block', 'timezone_select');

  // Days come from checkboxes — multi-value
  const days = getStateValues(state_, 'days_block', 'days_select');

  if (!questionsRaw || !timeRaw || days.length === 0) return;

  // Validate questions
  const questions = questionsRaw
    .split('\n')
    .filter((q: string) => q.trim())
    .map((q: string) => q.trim().slice(0, 500));
  if (questions.length === 0 || questions.length > 20) return;

  // Validate blocker index
  const blockerIdx = blockerQRaw ? parseInt(blockerQRaw, 10) - 1 : -1;
  const validBlockerIdx = blockerIdx >= 0 && blockerIdx < questions.length ? blockerIdx : -1;

  // Parse time with validation
  const timeMatch = timeRaw.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) return;
  const hour = parseInt(timeMatch[1]!, 10);
  const minute = parseInt(timeMatch[2]!, 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return;

  // Build cron expression: minute hour * * days
  const daysList = days.sort().join(',');
  const cronExpr = `${minute} ${hour} * * ${daysList}`;

  const key = wizardKey(ctx.payload.workspaceId, ctx.payload.userId);
  const state = createWizardState.get(key);
  if (!state) return;

  state.questions = questions.map((text, i) => ({
    text,
    is_blocker: i === validBlockerIdx,
  }));
  state.cronExpr = cronExpr;
  state.timezone = timezoneVal || 'UTC';

  // Push step 3: participant selection
  await ctx.spawnModalView({
    callbackId: 'standup_create_step3',
    type: 'MODAL',
    title: { type: 'plain_text', text: 'Add Participants (3/3)' },
    submit: { type: 'plain_text', text: 'Create Standup' },
    close: { type: 'plain_text', text: 'Back' },
    notifyOnClose: false,
    blocks: [
      {
        type: 'input',
        blockId: 'participants_block',
        label: { type: 'plain_text', text: 'Select Participants' },
        element: {
          type: 'dynamic_select_menu',
          onAction: 'participant_select',
          placeholder: { type: 'plain_text', text: 'Search for a user' },
          min_query_length: 0,
        },
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: 'Note: Select one participant at a time. After creating the standup, use /standup participants to add more.',
                style: { italic: true },
              },
            ],
          },
        ],
      },
    ],
  });
}

// Step 3 submission handler — create the standup
export async function onCreateStep3Submit(ctx: ViewActionContext): Promise<void> {
  await ctx.ack();

  const participantId = getStateValue(ctx.payload.view.state, 'participants_block', 'participant_select');

  const key = wizardKey(ctx.payload.workspaceId, ctx.payload.userId);
  const state = createWizardState.get(key);
  if (!state) return;

  const db = getDB();

  // Check for duplicate name
  const existing = db.getStandupByName(ctx.payload.workspaceId, state.name);
  if (existing) {
    const botClient = await ctx.getBotClient();
    if (botClient && ctx.payload.channelId) {
      await botClient.v1.messages.postEphemeral(
        ctx.payload.channelId,
        `A standup named "${state.name}" already exists. Please choose a different name.`,
        ctx.payload.userId
      );
    }
    createWizardState.delete(key);
    return;
  }

  // Resolve channel name
  let channelName = state.channelId;
  try {
    const botClient = await ctx.getBotClient();
    if (botClient) {
      const channelInfo = await botClient.v1.channels.getChannelDetails(state.channelId);
      channelName = channelInfo.channel?.name || state.channelId;
    }
  } catch {
    // Use channelId as fallback name
  }

  // Create standup in DB
  const standupId = db.createStandup({
    workspace_id: ctx.payload.workspaceId,
    name: state.name,
    channel_id: state.channelId,
    channel_name: channelName,
    cron_expr: state.cronExpr,
    timezone: state.timezone,
    reminder_mins: state.reminderMins,
    cutoff_mins: state.cutoffMins,
    created_by: ctx.payload.userId,
  });

  // Add questions
  db.replaceQuestions(
    standupId,
    state.questions.map((q, i) => ({
      text: q.text,
      sort_order: i,
      is_blocker: q.is_blocker ? 1 : 0,
    }))
  );

  // Add participant (if selected)
  if (participantId) {
    db.addParticipant(standupId, participantId);
  }

  // Register cron job
  const standup = db.getStandupById(standupId);
  if (standup) {
    registerCronJob(standup);
  }

  // Confirm to user
  const botClient = await ctx.getBotClient();
  if (botClient && ctx.payload.channelId) {
    await botClient.v1.messages.postEphemeral(
      ctx.payload.channelId,
      {
        text: `Standup **${state.name}** created!\n\nChannel: <#${state.channelId}>\nSchedule: \`${state.cronExpr}\` (${state.timezone})\nQuestions: ${state.questions.length}\nParticipants: ${participantId ? '1 (add more with `/standup participants`)' : '0 — add with `/standup participants`'}`,
      },
      ctx.payload.userId
    );
  }

  log.info({ standupId, standupName: state.name, workspaceId: ctx.payload.workspaceId }, 'Standup created');
  createWizardState.delete(key);
}

// Dynamic menu producers
export async function channelSelectProducer(ctx: DynamicMenuContext): Promise<V1.Option[]> {
  const botClient = await ctx.getBotClient();
  if (!botClient) return [];

  try {
    const channels = await botClient.v1.channels.listChannels(['PUBLIC', 'PRIVATE']);
    return channels
      .filter((ch) => ch.channel && !ch.channel.isArchived)
      .map((ch) => ({
        text: { type: 'plain_text' as const, text: `#${ch.channel.name || ch.channel.id}` },
        value: ch.channel.id,
      }));
  } catch (error) {
    log.error({ err: error }, 'Error listing channels');
    return [];
  }
}

export async function participantSelectProducer(ctx: DynamicMenuContext): Promise<V1.Option[]> {
  const botClient = await ctx.getBotClient();
  if (!botClient) return [];

  try {
    const users = await botClient.v1.users.listWorkspaceUsers();
    return users
      .filter((u) => !u.isPumbleBot && !u.isAddonBot && u.status === 'ACTIVE')
      .map((u) => ({
        text: { type: 'plain_text' as const, text: u.name || u.email },
        value: u.id,
      }));
  } catch (error) {
    log.error({ err: error }, 'Error listing users');
    return [];
  }
}

const TIMEZONE_OPTIONS: V1.Option[] = [
  { text: { type: 'plain_text', text: 'UTC' }, value: 'UTC' },
  { text: { type: 'plain_text', text: 'US/Eastern' }, value: 'America/New_York' },
  { text: { type: 'plain_text', text: 'US/Central' }, value: 'America/Chicago' },
  { text: { type: 'plain_text', text: 'US/Mountain' }, value: 'America/Denver' },
  { text: { type: 'plain_text', text: 'US/Pacific' }, value: 'America/Los_Angeles' },
  { text: { type: 'plain_text', text: 'Europe/London' }, value: 'Europe/London' },
  { text: { type: 'plain_text', text: 'Europe/Berlin' }, value: 'Europe/Berlin' },
  { text: { type: 'plain_text', text: 'Europe/Paris' }, value: 'Europe/Paris' },
  { text: { type: 'plain_text', text: 'Asia/Tokyo' }, value: 'Asia/Tokyo' },
  { text: { type: 'plain_text', text: 'Asia/Shanghai' }, value: 'Asia/Shanghai' },
  { text: { type: 'plain_text', text: 'Asia/Kolkata' }, value: 'Asia/Kolkata' },
  { text: { type: 'plain_text', text: 'Australia/Sydney' }, value: 'Australia/Sydney' },
];
