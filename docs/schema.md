# Database Schema — SQLite

## Tables

```sql
-- Workspace registration (multi-workspace support)
CREATE TABLE IF NOT EXISTS workspaces (
  id            TEXT PRIMARY KEY,  -- Pumble workspaceId
  bot_token     TEXT NOT NULL,
  bot_user_id   TEXT NOT NULL,
  app_key       TEXT NOT NULL,
  installed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  active        INTEGER NOT NULL DEFAULT 1
);

-- Standup configuration
CREATE TABLE IF NOT EXISTS standups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  channel_id    TEXT NOT NULL,      -- channel to post summaries
  channel_name  TEXT NOT NULL,      -- display name (cached)
  cron_expr     TEXT NOT NULL,      -- e.g. "0 9 * * 1,2,3,4,5"
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  reminder_mins INTEGER NOT NULL DEFAULT 30,   -- minutes before reminder
  cutoff_mins   INTEGER NOT NULL DEFAULT 120,  -- minutes before forced cutoff
  active        INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT NOT NULL,      -- userId who created it
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, name)
);

-- Questions for each standup
CREATE TABLE IF NOT EXISTS questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  standup_id    INTEGER NOT NULL REFERENCES standups(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  text          TEXT NOT NULL,
  is_blocker    INTEGER NOT NULL DEFAULT 0  -- 1 = aggregated in blockers section
);

-- Participants in each standup
CREATE TABLE IF NOT EXISTS participants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  standup_id    INTEGER NOT NULL REFERENCES standups(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,       -- Pumble userId
  added_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(standup_id, user_id)
);

-- Individual standup runs (one per trigger)
CREATE TABLE IF NOT EXISTS runs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  standup_id         INTEGER NOT NULL REFERENCES standups(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'COLLECTING',  -- COLLECTING | COMPLETE | INTERRUPTED
  triggered_by       TEXT NOT NULL DEFAULT 'schedule',    -- schedule | manual
  triggered_at       TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at       TEXT,
  summary_msg_id     TEXT,   -- message ID of posted summary (for late-response editing)
  summary_channel_id TEXT    -- channel where summary was posted (needed for editMessage)
);

-- Individual responses per run
CREATE TABLE IF NOT EXISTS responses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  answers       TEXT NOT NULL,       -- JSON array of strings, one per question
  responded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_skipped    INTEGER NOT NULL DEFAULT 0,  -- 1 = user typed "skip"
  is_late       INTEGER NOT NULL DEFAULT 0,  -- 1 = responded after run COMPLETE
  streak        INTEGER NOT NULL DEFAULT 0,  -- consecutive response days
  UNIQUE(run_id, user_id)
);
```

## Indexes

```sql
-- 001_initial.sql
CREATE INDEX IF NOT EXISTS idx_standups_workspace ON standups(workspace_id);
CREATE INDEX IF NOT EXISTS idx_questions_standup ON questions(standup_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_participants_standup ON participants(standup_id);
CREATE INDEX IF NOT EXISTS idx_runs_standup ON runs(standup_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_responses_run ON responses(run_id);

-- 002_add_indexes.sql (performance)
CREATE INDEX IF NOT EXISTS idx_responses_user ON responses(user_id);
CREATE INDEX IF NOT EXISTS idx_runs_standup_status ON runs(standup_id, status);
CREATE INDEX IF NOT EXISTS idx_responses_run_late ON responses(run_id, is_late);
```

## Schema Initialization (Migration Runner)

```typescript
// src/db/schema.ts — migration-based schema management
import Database from 'better-sqlite3';

// Tracks applied migrations in `schema_version` table
// Reads numbered SQL files from src/db/migrations/ (e.g., 001_initial.sql, 002_add_indexes.sql)
// Each migration runs in a transaction; version recorded on success

export function initializeDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);  // applies pending migrations from migrations/ dir
  return db;
}
```

WAL mode enables concurrent reads. Foreign keys enforced for cascade deletes.

**Migration files:** `src/db/migrations/001_initial.sql` (6 tables + indexes), `002_add_indexes.sql` (performance indexes). Do NOT edit existing migration files — always create a new numbered file.

## Common Queries

### List standups for a workspace (with participant count)

```sql
SELECT s.*, COUNT(p.id) AS participant_count
FROM standups s
LEFT JOIN participants p ON p.standup_id = s.id
WHERE s.workspace_id = ?
GROUP BY s.id
ORDER BY s.name;
```

### Get standup by name (case-insensitive)

```sql
SELECT * FROM standups
WHERE workspace_id = ? AND name = ? COLLATE NOCASE;
```

### Get all active standups (for loading cron jobs)

```sql
SELECT * FROM standups WHERE active = 1;
```

### Get questions and participants

```sql
-- Questions (ordered)
SELECT * FROM questions WHERE standup_id = ? ORDER BY sort_order;

-- Participants (user IDs only)
SELECT user_id FROM participants WHERE standup_id = ?;
```

### Create a new run

```sql
INSERT INTO runs (standup_id, triggered_by) VALUES (?, ?);
-- returns: lastInsertRowid
```

### Store a response

