import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type AppDatabase = Database.Database;

export function createDatabase(databasePath: string): AppDatabase {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_hash TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT,
      used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      duration REAL,
      relative_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, asset_id),
      UNIQUE(user_id, sha256)
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
      mime_type TEXT NOT NULL,
      expected_size INTEGER NOT NULL,
      expected_sha256 TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      duration REAL,
      total_chunks INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'assembling', 'completed', 'failed')),
      asset_record_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS upload_chunks (
      upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(upload_id, chunk_index)
    );

    CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_assets_user_created ON assets(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_uploads_user_created ON uploads(user_id, created_at DESC);
  `);
  return db;
}
