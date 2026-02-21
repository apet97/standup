# Command Routing — `/standup` Subcommands

## Why Single Command + Subcommands

Pumble registers slash commands at the app level. Rather than registering 8+ separate commands (`/standup-create`, `/standup-list`, etc.), we use one `/standup` command and parse the subcommand from `ctx.payload.text`.

## Router Pattern

```typescript
// src/commands/router.ts
import type { SlashCommandContext } from '../app-types';

type SubcommandHandler = (ctx: SlashCommandContext, args: string) => Promise<void>;

const subcommands: Record<string, SubcommandHandler> = {
  create:       handleCreate,
  list:         handleList,
  status:       handleStatus,
  run:          handleRun,
  pause:        handlePause,
  resume:       handleResume,
  questions:    handleQuestions,
  participants: handleParticipants,
  help:         handleHelp,
};

export async function routeStandupCommand(ctx: SlashCommandContext): Promise<void> {
  await ctx.ack();

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
    await ctx.say(
      `Unknown subcommand: \`${subcommand}\`. Use \`/standup help\` to see available commands.`,
      'ephemeral'
    );
    return;
  }

  try {
    await handler(ctx, args);
  } catch (error) {
    console.error(`[standup:${subcommand}] Error:`, error);
    await ctx.say('Something went wrong. Please try again.', 'ephemeral');
  }
}
```

Key details:
- `ctx.ack()` is called immediately in the router (within 3-second requirement)
- Error handling wraps each handler call with try/catch
- Empty text or "help" routes to help handler
- `SlashCommandContext` imported from `src/app-types.ts` (deep SDK re-export)

## App Registration

```typescript
// src/main.ts
import { start, App, JsonFileTokenStore } from 'pumble-sdk';
import { routeStandupCommand } from './commands/router';

const app: App = {
  tokenStore: new JsonFileTokenStore('tokens.json'),
  redirect: { enable: true, onSuccess: ..., onError: ... },

  slashCommands: [
    {
      command: '/standup',
      description: 'Manage async standups and check-ins',
      usageHint: '/standup [create|list|status|run|pause|resume|questions|participants|help] [name]',
      handler: routeStandupCommand,
    },
  ],

  events: [...],           // NEW_MESSAGE, APP_UNINSTALLED
  viewAction: {
    onSubmit: {...},        // Modal submission handlers
    onClose: {},
  },
  blockInteraction: {...},  // In-modal button handlers
  dynamicMenus: [...],      // Channel and user select producers

  port: parseInt(process.env.PORT || '5000', 10),
};

