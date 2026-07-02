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
      reasoning_content text,
      model_info text DEFAULT NULL,
      usage text DEFAULT NULL,
      turn_id text DEFAULT NULL,
      event_type text DEFAULT NULL,
      compacted_through_message_id text DEFAULT NULL,
      duration_ms integer DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      media_type text NOT NULL,
      size integer NOT NULL,
      created_at integer NOT NULL
    );
  `)
}
