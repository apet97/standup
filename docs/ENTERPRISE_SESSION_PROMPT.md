# Enterprise Readiness Implementation Prompt

> Copy everything below the line into a new Claude Code session.

---

You are implementing enterprise readiness for a Pumble standup bot. This is a TypeScript/Node.js addon using `pumble-sdk`, `better-sqlite3`, `node-cron`, and `pino`.

## Hard constraints

- **NEVER add yourself as a contributor, author, or co-author anywhere.** Do not modify `package.json` author/contributors, do not add `Co-authored-by` trailers to commits, do not add AI attribution to files, comments, or docs. You are a tool, not a collaborator.
- **NEVER create commits unless explicitly told to.**
- **NEVER push to remote unless explicitly told to.**

## What's already done

All **P0** (items 1-8) and **P1** (items 9-18) from `TODO_ENTERPRISE.md` are implemented and verified. Gates are green:

```
npm run build   → passes (0 errors)
npm test        → 69 tests pass (4 suites)
npm run lint    → 0 errors (5 warnings — acceptable SDK interop `any`)
```

**Do NOT re-implement P0 or P1 items.** They are done. Read `docs/ENTERPRISE_REVIEW.md` for per-item evidence.

## What remains: P2 (items 19-26)

Execute `TODO_ENTERPRISE.md` items 19 through 26 in order. These are:

| # | Item | Summary |
|---|------|---------|
| 19 | Metrics Endpoint (Prometheus) | `GET /metrics` with run/response/DM counters, histograms, process metrics |
| 20 | E2E Test Strategy | Mock-SDK e2e test for full flow: create → run → DM → response → summary |
| 21 | Dependency Audit & Lockfile | Commit lockfile, `npm audit` clean, Dependabot config |
| 22 | Versioning & Changelog | Semver in package.json, version in healthcheck, CHANGELOG.md |
| 23 | Missing Database Indexes | Already done as `002_add_indexes.sql` — verify and mark DONE |
| 24 | Blocking I/O Audit | Audit all better-sqlite3 queries, chunk large operations, event loop monitoring |
| 25 | Config Documentation & Runbook | `docs/config.md` (all env vars) + `docs/runbook.md` (deploy, backup, rotate, troubleshoot) |
| 26 | Error Reporting Hook | Pluggable `onCriticalError`, optional Sentry via `SENTRY_DSN` |

## Execution protocol

For EACH item:

1. Read the item's full spec in `TODO_ENTERPRISE.md`.
2. Read all files listed in "Files to touch" before writing any code.
3. Implement the item.
4. Run ALL gates — every single one must pass before moving on:
   ```bash
   npm run build    # must pass
   npm test         # must pass
   npm run lint     # must pass (0 errors)
   ```
5. Update docs:
   - If architecture/behavior changed → update `CLAUDE.md`
   - If schema/queries changed → update `docs/schema.md`
   - If codebase map/run engine/how-to changed → update `docs/ai-guide.md`
   - Append a dated entry to `docs/CHANGELOG_AI.md` documenting what changed
6. Mark the item DONE in `TODO_ENTERPRISE.md` with a status line.
7. Move to the next item.

**Stop and report** if any gate fails and you cannot fix it within 3 attempts.

## Bootstrap (do this FIRST before any code)