```sql
INSERT OR REPLACE INTO responses (run_id, user_id, answers, is_skipped, is_late, streak)
VALUES (?, ?, ?, ?, ?, ?);
-- answers is JSON: '["Did X", "Will do Y", "No blockers"]'
-- is_skipped: 1 if user typed "skip", 0 otherwise
-- is_late: 1 if run was already COMPLETE when response came
-- streak: consecutive non-skipped response count
```

### Get run status (responded vs missing)

```sql
-- Who responded
SELECT user_id FROM responses WHERE run_id = ?;

-- All responses with details
SELECT * FROM responses WHERE run_id = ?;

-- Missing = participants minus responded (computed in app code)
```

### Get COLLECTING runs (crash recovery)

```sql
SELECT * FROM runs WHERE status = 'COLLECTING';
```

### Complete a run

```sql
UPDATE runs
SET status = 'COMPLETE',
    completed_at = datetime('now'),
    summary_msg_id = ?,
    summary_channel_id = ?
WHERE id = ?;
```

### Get latest run for a standup

```sql
SELECT * FROM runs WHERE standup_id = ?
ORDER BY triggered_at DESC LIMIT 1;
```

### Get run history with response counts

```sql
SELECT
  r.id,
  r.triggered_at,
  r.status,
  r.triggered_by,
  COUNT(resp.id) AS response_count,
  (SELECT COUNT(*) FROM participants WHERE standup_id = r.standup_id) AS total_participants
FROM runs r
LEFT JOIN responses resp ON resp.run_id = r.id
WHERE r.standup_id = ?
GROUP BY r.id
ORDER BY r.triggered_at DESC
LIMIT ?;
```

### Aggregate blockers from a run

```sql
SELECT
  resp.user_id,
  json_extract(resp.answers, '$[' || q.sort_order || ']') AS blocker_text
FROM responses resp
JOIN runs r ON r.id = resp.run_id
JOIN questions q ON q.standup_id = r.standup_id AND q.is_blocker = 1
WHERE resp.run_id = ?
  AND resp.is_skipped = 0
  AND json_extract(resp.answers, '$[' || q.sort_order || ']') IS NOT NULL
  AND json_extract(resp.answers, '$[' || q.sort_order || ']') != ''
  AND LOWER(json_extract(resp.answers, '$[' || q.sort_order || ']'))
      NOT IN ('none', 'no', 'n/a', 'nope', '-', 'nothing');
```

### Get user streak (consecutive non-skipped responses)

```sql
SELECT resp.is_skipped
FROM responses resp
JOIN runs r ON r.id = resp.run_id
WHERE r.standup_id = ? AND resp.user_id = ?
ORDER BY r.triggered_at DESC
LIMIT 30;
-- Then iterate in app code: count consecutive is_skipped=0 from most recent
```

### Pause/Resume a standup

```sql
UPDATE standups SET active = 0 WHERE id = ?;  -- pause
UPDATE standups SET active = 1 WHERE id = ?;  -- resume
```

### Update questions (replace all, transactional)

```sql
-- In a transaction:
DELETE FROM questions WHERE standup_id = ?;
INSERT INTO questions (standup_id, sort_order, text, is_blocker) VALUES (?, ?, ?, ?);
-- Repeated for each question
```

### Delete all workspace data (on APP_UNINSTALLED)

```sql
-- In a transaction:
-- For each standup in workspace:
DELETE FROM responses WHERE run_id IN (SELECT id FROM runs WHERE standup_id = ?);
DELETE FROM runs WHERE standup_id = ?;
DELETE FROM questions WHERE standup_id = ?;
DELETE FROM participants WHERE standup_id = ?;
-- Then:
DELETE FROM standups WHERE workspace_id = ?;
DELETE FROM workspaces WHERE id = ?;
```

### Delete a standup (cascade handles cleanup)

```sql
DELETE FROM standups WHERE id = ?;
```

## TypeScript Types

```typescript
// src/types.ts

interface Workspace {
  id: string;
  bot_token: string;
  bot_user_id: string;
  app_key: string;
  installed_at: string;
  active: number;
}

interface Standup {
  id: number;
  workspace_id: string;
  name: string;
  channel_id: string;
  channel_name: string;
  cron_expr: string;
  timezone: string;
  reminder_mins: number;
  cutoff_mins: number;
  active: number;
  created_by: string;
  created_at: string;
}

interface StandupWithCount extends Standup {
  participant_count: number;
}

interface NewStandup {
  workspace_id: string;
  name: string;
  channel_id: string;
  channel_name: string;
  cron_expr: string;
  timezone: string;
  reminder_mins: number;
  cutoff_mins: number;
  created_by: string;
}

interface Question {
  id: number;
  standup_id: number;
  sort_order: number;
  text: string;
  is_blocker: number;  // 0 or 1
}

interface NewQuestion {
  text: string;
  sort_order: number;
  is_blocker: number;  // 0 or 1
}

interface Run {
  id: number;
  standup_id: number;
  status: 'COLLECTING' | 'COMPLETE' | 'INTERRUPTED';
  triggered_by: string;
  triggered_at: string;
  completed_at: string | null;
  summary_msg_id: string | null;
  summary_channel_id: string | null;
}

interface RunSummary {
  id: number;
  triggered_at: string;
  status: string;
  triggered_by: string;
  response_count: number;
  total_participants: number;
}

interface Response {
  id: number;
  run_id: number;
  user_id: string;
  answers: string;      // JSON string — use JSON.parse()
  responded_at: string;
  is_skipped: number;   // 0 or 1
  is_late: number;      // 0 or 1
  streak: number;
}

interface BlockerEntry {
  user_id: string;
  blocker_text: string;
}

// In-memory types (not persisted)
interface PendingPrompt {
  runId: number;
  standupId: number;
  userId: string;
  channelId: string;
  messageId: string;
  sentAt: Date;
  questions: Question[];
  workspaceId: string;
}

interface ParsedResponse extends Omit<Response, 'answers'> {
  answers: string[];
}

interface ActiveRun {
  runId: number;
  standupId: number;
  standup: Standup;
  questions: Question[];
  participants: string[];
  reminderTimer?: NodeJS.Timeout | undefined;
  cutoffTimer?: NodeJS.Timeout | undefined;
}
```

