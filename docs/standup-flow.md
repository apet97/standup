# Standup Flow — Sequence & Logic

## Full Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│ 1. SETUP (one-time, via /standup create)                    │
│    Admin configures via 3-step modal wizard:                │
│      Step 1: name + summary channel (dynamic select)        │
│      Step 2: questions + blocker flag + days + time + tz     │
│      Step 3: initial participant (dynamic select)            │
│    → Saved to DB, cron job registered                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. TRIGGER (cron fires at scheduled time OR manual /run)    │
│    Check: participants > 0 AND questions > 0                │
│    Create a new "run" record (status: COLLECTING)           │
│    Register ActiveRun in memory map (keyed by runId)        │
│    For each participant:                                    │
│      → getDirectChannel([userId]) to get DM channel         │
│      → postMessageToChannel() with rich_text question block │
│      → Track PendingPrompt in Map { workspaceId:userId }    │
│    Schedule reminder timer (+reminder_mins, default 30)     │
│    Schedule cutoff timer (+cutoff_mins, default 120)        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. COLLECT (event-driven, NEW_MESSAGE handler)              │
│    On each DM from a tracked user:                          │
│      → Check pendingPrompts map by workspaceId:userId       │
│      → If not found, fallback: findPendingRunForUser()      │
│        (scans activeRuns for matching workspace+user)        │
│      → Handle special commands:                              │
│        "skip"       → store is_skipped=1, react ⏩          │
│        "snooze N"   → remove pending, re-prompt after N min │
│      → Parse numbered answers: parseNumberedResponse()       │
│      → Compute streak from previous consecutive responses    │
│      → Store response (answers, is_late, streak) in DB      │
│      → React with ✅ to confirm receipt                     │
│      → Remove from pending map                              │
│    If all participants responded → post summary immediately  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. REMIND (timer fires at reminder_mins after trigger)      │
│    For each still-pending participant:                       │
│      → Check run still COLLECTING                           │
│      → Send reminder DM in same channel as original prompt  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. SUMMARIZE (all responded OR cutoff timer fires)          │
│    Mark run status: COMPLETE                                │
│    Store summary_msg_id and summary_channel_id on run       │
│    Build summary message with rich_text blocks:             │
│      → Header: 📋 standup name + formatted date             │
│      → ✅ Each respondent with answers (+ late/streak tags) │
│      → ⏩ Skipped users                                     │
│      → ⏳ List of non-responders                            │
│      → 🚧 Aggregated blockers section (bolded)             │
│    Post to configured standup channel                       │
│    Clean up ActiveRun, clear timers                          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. LATE RESPONSES (after COMPLETE)                          │
│    If user responds after summary posted:                    │
│      → Store response with is_late=1                        │
│      → React with ✅                                        │
│      → Rebuild summary blocks                               │
│      → editMessage() to update the posted summary in-place  │
└─────────────────────────────────────────────────────────────┘
```

## Trigger Sources

A standup run can be triggered by:

| Source | How |
|--------|-----|
| Cron schedule | `node-cron` job fires at configured time (per-standup timezone) |
| Manual run | Admin uses `/standup run <name>` |

Both call `triggerStandupRun(standup, botClient, triggeredBy)` and follow the same flow.

## DM Prompt Message Format

All questions sent in one rich_text block. User replies once with numbered answers.

```
📋 Daily Standup — Monday, February 17, 2026

Please answer the following:

1. What did you accomplish yesterday?
2. What will you work on today?
3. Any blockers or concerns?

Reply with your answers (one per line, matching the numbers).
Type "skip" to skip today, or "snooze N" to delay by N minutes.
```

Built via `buildPromptBlocks()` in `src/engine/runner.ts` using:
- `rich_text` block with `rich_text_section`
- Emoji element (`:clipboard:`) + bold title
- Bold numbered questions
- Italic instructions with skip/snooze info

## Response Parsing

User replies with:
```
1. Finished the auth module and wrote tests
2. Starting the API integration
3. Waiting on design review for the dashboard
```

`parseNumberedResponse(text, questionCount)` strips leading `N.` or `N)` prefixes.
Pads with empty strings if fewer answers than questions. Truncates to question count.

## Special Response Commands

| Command | Action | Reaction |
|---------|--------|----------|
| `skip` | Store response with `is_skipped=1`, empty answers, streak reset to 0 | ⏩ (`:fast_forward:`) |
| `snooze N` | Remove pending, re-send prompt after N minutes (max 480) | Text acknowledgment |

## Summary Message Format

Posted to the standup channel via `buildSummaryBlocks()` in `src/engine/summary.ts`:

```
📋 Daily Standup — Monday, February 17, 2026

✅ @alice — 5 day streak
  Yesterday: Finished the auth module and wrote tests
  Today: Starting the API integration
  Blockers: None

✅ @bob (late response)
  Yesterday: Fixed the deployment pipeline
  Today: Code review for PR #42
  Blockers: Waiting on design review for the dashboard

