// Append new migrations; never edit a migration that has shipped.
export const APPLICATION_ID = 0x41474252; // AGBR
export const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL CHECK(json_valid(config_json)),
        state_schema_version INTEGER NOT NULL CHECK(state_schema_version = 1),
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
      ) STRICT;
      CREATE TABLE requests (
        workspace_id TEXT NOT NULL,
        id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0),
        created_cursor INTEGER NOT NULL CHECK(created_cursor > 0),
        data_json TEXT NOT NULL CHECK(json_valid(data_json)),
        PRIMARY KEY(workspace_id, id),
        UNIQUE(workspace_id, created_cursor),
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
      ) STRICT;
      CREATE TABLE events (
        workspace_id TEXT NOT NULL,
        cursor INTEGER NOT NULL CHECK(cursor > 0),
        request_id TEXT NOT NULL,
        event_json TEXT NOT NULL CHECK(json_valid(event_json)),
        PRIMARY KEY(workspace_id, cursor),
        FOREIGN KEY(workspace_id, request_id) REFERENCES requests(workspace_id, id)
      ) STRICT;
      CREATE TABLE retry_receipts (
        workspace_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('human', 'agent')),
        operation TEXT NOT NULL,
        retry_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64),
        event_cursor INTEGER NOT NULL,
        result_json TEXT NOT NULL CHECK(json_valid(result_json)),
        PRIMARY KEY(workspace_id, participant_id, role, operation, retry_key),
        UNIQUE(workspace_id, event_cursor),
        FOREIGN KEY(workspace_id, event_cursor) REFERENCES events(workspace_id, cursor)
      ) STRICT;
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE credentials (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('human', 'agent')),
        token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
      ) STRICT;
    `,
  },
{
    version: 3,
    sql: `
      CREATE TABLE browser_access (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('invite', 'session')),
        token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
        expires_at INTEGER NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
      ) STRICT;
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE agent_pairs (
        workspace_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        code_hash TEXT UNIQUE,
        expires_at INTEGER NOT NULL,
        redeemed INTEGER NOT NULL DEFAULT 0 CHECK(redeemed IN (0, 1)),
        credential_id TEXT,
        PRIMARY KEY(workspace_id, participant_id),
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
        FOREIGN KEY(credential_id) REFERENCES credentials(id)
      ) STRICT;
    `,
  },
] as const;