const addonInstance = await start(app);
addonInstance.onError((error) => {
  console.error('[addon] Uncaught handler error:', error);
});
```

## Subcommand Specifications

### `/standup create`
- **Args:** none
- **Action:** Opens 3-step modal wizard:
  - **Step 1** (`standup_create_step1`): Name (plain_text_input) + Channel (dynamic_select_menu)
  - **Step 2** (`standup_create_step2`): Questions (multiline input) + Blocker question number + Days (checkboxes, Mon-Fri pre-selected) + Time (HH:MM) + Timezone (static_select_menu)
  - **Step 3** (`standup_create_step3`): Participant (dynamic_select_menu, one at a time)
- **Modal ack() rules:** Steps 1 and 2 do NOT call `ctx.ack()` (they open the next modal). Step 3 calls `ctx.ack()` as the final handler.
- **State:** In-memory `Map<string, WizardState>` keyed by `${workspaceId}:${userId}`
- **Response:** Ephemeral confirmation after final submission with standup details
- **File:** `src/commands/create.ts`

### `/standup list`
- **Args:** none
- **Action:** Lists all standups in the workspace with participant counts
- **Response:** Ephemeral message with formatted list

```typescript
// src/commands/list.ts
export async function handleList(ctx: SlashCommandContext, _args: string): Promise<void> {
  const db = getDB();
  const standups = db.getStandupsByWorkspace(ctx.payload.workspaceId);

  if (standups.length === 0) {
    await ctx.say('No standups configured yet. Use `/standup create` to set one up.', 'ephemeral');
    return;
  }

  const lines = standups.map(
    (s) =>
      `• **${s.name}** → <#${s.channel_id}> | \`${s.cron_expr}\` (${s.timezone}) | ${s.active ? '✅ Active' : '⏸ Paused'} | ${s.participant_count} participants`
  );

  await ctx.say(`**Standups in this workspace:**\n${lines.join('\n')}`, 'ephemeral');
}
```

### `/standup status <name>`
- **Args:** standup name (required)
- **Action:** Shows latest run status with response counts, streaks, and timing
- **Response:** Ephemeral with responded/pending/total counts and run history
- **File:** `src/commands/status.ts`

### `/standup run <name>`
- **Args:** standup name (required)
- **Action:** Immediately triggers a run via `triggerStandupRun(standup, botClient, 'manual')`
- **Validation:** Checks standup exists and has participants
- **Response:** Ephemeral confirmation, then DMs go out
- **File:** `src/commands/run.ts`

### `/standup pause <name>`
- **Args:** standup name (required)
- **Action:** Sets `standup.active = 0`, removes cron job via `removeCronJob()`
- **Validation:** Checks standup is currently active
- **Response:** Ephemeral confirmation
- **File:** `src/commands/pause.ts`

### `/standup resume <name>`
- **Args:** standup name (required)
- **Action:** Sets `standup.active = 1`, re-registers cron job via `registerCronJob()`
- **Validation:** Checks standup is currently paused
- **Response:** Ephemeral confirmation
- **File:** `src/commands/resume.ts`

### `/standup questions <name>`
- **Args:** standup name (required)
- **Action:** Opens modal with current questions in a multiline input + blocker question number input
- **Modal:** `standup_edit_questions` callbackId. Calls `ctx.ack()` on submit (final handler).
- **Storage:** `db.replaceQuestions()` — deletes all existing, inserts new (in transaction)
- **File:** `src/commands/questions.ts`

### `/standup participants <name>`
- **Args:** standup name (required)
- **Action:** Opens modal showing current participants with remove buttons + dynamic user select to add
- **Modal:** `standup_edit_participants` callbackId
- **Block interaction:** `remove_participant_btn` — removes participant, updates modal via `ctx.updateView()` (does NOT call ack())
- **Submit:** Calls `ctx.ack()`, adds selected participant via `db.addParticipant()`
- **File:** `src/commands/participants.ts`

### `/standup help`
- **Args:** none
- **Response:** Ephemeral message listing all subcommands with descriptions
- **File:** `src/commands/help.ts`

## Argument Parsing Helper

```typescript
// src/commands/util.ts
export function requireName(args: string): string | null {
  const name = args.trim();
  if (!name) return null;
  return name;
}
```

Returns `null` if empty — each handler is responsible for showing the usage message:

```typescript
// Usage in handlers:
const name = requireName(args);
if (!name) {
  await ctx.say('Please specify a standup name. Usage: `/standup status <name>`', 'ephemeral');
  return;
}
```

## Modal View Registration

All modal handlers are registered in the App object:

```typescript
viewAction: {
  onSubmit: {
    standup_create_step1: onCreateStep1Submit,   // → opens step 2 (no ack)
    standup_create_step2: onCreateStep2Submit,   // → opens step 3 (no ack)
    standup_create_step3: onCreateStep3Submit,   // → creates standup (ack)
    standup_edit_questions: onEditQuestionsSubmit,  // → saves questions (ack)
    standup_edit_participants: onEditParticipantsSubmit,  // → adds participant (ack)
  },
  onClose: {},
},

blockInteraction: {
  interactions: [
    {
      sourceType: 'VIEW',
      handlers: {
        remove_participant_btn: onRemoveParticipant,  // → updateView (no ack)
      },
    },
  ],
},

dynamicMenus: [
  { onAction: 'channel_select', producer: channelSelectProducer },
  { onAction: 'participant_select', producer: participantSelectProducer },
],
```

## Dynamic Menu Producers

```typescript
// Channel select: lists non-archived PUBLIC + PRIVATE channels
channelSelectProducer: botClient.v1.channels.listChannels(['PUBLIC', 'PRIVATE'])
  → filter(!isArchived) → map to { text: '#name', value: id }

// Participant select: lists active non-bot workspace users
participantSelectProducer: botClient.v1.users.listWorkspaceUsers()
  → filter(!isPumbleBot && !isAddonBot && status === 'ACTIVE')
  → map to { text: name || email, value: id }
```

Both defined in `src/commands/create.ts` and referenced from `main.ts`.

## File Organization

```
src/commands/
├── router.ts        # Subcommand dispatch with error handling
├── create.ts        # 3-step modal wizard + dynamic menu producers
├── list.ts          # List standups
├── status.ts        # Show run status + streaks
├── run.ts           # Manual trigger
├── pause.ts         # Pause schedule
├── resume.ts        # Resume schedule
├── questions.ts     # Edit questions modal
├── participants.ts  # Manage participants modal
├── help.ts          # Help text
└── util.ts          # requireName() argument parser
```