⏩ Skipped: @eve

⏳ Did not respond: @carol, @dave

🚧 Blockers:
  • @bob: Waiting on design review for the dashboard
```

Summary sections:
1. **Header** — emoji + standup name + formatted date (bold)
2. **Respondents** — each user with `✅`, optional "(late response)" italic tag, optional "N day streak" italic tag, then Q&A pairs with bold question labels
3. **Skipped** — users who typed "skip" shown with `⏩`
4. **Non-responders** — remaining participants with `⏳`
5. **Blockers** — answers to `is_blocker=1` questions, excluding trivial values ("none", "no", "n/a", "nope", "-", "nothing"), bolded text

## Timing Diagram

```
09:00  Cron fires → create run #42 → DM all participants
09:00  Prompt DMs sent to alice, bob, carol, dave, eve
09:15  alice responds → stored (streak 5), ✅ reacted
09:20  eve types "skip" → stored is_skipped, ⏩ reacted
09:25  bob types "snooze 30" → acknowledged, re-prompt at 09:55
09:30  Reminder timer fires → remind carol, dave (bob snoozed, will get new prompt)
09:45  carol responds → stored (streak 1), ✅ reacted
09:55  bob gets re-prompted → responds → stored (streak 3), ✅ reacted
11:00  Cutoff timer fires → dave didn't respond
11:00  checkAndPostSummary(runId, standupId, forceCutoff=true)
11:00  Summary posted to #standup channel, run marked COMPLETE
11:30  dave responds late → stored with is_late=1
11:30  Summary message edited in-place with dave's answers
```

## Pending Prompt Tracking

**Primary**: In-memory `Map<string, PendingPrompt>` keyed by `${workspaceId}:${userId}`

```typescript
interface PendingPrompt {
  runId: number;
  standupId: number;
  userId: string;
  channelId: string;     // DM channel ID
  messageId: string;     // the prompt message ID
  sentAt: Date;
  questions: Question[];
  workspaceId: string;
}
```

**Fallback** (crash recovery): `findPendingRunForUser(workspaceId, userId)` scans `activeRuns` map for matching workspace+user who hasn't responded. Used when exact pending prompt was lost (e.g., after restart).

**Active Runs**: In-memory `Map<number, ActiveRun>` keyed by `runId`. Holds standup metadata, question list, participant list, and timer refs.

## Edge Cases

| Case | Handling |
|------|----------|
| User responds before prompt (random DM) | Ignored — no pending prompt and no matching active run |
| User sends multiple messages | First message is the response; subsequent ignored (pending removed, user marked as responded) |
| User responds after cutoff | Stored as late response (`is_late=1`), summary message edited in-place |
| Bot restarts mid-collection | `reloadPendingFromDB()` loads COLLECTING runs into activeRuns map; `findPendingRunForUser()` provides fallback matching |
| Cron fires but standup is paused | `triggerStandupRun` only called for active standups; scheduler checks `standup.active` |
| No participants configured | Run skipped with console log, no run record created |
| No questions configured | Run skipped with console log, no run record created |
| Channel deleted / API error | Caught per-participant with try/catch, other participants still prompted |
| Workspace has multiple standups at same time | Each run has its own ID; pending map keyed by `workspaceId:userId` (one pending prompt per user at a time) |
| User in multiple standups triggered simultaneously | Second standup's prompt overwrites first in pending map — limitation of single-key design |
| Snooze after cutoff | Snooze checks run status (`COLLECTING`) before re-prompting; if already COMPLETE, no re-prompt |
| Summary post fails | Run still marked COMPLETE (with empty summary_msg_id) to prevent repeated attempts |
| APP_UNINSTALLED event | All cron jobs removed, all workspace data deleted from DB |

## State Machine

```
Run States:
  COLLECTING → prompts sent, waiting for responses + timers active
  COMPLETE   → summary posted, run finished, timers cleared

  Note: No PENDING state. Run goes directly to COLLECTING when created
  because prompts are sent immediately in the same triggerStandupRun() call.

Standup States:
  ACTIVE  (active=1) → cron job registered, will fire on schedule
  PAUSED  (active=0) → cron job removed, won't fire until resumed

Transitions:
  COLLECTING → COMPLETE: when all responded OR cutoff timer fires
  ACTIVE → PAUSED:  /standup pause <name>
  PAUSED → ACTIVE:  /standup resume <name>
```

## Key Implementation Files

| File | Responsibility |
|------|---------------|
| `src/engine/runner.ts` | `triggerStandupRun()`, pending prompt tracking, snooze handling, crash recovery |
| `src/engine/collector.ts` | `handleNewMessage()` — skip, snooze, parse, store, late response editing |
| `src/engine/reminder.ts` | `scheduleReminder()`, `scheduleCutoff()`, timer cleanup |
| `src/engine/summary.ts` | `checkAndPostSummary()`, `buildSummaryBlocks()` |
| `src/scheduler/index.ts` | `node-cron` job management with per-standup timezone |
