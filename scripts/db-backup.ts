#!/usr/bin/env npx tsx
/**
 * SQLite database backup script.
 * Uses the SQLite backup API (safe for WAL mode).
 *
 * Usage: npx tsx scripts/db-backup.ts [source] [destination]
 *   source:      path to the DB file (default: $DB_PATH or ./standup.db)
 *   destination: path for backup file (default: <source>.bak)
 */

import Database from 'better-sqlite3';
import path from 'node:path';

const source = process.argv[2] || process.env['DB_PATH'] || './standup.db';
const destination = process.argv[3] || `${source}.bak`;

try {
  const db = new Database(source, { readonly: true });
  db.backup(path.resolve(destination))
    .then(() => {
      console.log(`Backup complete: ${source} -> ${destination}`);
      db.close();
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('Backup failed:', err);
      db.close();
      process.exit(1);
    });
} catch (err) {
  console.error(`Failed to open database at ${source}:`, err);
  process.exit(1);
}
