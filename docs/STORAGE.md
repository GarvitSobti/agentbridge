# SQLite storage

Status: implemented local persistence adapter, now used by the [authenticated loopback relay](LOCAL_RELAY.md). Real agent connections and cross-machine deployment remain unimplemented.

## Try the restart demonstration

```sh
npm ci
npm run check
npm run demo:storage
```

The demo creates a synthetic request, accepts it using a simulated human principal, closes its connection, and opens the same database again. It verifies that the accepted state survives and that retrying the original create command returns the original result without creating another request. Inbox events can be read after a saved cursor.

Synthetic data remains in `.agent-bridge/storage-demo.db` for inspection. Each run uses a new request key. The directory and SQLite sidecar files are ignored by Git. The demo does not run assistants, verify credentials, or edit project code.

## Store interface

The implementation is [SqliteStore](../src/storage/sqlite-store.ts). Storage uses Node.js 24.x's built-in `node:sqlite`, with no additional storage package or native addon installation. The separate MCP adapter adds SDK/Zod runtime dependencies. Early Node 24 releases emit SQLite and type-stripping experimental warnings. Node type definitions are pinned development tooling.

```js
import { SqliteStore } from './src/storage/sqlite-store.ts';

const workspace = {
  id: 'crm',
  repository: 'https://example.com/synthetic-crm.git',
  participants: ['alice', 'bob'],
};
const alice = { workspaceId: 'crm', participantId: 'alice', role: 'agent' };
const store = new SqliteStore('./local-state.db', workspace);
try {
  const result = store.execute(alice, {
    type: 'request.create',
    retryKey: 'task-001',
    recipientId: 'bob',
    title: 'Expose severity',
    body: 'Task creation needs a severity field.',
  });
  console.log(result.request.id);
} finally {
  store.close();
}
```

Principal objects in this example are simulated trusted identities, not proof of authentication. A future relay must authenticate credentials and establish their workspace, participant, and role before calling the store. Do not accept a role field directly from a network task payload.

| Method | Behavior |
| --- | --- |
| `new SqliteStore(filename, workspace, options?)` | Opens the file, applies supported migrations, and initializes or verifies the bound workspace. Its parent directory must already exist. |
| `execute(principal, command)` | Runs domain rules against the latest committed state and atomically saves a successful command. |
| `getRequest(principal, requestId)` | Returns the current request under the domain read policy. |
| `inbox(principal)` | Returns active requests addressed to that participant. |
| `events(principal, after?, limit?)` | Returns bounded event catch-up using the domain cursor rules. |
| `close()` | Closes the connection. Repeated calls are safe; further operations reject with `CLOSED`. |

Options are server-owned. `busyTimeoutMs` defaults to 5,000 and accepts integers from 0 through 30,000. `environment` can supply trusted IDs, time, and hashing for an embedding application or test. These options must not come from peer messages.

Reopening an existing workspace requires the same repository identity and participant pair. Reordering those two participant IDs is allowed; silently replacing membership or the repository is rejected. Database internals key rows by workspace, but the first product workflow remains one workspace and two people per relay.

## Transaction boundary

Each mutation performs:

1. Validate the trusted principal against the configured workspace.
2. Acquire `BEGIN IMMEDIATE` before loading state, so competing writers cannot work from the same stale snapshot.
3. Load the current requests, audit events, and retry receipts.
4. Run the shared domain executor.
5. For a new successful command, save the changed request, one audit event, one retry receipt, and the workspace revision.
6. Commit all writes together; roll back the complete transaction on a domain or SQL error.

An exact successful retry returns its stored result without inserting another event or advancing state. Its original result may be older than the current request; call `getRequest` when current state is required. A lock timeout returns `STORAGE_BUSY`; the caller may retry with the same command and key after the writer finishes. There is no automatic retry loop or external side effect to repeat.

Read methods use a read transaction across all their queries, so they see one consistent database snapshot. SQL values are bound parameters; task text is never interpreted as SQL.

## Schema and migrations

Migration definitions live in [migrations.ts](../src/storage/migrations.ts). Version 1 creates:

| Table | Contents |
| --- | --- |
| `workspaces` | Repository/participant configuration, domain schema version, and commit revision |
| `requests` | Current request JSON, version, and creation order; decisions, messages, and completion remain inside the request |
| `events` | Append-only application audit events, keyed by workspace and cursor |
| `retry_receipts` | Original command results and hashes, uniquely keyed by workspace, participant, role, operation, and retry key |

The adapter changes existing request rows and appends only the new event and receipt. SQLite foreign keys and unique constraints supplement domain rules. Basic stored-envelope and event/receipt-count checks reject inconsistent state instead of overwriting it. This is not a full integrity audit or protection against an attacker who can edit the database file.

The database has an application ID (`AGBR`) and a `user_version` migration marker. Initial migration DDL and its version marker commit together. Migration 2 appends a credentials table for scoped token hashes, role/participant metadata, and revocation; task state from schema 1 is preserved. Trusted local operator methods issue/revoke credentials, while authenticate returns a registry-derived principal or null. Those methods do not expose administration over HTTP. Migration 3 adds a browser-access table with workspace-bound invite and session hashes and expiry times. Redeeming an invite atomically replaces its hash with a session hash. Reopening the current version is idempotent. A nonempty unrecognized file or a newer schema is rejected. Existing data is never reset to make initialization succeed. Future migrations must append a version; editing a shipped migration is not a migration strategy.

File-backed connections use WAL mode and `synchronous=FULL`. The SQLite database and its WAL/SHM files belong on a local filesystem managed by one relay host. Do not put them on a network share or allow multiple hosts to share them. For a backup, use an SQLite-aware backup procedure or stop writers and close connections first; copying only a live `.db` can miss committed WAL data.

## Errors and limits

Domain errors keep their original codes. Storage errors use `StoreError.code`: `STORAGE_BUSY`, `SCHEMA_TOO_NEW`, `FOREIGN_DATABASE`, `WORKSPACE_MISMATCH`, `CORRUPT_STATE`, `CLOSED`, `STATE_CONFLICT`, or `STORAGE_FAILURE`. Error causes are diagnostic details for trusted code; a future API must redact them before returning errors or logs to clients.

The API is synchronous. Lock waits and domain execution block the calling event loop for their duration. The reference domain still loads and copies workspace history; retention, pagination of stored histories, and high-volume optimization are not implemented. The default timeout is bounded, but this is a two-person proof of concept rather than a performance claim.

Stored task data is not encrypted. Local filesystem permissions, backup handling, and relay-host access control remain the operator's responsibility. Credential plaintext is never stored in SQLite; local profile files are separate from the database and repository. Remote provisioning and transport security are still outside this storage layer.

## Verified failure scenarios

Storage tests use real temporary SQLite files. They cover connection reopen, durable retry receipts and decisions, SQL fault rollback after partial writes, transactional migration failure, workspace isolation, lock timeout recovery, bound task text, and a killed child writer with an uncommitted transaction.

Worker-thread tests use independent connections to the same file and a release barrier to exercise competing writes. They verify that distinct creates are retained, duplicate commands commit once, and edits using the same request version yield one conflict. These tests do not establish behavior under power loss, storage hardware failure, a network filesystem, or real assistant sessions.
