import type { AppDataDatabase } from './types'

export function initializeAppDataSchema(db: AppDataDatabase): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS conversations (
      id text PRIMARY KEY NOT NULL,
      workspace_path text,
      title text NOT NULL,
      conversation_instructions text NOT NULL DEFAULT '',
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      archived integer NOT NULL DEFAULT 0,
      settings text NOT NULL,
      source_type text NOT NULL DEFAULT 'local',
      source_channel_account_id text,
      source_external_chat_id text
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_workspace_path_updated_at
      ON conversations (workspace_path, updated_at DESC);

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
      ,origin_type text NOT NULL DEFAULT 'local'
      ,origin_channel_account_id text
      ,origin_external_chat_id text
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      media_type text NOT NULL,
      size integer NOT NULL,
      created_at integer NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automations (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      prompt text NOT NULL,
      workspace_path text NOT NULL,
      provider_id text NOT NULL,
      model_id text NOT NULL,
      allowed_skills text NOT NULL,
      allowed_mcp_servers text NOT NULL,
      permission_policy text NOT NULL,
      schedule text NOT NULL,
      enabled integer NOT NULL,
      next_run_at integer,
      last_run_at integer,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_automations_due
      ON automations (enabled, next_run_at);

    CREATE TABLE IF NOT EXISTS automation_runs (
      id text PRIMARY KEY NOT NULL,
      automation_id text NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
      scheduled_at integer NOT NULL,
      started_at integer,
      finished_at integer,
      status text NOT NULL,
      read_at integer,
      task_id text,
      conversation_id text,
      turn_id text,
      summary text,
      error_code text,
      error_message text,
      created_at integer NOT NULL,
      UNIQUE (automation_id, scheduled_at)
    );

    CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_started
      ON automation_runs (automation_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS channel_accounts (
      id text PRIMARY KEY NOT NULL,
      channel_type text NOT NULL,
      display_name text NOT NULL,
      credential_ref text NOT NULL,
      owner_user_id text,
      default_workspace_path text,
      permission_mode text NOT NULL DEFAULT 'hybrid',
      enabled integer NOT NULL DEFAULT 0,
      status text NOT NULL,
      last_error text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_accounts_type ON channel_accounts(channel_type);

    CREATE TABLE IF NOT EXISTS channel_pairings (
      id text PRIMARY KEY NOT NULL,
      channel_account_id text NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
      external_user_id text NOT NULL,
      external_display_name text NOT NULL,
      status text NOT NULL,
      requested_at integer NOT NULL,
      expires_at integer,
      approved_at integer
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_pairings_identity ON channel_pairings(channel_account_id, external_user_id);

    CREATE TABLE IF NOT EXISTS channel_sessions (
      channel_account_id text NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
      external_chat_id text NOT NULL,
      active_conversation_id text NOT NULL REFERENCES conversations(id),
      current_workspace_path text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      PRIMARY KEY (channel_account_id, external_chat_id)
    );

    CREATE TABLE IF NOT EXISTS channel_message_receipts (
      id text PRIMARY KEY NOT NULL,
      channel_account_id text NOT NULL,
      external_chat_id text NOT NULL,
      external_message_id text NOT NULL,
      direction text NOT NULL,
      local_message_id text,
      status text NOT NULL,
      part_index integer,
      part_count integer,
      last_error text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      UNIQUE (channel_account_id, external_message_id, direction, part_index)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_receipts_idempotency
      ON channel_message_receipts (channel_account_id, external_message_id, direction, COALESCE(part_index, -1));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_receipts_outbound_local_message
      ON channel_message_receipts (channel_account_id, local_message_id)
      WHERE direction = 'outbound' AND local_message_id IS NOT NULL;
  `)
}
