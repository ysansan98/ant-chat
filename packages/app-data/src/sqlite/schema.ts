import type { AppDataDatabase } from './types'

export function initializeAppDataSchema(db: AppDataDatabase): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS conversations (
      id text PRIMARY KEY NOT NULL,
      workspace_path text,
      title text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      settings text NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_workspace_path_updated_at
      ON conversations (workspace_path, updated_at);

    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
      ON conversations (updated_at);

    CREATE TABLE IF NOT EXISTS messages (
      id text PRIMARY KEY NOT NULL,
      conv_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role text NOT NULL,
      content text NOT NULL,
      created_at integer NOT NULL,
      status text NOT NULL,
      images text DEFAULT '[]',
      attachments text DEFAULT '[]',
      reasoning_content text,
      tool_calls text DEFAULT NULL,
      model_info text DEFAULT NULL,
      usage text DEFAULT NULL
    );
  `)
}
