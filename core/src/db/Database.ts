import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import type { PlatformConfig } from '../config.js';
import { runMigrations } from './migrations.js';

export function openDatabase(config: PlatformConfig): Database.Database {
  mkdirSync(dirname(config.database.sqlitePath), { recursive: true });

  const db = new Database(config.database.sqlitePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}
