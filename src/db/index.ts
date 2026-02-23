import Database from 'better-sqlite3';
import { initializeDatabase } from './schema';
import type {
  Workspace,
  Standup,
  StandupWithCount,
  NewStandup,
  Question,
  NewQuestion,
  Run,
  RunSummary,
  Response,
  BlockerEntry,
} from '../types';

export class StandupDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = initializeDatabase(dbPath);
  }

  close(): void {
    this.db.close();
  }

  healthCheck(): void {
    this.db.prepare('SELECT 1').get();
  }

  integrityCheck(): string {
    const result = this.db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    return result.integrity_check;
  }

  getCollectingRunForStandup(standupId: number): Run | undefined {
    return this.db
      .prepare("SELECT * FROM runs WHERE standup_id = ? AND status = 'COLLECTING' LIMIT 1")
      .get(standupId) as Run | undefined;
  }

  markRunInterrupted(runId: number): void {
    this.db
      .prepare(
        `UPDATE runs SET status = 'INTERRUPTED', completed_at = datetime('now') WHERE id = ?`
      )
      .run(runId);
  }

  // --- Workspaces ---

  upsertWorkspace(ws: Workspace): void {
    this.db
      .prepare(
        `INSERT INTO workspaces (id, bot_token, bot_user_id, app_key, active)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET
           bot_token = excluded.bot_token,
           bot_user_id = excluded.bot_user_id,
           app_key = excluded.app_key,
           active = 1`
      )
      .run(ws.id, ws.bot_token, ws.bot_user_id, ws.app_key);
  }

  getWorkspace(workspaceId: string): Workspace | undefined {
    return this.db
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(workspaceId) as Workspace | undefined;
  }

  deleteWorkspace(workspaceId: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  }

  // --- Standups ---

  createStandup(standup: NewStandup): number {
    const result = this.db
      .prepare(
        `INSERT INTO standups (workspace_id, name, channel_id, channel_name, cron_expr, timezone, reminder_mins, cutoff_mins, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        standup.workspace_id,
        standup.name,
        standup.channel_id,
        standup.channel_name,
        standup.cron_expr,
        standup.timezone,
        standup.reminder_mins,
        standup.cutoff_mins,
        standup.created_by
      );
    return result.lastInsertRowid as number;
  }

  getStandupById(id: number): Standup | undefined {
    return this.db.prepare('SELECT * FROM standups WHERE id = ?').get(id) as
      | Standup
      | undefined;
  }

  getStandupByName(workspaceId: string, name: string): Standup | undefined {
    return this.db
      .prepare('SELECT * FROM standups WHERE workspace_id = ? AND name = ? COLLATE NOCASE')
      .get(workspaceId, name) as Standup | undefined;
  }

  getStandupsByWorkspace(workspaceId: string): StandupWithCount[] {
    return this.db
      .prepare(
        `SELECT s.*, COUNT(p.id) AS participant_count
         FROM standups s
         LEFT JOIN participants p ON p.standup_id = s.id
         WHERE s.workspace_id = ?
         GROUP BY s.id
         ORDER BY s.name`
      )
      .all(workspaceId) as StandupWithCount[];
  }

  getAllActiveStandups(): Standup[] {
    return this.db
      .prepare('SELECT * FROM standups WHERE active = 1')
      .all() as Standup[];
  }

  updateStandupActive(id: number, active: boolean): void {
    this.db
      .prepare('UPDATE standups SET active = ? WHERE id = ?')
      .run(active ? 1 : 0, id);
  }

  deleteStandup(id: number): void {
    this.db.prepare('DELETE FROM standups WHERE id = ?').run(id);
  }

  // --- Questions ---

  getQuestions(standupId: number): Question[] {
    return this.db
      .prepare(
        'SELECT * FROM questions WHERE standup_id = ? ORDER BY sort_order'
      )
      .all(standupId) as Question[];
  }

  replaceQuestions(standupId: number, questions: NewQuestion[]): void {
    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM questions WHERE standup_id = ?').run(standupId);
      const insert = this.db.prepare(
        'INSERT INTO questions (standup_id, sort_order, text, is_blocker) VALUES (?, ?, ?, ?)'
      );
      for (const q of questions) {
        insert.run(standupId, q.sort_order, q.text, q.is_blocker);
      }
    });
    txn();
  }

  // --- Participants ---

  getParticipants(standupId: number): string[] {
    const rows = this.db
      .prepare('SELECT user_id FROM participants WHERE standup_id = ?')
      .all(standupId) as { user_id: string }[];
    return rows.map((r) => r.user_id);
  }

  addParticipant(standupId: number, userId: string): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO participants (standup_id, user_id) VALUES (?, ?)'
      )
      .run(standupId, userId);
  }

  removeParticipant(standupId: number, userId: string): void {
    this.db
      .prepare('DELETE FROM participants WHERE standup_id = ? AND user_id = ?')
      .run(standupId, userId);
  }

  // --- Runs ---

  createRun(standupId: number, triggeredBy: string): number {
    const result = this.db
      .prepare(
        'INSERT INTO runs (standup_id, triggered_by) VALUES (?, ?)'
      )
      .run(standupId, triggeredBy);
    return result.lastInsertRowid as number;
  }

  getRun(runId: number): Run | undefined {
    return this.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
      | Run
      | undefined;
  }

  completeRun(runId: number, summaryMsgId: string, summaryChannelId: string): void {
    this.db
      .prepare(
        `UPDATE runs SET status = 'COMPLETE', completed_at = datetime('now'), summary_msg_id = ?, summary_channel_id = ?
         WHERE id = ?`
      )
      .run(summaryMsgId, summaryChannelId, runId);
  }

  getLatestRun(standupId: number): Run | undefined {
    return this.db
      .prepare(
        'SELECT * FROM runs WHERE standup_id = ? ORDER BY triggered_at DESC LIMIT 1'
      )
      .get(standupId) as Run | undefined;
  }

  getCollectingRuns(): Run[] {
    return this.db
      .prepare("SELECT * FROM runs WHERE status = 'COLLECTING'")
      .all() as Run[];
  }

  getRunHistory(standupId: number, limit = 20): RunSummary[] {
    return this.db
      .prepare(
        `SELECT
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
         LIMIT ?`
      )
      .all(standupId, limit) as RunSummary[];
  }

  // --- Responses ---

  storeResponse(
    runId: number,
    userId: string,
    answers: string[],
    isSkipped: boolean,
    isLate: boolean,
    streak: number
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO responses (run_id, user_id, answers, is_skipped, is_late, streak)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(runId, userId, JSON.stringify(answers), isSkipped ? 1 : 0, isLate ? 1 : 0, streak);
  }

  getResponses(runId: number): Response[] {
    return this.db
      .prepare('SELECT * FROM responses WHERE run_id = ?')
      .all(runId) as Response[];
  }

  getRespondedUserIds(runId: number): string[] {
    const rows = this.db
      .prepare('SELECT user_id FROM responses WHERE run_id = ?')
      .all(runId) as { user_id: string }[];
    return rows.map((r) => r.user_id);
  }

  getBlockers(runId: number): BlockerEntry[] {
    return this.db
      .prepare(
        `SELECT
           resp.user_id,
           json_extract(resp.answers, '$[' || q.sort_order || ']') AS blocker_text
         FROM responses resp
         JOIN runs r ON r.id = resp.run_id
         JOIN questions q ON q.standup_id = r.standup_id AND q.is_blocker = 1
         WHERE resp.run_id = ?
           AND resp.is_skipped = 0
           AND json_extract(resp.answers, '$[' || q.sort_order || ']') IS NOT NULL
           AND json_extract(resp.answers, '$[' || q.sort_order || ']') != ''
           AND LOWER(json_extract(resp.answers, '$[' || q.sort_order || ']')) NOT IN ('none', 'no', 'n/a', 'nope', '-', 'nothing')`
      )
      .all(runId) as BlockerEntry[];
  }

  getUserStreak(standupId: number, userId: string): number {
    const rows = this.db
      .prepare(
        `SELECT resp.is_skipped
         FROM responses resp
         JOIN runs r ON r.id = resp.run_id
         WHERE r.standup_id = ? AND resp.user_id = ?
         ORDER BY r.id DESC
         LIMIT 30`
      )
      .all(standupId, userId) as { is_skipped: number }[];

    let streak = 0;
    for (const row of rows) {
      if (row.is_skipped === 0) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  cleanupOldRuns(retentionDays: number, chunkSize = 500): number {
    let totalDeleted = 0;
    const selectStmt = this.db.prepare(
      `SELECT id FROM runs WHERE completed_at IS NOT NULL AND completed_at < datetime('now', '-' || ? || ' days') LIMIT ?`
    );
    const deleteResponses = this.db.prepare('DELETE FROM responses WHERE run_id = ?');
    const deleteRun = this.db.prepare('DELETE FROM runs WHERE id = ?');

    // Process in chunks to avoid blocking the event loop for too long
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const rows = selectStmt.all(retentionDays, chunkSize) as { id: number }[];
      if (rows.length === 0) break;

      const chunk = this.db.transaction(() => {
        for (const row of rows) {
          deleteResponses.run(row.id);
          deleteRun.run(row.id);
        }
        return rows.length;
      });
      totalDeleted += chunk();
    }
    return totalDeleted;
  }

  deleteWorkspaceData(workspaceId: string): void {
    const txn = this.db.transaction(() => {
      const standups = this.db
        .prepare('SELECT id FROM standups WHERE workspace_id = ?')
        .all(workspaceId) as { id: number }[];

      for (const s of standups) {
        this.db.prepare('DELETE FROM responses WHERE run_id IN (SELECT id FROM runs WHERE standup_id = ?)').run(s.id);
        this.db.prepare('DELETE FROM runs WHERE standup_id = ?').run(s.id);
        this.db.prepare('DELETE FROM questions WHERE standup_id = ?').run(s.id);
        this.db.prepare('DELETE FROM participants WHERE standup_id = ?').run(s.id);
      }
      this.db.prepare('DELETE FROM standups WHERE workspace_id = ?').run(workspaceId);
      this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
    });
    txn();
  }
}

let dbInstance: StandupDB | null = null;

export function getDB(): StandupDB {
  if (!dbInstance) {
    const dbPath = process.env['DB_PATH'] || './standup.db';
    dbInstance = new StandupDB(dbPath);
  }
  return dbInstance;
}

export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