## TypeScript DB Helper Interface

```typescript
// src/db/index.ts — StandupDB class

interface StandupDB {
  close(): void;

  // Health & Maintenance
  healthCheck(): void;                              // SELECT 1 — throws on failure
  integrityCheck(): string;                         // PRAGMA integrity_check
  getCollectingRunForStandup(standupId: number): Run | undefined;  // idempotency guard
  markRunInterrupted(runId: number): void;          // graceful shutdown
  cleanupOldRuns(retentionDays: number): number;    // data retention, returns deleted count

  // Workspaces
  upsertWorkspace(ws: Workspace): void;
  getWorkspace(workspaceId: string): Workspace | undefined;
  deleteWorkspace(workspaceId: string): void;

  // Standups
  createStandup(standup: NewStandup): number;  // returns standup ID
  getStandupById(id: number): Standup | undefined;
  getStandupByName(workspaceId: string, name: string): Standup | undefined;
  getStandupsByWorkspace(workspaceId: string): StandupWithCount[];
  getAllActiveStandups(): Standup[];
  updateStandupActive(id: number, active: boolean): void;
  deleteStandup(id: number): void;

  // Questions
  getQuestions(standupId: number): Question[];
  replaceQuestions(standupId: number, questions: NewQuestion[]): void;  // transactional

  // Participants
  getParticipants(standupId: number): string[];  // userIds
  addParticipant(standupId: number, userId: string): void;  // INSERT OR IGNORE
  removeParticipant(standupId: number, userId: string): void;

  // Runs
  createRun(standupId: number, triggeredBy: string): number;  // returns run ID
  getRun(runId: number): Run | undefined;
  completeRun(runId: number, summaryMsgId: string, summaryChannelId: string): void;
  getLatestRun(standupId: number): Run | undefined;
  getCollectingRuns(): Run[];  // for crash recovery
  getRunHistory(standupId: number, limit?: number): RunSummary[];

  // Responses
  storeResponse(runId: number, userId: string, answers: string[], isSkipped: boolean, isLate: boolean, streak: number): void;
  getResponses(runId: number): Response[];
  getRespondedUserIds(runId: number): string[];
  getBlockers(runId: number): BlockerEntry[];
  getUserStreak(standupId: number, userId: string): number;

  // Cleanup
  deleteWorkspaceData(workspaceId: string): void;  // transactional, full cascade
}
```

Singleton access via `getDB()` / `closeDB()`. DB path from `process.env.DB_PATH` (default: `./standup.db`).

## Notes

- `answers` column stores JSON array of strings. Use `JSON.parse()` / `JSON.stringify()` in app code.
- `is_blocker` flag on questions lets the summary builder know which answers to aggregate into the blockers section.
- `is_skipped` flag on responses marks "skip" commands — skipped users shown separately in summary.
- `is_late` flag on responses marks answers received after the run was already COMPLETE — late responses trigger summary message editing.
- `streak` on responses tracks consecutive non-skipped responses. Computed by `getUserStreak()` counting backward from most recent response.
- `summary_channel_id` on runs (added beyond original spec) is needed because `editMessage()` requires both message ID and channel ID.
- `UNIQUE(workspace_id, name)` on standups ensures no duplicate names per workspace. Name lookup is case-insensitive (`COLLATE NOCASE`).
- `UNIQUE(run_id, user_id)` on responses uses `INSERT OR REPLACE` to handle duplicate/late submissions gracefully.
- All timestamps stored as ISO 8601 strings (SQLite doesn't have native datetime).
- Uses `better-sqlite3` for synchronous, simple SQLite access in Node.js.
- WAL journal mode enabled for concurrent read performance.
- Foreign keys enabled; cascade deletes propagate from standups to questions/participants/runs/responses.
- `deleteWorkspaceData()` uses explicit deletes in a transaction (not relying on cascade from workspace deletion, since some standups reference workspace_id as TEXT, not strict FK).
- Blocker aggregation query excludes trivial answers: "none", "no", "n/a", "nope", "-", "nothing" (case-insensitive).
