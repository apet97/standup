import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';

const log = createLogger('schema');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function ensureSchemaVersionTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version     INTEGER PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
      filename    TEXT NOT NULL
    )
  `);
}

function getAppliedVersions(db: Database.Database): Set<number> {
  const rows = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version: number }[];
  return new Set(rows.map((r) => r.version));
}

function getMigrationFiles(): { version: number; filename: string; filepath: string }[] {
  // In production (compiled), migrations are in dist/db/migrations
  // In dev (ts-node), migrations are in src/db/migrations
  let migrationsDir = MIGRATIONS_DIR;

  // Check if compiled directory exists, fallback to source
  if (!fs.existsSync(migrationsDir)) {
    migrationsDir = path.join(__dirname, '..', '..', 'src', 'db', 'migrations');
  }
  if (!fs.existsSync(migrationsDir)) {
    log.warn({ dir: migrationsDir }, 'Migrations directory not found');
    return [];
  }

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return files.map((filename) => {
    const match = filename.match(/^(\d+)_/);
    if (!match) {
      throw new Error(`Invalid migration filename: ${filename} (must start with NNN_)`);
    }
    return {
      version: parseInt(match[1]!, 10),
      filename,
      filepath: path.join(migrationsDir, filename),
    };
  });
}

function runMigrations(db: Database.Database): void {
  ensureSchemaVersionTable(db);
  const applied = getAppliedVersions(db);
  const migrations = getMigrationFiles();

  const pending = migrations.filter((m) => !applied.has(m.version));
  if (pending.length === 0) {
    return;
  }

  log.info({ count: pending.length }, 'Running pending migrations');

  for (const migration of pending) {
    const sql = fs.readFileSync(migration.filepath, 'utf8');

    const runMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_version (version, filename) VALUES (?, ?)').run(
        migration.version,
        migration.filename
      );
    });

    try {
      runMigration();
      log.info({ version: migration.version, filename: migration.filename }, 'Applied migration');
    } catch (error) {
      log.error({ err: error, version: migration.version, filename: migration.filename }, 'Migration failed');
      throw error;
    }
  }
}

export function initializeDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}