1. Read `CLAUDE.md` (top section "Session Bootstrap" has hard rules and SDK gotchas).
2. Read `docs/ai-guide.md` (codebase map, run engine walkthrough, how-to guides).
3. Read `TODO_ENTERPRISE.md` (the full enterprise checklist — your work list).
4. Read `docs/ENTERPRISE_REVIEW.md` (proof that P0+P1 are done — don't redo them).
5. Load skills in order:
   ```
   cake-marketplace-dev
   pumble-modal-forms
   pumble-dm-collection
   standup-bot-architecture
   pumble-sdk-gotchas
   ```
6. Run `npm run build && npm test && npm run lint` to confirm the baseline is green before touching anything.

## SDK gotchas (will silently break the bot if wrong)

- Do NOT call `ctx.ack()` when opening/pushing/updating modals — `ack()` and `spawnModalView()` share the same Express response object. Calling both silently drops one.
- `dmUser(userId, message)` — NOT `postDirectMessage()` (doesn't exist).
- `addReaction(messageId, { code: ':emoji_name:' })` — 2 args, not 3.
- `line_mode: 'multiline'` — NOT `multiline: boolean`.
- `checkboxes` works despite not being in docs — `BlockCheckboxes` type, state has `values: string[]`.
- Context types: deep import from `pumble-sdk/lib/core/types/contexts`.
- `listChannels()` returns `ChannelInfo[]` with `.channel.id`, `.channel.name`.
- NEW_MESSAGE body: `aId` (author), `cId` (channel), `tx` (text), `mId` (message ID).
- Events do NOT need `ctx.ack()` — only triggers (slash commands, shortcuts) do.
- Verify against `pumble-sdk/lib/` types, not reference docs — the docs are frequently wrong.

## Architecture (current)

```
src/
├── main.ts              # App definition, startup, shutdown, healthcheck
├── types.ts             # Domain types (Run status: COLLECTING | COMPLETE | INTERRUPTED)
├── config.ts            # Env var validation (loadConfig/getConfig)
├── logger.ts            # Pino structured JSON + correlation ID mixin
├── context.ts           # AsyncLocalStorage request context
├── validation.ts        # Input validators (names, cron, time, questions, snooze)
├── retry.ts             # withRetry() exponential backoff
├── addon-instance.ts    # Decoupled addon getter
├── state-utils.ts       # Modal state extraction (getStateValue/getStateValues)
├── app-types.ts         # SDK type re-exports
├── db/
│   ├── schema.ts        # Migration runner (schema_version tracking)
│   ├── index.ts         # StandupDB class (all queries, singleton)
│   └── migrations/      # 001_initial.sql, 002_add_indexes.sql
├── commands/
│   ├── router.ts        # /standup dispatch + rate limiting
│   ├── create.ts        # 3-step modal wizard
│   └── *.ts             # list, status, run, pause, resume, questions, participants, help
├── engine/
│   ├── runner.ts        # triggerStandupRun(), idempotency, snooze, crash recovery, shutdown
│   ├── collector.ts     # NEW_MESSAGE handler, response parsing, skip/snooze
│   ├── reminder.ts      # Timer scheduling with retry
│   └── summary.ts       # Rich text summary building, late response editing
├── scheduler/
│   └── index.ts         # node-cron management + retention job
└── scripts/
    └── db-backup.ts     # SQLite backup API
```

## Key dependencies between P2 items

- Item 23 (indexes) is likely already done — check `002_add_indexes.sql` before creating new migration.
- Item 19 (metrics) enables item 24 (event loop monitoring) — do 19 first.
- Item 22 (versioning) depends on item 8 (healthcheck) which is already done.
- Items 25 (config docs) and 26 (error reporter) are independent.

## Coding standards

- TypeScript strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`.
- Pino for all logging — no `console.log` or `console.error`.
- `withRetry()` wrapper on all Pumble API calls.
- Correlation IDs via `AsyncLocalStorage` — wrap new handlers in `runWithContext()`.
- Existing tests use `vitest` — match the existing patterns in `src/validation.test.ts`, `src/db/__tests__/index.test.ts`.
- ESLint flat config (`eslint.config.mjs`) + Prettier (`.prettierrc`).
- Migrations: numbered SQL files in `src/db/migrations/` — NEVER edit existing ones.

## Reminder

- **You are NOT a contributor.** Do not add yourself anywhere.
- **Read before writing.** Always read every file you plan to modify.
- **Gates after every item.** `npm run build && npm test && npm run lint` — all three.
- **Update docs.** CLAUDE.md, ai-guide.md, schema.md, CHANGELOG_AI.md as needed.
- **Do not over-engineer.** Minimum viable implementation per acceptance criteria.

Begin by running the bootstrap steps above, then start with item 19.
