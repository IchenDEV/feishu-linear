import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { createChildLogger } from "../logger.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const log = createChildLogger("db");

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb(dbPath: string) {
  if (_db) return _db;

  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  createTables(sqlite);

  _db = drizzle(sqlite, { schema });
  log.info({ path: dbPath }, "数据库已连接");
  return _db;
}

function createTables(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feishu_open_id TEXT NOT NULL UNIQUE,
      feishu_union_id TEXT,
      feishu_name TEXT,
      feishu_email TEXT,
      linear_user_id TEXT NOT NULL,
      linear_email TEXT,
      linear_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS linear_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TEXT,
      scope TEXT,
      app_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feishu_chat_id TEXT NOT NULL,
      feishu_thread_id TEXT NOT NULL UNIQUE,
      feishu_root_msg_id TEXT NOT NULL,
      linear_issue_id TEXT NOT NULL,
      linear_issue_identifier TEXT,
      linear_issue_url TEXT,
      linear_attachment_id TEXT,
      sync_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_thread_id INTEGER NOT NULL,
      feishu_msg_id TEXT NOT NULL UNIQUE,
      linear_comment_id TEXT NOT NULL UNIQUE,
      direction TEXT NOT NULL CHECK(direction IN ('feishu_to_linear', 'linear_to_feishu')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notification_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('team', 'project', 'initiative', 'view', 'personal')),
      linear_entity_id TEXT NOT NULL,
      linear_entity_name TEXT,
      feishu_chat_id TEXT,
      feishu_user_id TEXT,
      on_created INTEGER NOT NULL DEFAULT 1,
      on_updated INTEGER NOT NULL DEFAULT 1,
      on_completed INTEGER NOT NULL DEFAULT 0,
      on_comment INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      linear_project_id TEXT NOT NULL UNIQUE,
      linear_project_name TEXT,
      feishu_chat_id TEXT NOT NULL UNIQUE,
      auto_created INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_guidance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feishu_chat_id TEXT NOT NULL UNIQUE,
      guidance TEXT NOT NULL,
      default_team_id TEXT,
      default_project_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS processed_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL CHECK(source IN ('feishu', 'linear')),
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sync_threads_linear ON sync_threads(linear_issue_id);
    CREATE INDEX IF NOT EXISTS idx_sync_comments_feishu ON sync_comments(feishu_msg_id);
    CREATE INDEX IF NOT EXISTS idx_sync_comments_linear ON sync_comments(linear_comment_id);
    CREATE INDEX IF NOT EXISTS idx_notification_entity ON notification_configs(linear_entity_id);
    CREATE INDEX IF NOT EXISTS idx_processed_events_source ON processed_events(source, processed_at);
  `);
}

export type Db = ReturnType<typeof getDb>;
export { schema };
