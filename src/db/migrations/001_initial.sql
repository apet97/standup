-- Initial schema
CREATE TABLE IF NOT EXISTS workspaces (
  id            TEXT PRIMARY KEY,
  bot_token     TEXT NOT NULL,
  bot_user_id   TEXT NOT NULL,
  app_key       TEXT NOT NULL,
  installed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS standups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  channel_name  TEXT NOT NULL,
  cron_expr     TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  reminder_mins INTEGER NOT NULL DEFAULT 30,
  cutoff_mins   INTEGER NOT NULL DEFAULT 120,
  active        INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  standup_id    INTEGER NOT NULL REFERENCES standups(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  text          TEXT NOT NULL,
  is_blocker    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS participants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  standup_id    INTEGER NOT NULL REFERENCES standups(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  added_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(standup_id, user_id)
);

CREATE TABLE IF NOT EXISTS runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  standup_id      INTEGER NOT NULL REFERENCES standups(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'COLLECTING',
  triggered_by    TEXT NOT NULL DEFAULT 'schedule',
  triggered_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT,
  summary_msg_id  TEXT,
  summary_channel_id TEXT
);

CREATE TABLE IF NOT EXISTS responses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  answers       TEXT NOT NULL,
  responded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_skipped    INTEGER NOT NULL DEFAULT 0,
  is_late       INTEGER NOT NULL DEFAULT 0,
  streak        INTEGER NOT NULL DEFAULT 0,
  UNIQUE(run_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_standups_workspace ON standups(workspace_id);
CREATE INDEX IF NOT EXISTS idx_questions_standup ON questions(standup_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_participants_standup ON participants(standup_id);
CREATE INDEX IF NOT EXISTS idx_runs_standup ON runs(standup_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_responses_run ON responses(run_id);
