# Request domain API

Status: implemented domain prototype. A separate [SQLite adapter](STORAGE.md) supplies local persistence; network service, credential authentication, and real assistant connections remain unimplemented.

## Run it

Use Node.js 24.x:

```sh
npm ci
npm run check
npm run demo:domain
```

The demo uses simulated principals, a synthetic repository, and a placeholder commit. It shows domain transitions only; it does not execute an agent or verify code.

## Public entry points

The entry module is [src/domain/board.ts](../src/domain/board.ts). Data shapes are in [types.ts](../src/domain/types.ts).

- `createBoard(workspace)` validates one repository identity and exactly two distinct participant IDs.
- `execute(state, principal, command, environment)` returns `{ state, result }`, where `state` is the complete next-state candidate. It never mutates the input state or performs external effects.
- `readRequest(state, principal, requestId)` returns a defensive copy of a request.
- `readInbox(state, principal)` returns active requests addressed to that participant. Reading never accepts work.
- `readEvents(state, principal, after, limit)` returns workspace events after a cursor, with a maximum page size of 100.

`principal` contains a workspace ID, participant ID, and human or agent role. It must be created by trusted server code after authenticating a credential. Accepting a caller-supplied `role: human` at a future API boundary would bypass the intended security model. This library validates role rules; it cannot prove a human is at the keyboard.

`environment` supplies trusted `id()`, `now()`, and `sha256(text)` functions. The domain uses no HTTP, database, filesystem, model, or Node-specific imports. The demo supplies these functions through Node's crypto and clock APIs.

## Commands

All commands require `type` and a nonempty `retryKey`. Existing-request commands also require `requestId` and a positive `expectedVersion`.

| Command | Additional input | Rule |
| --- | --- | --- |
| `request.create` | `recipientId`, `title`, `body`, optional `references` | Recipient must be the other participant. Creates a pending request. |
| `request.accept` | None | Addressed human only; pending requests only. |
| `request.decline` | None | Addressed human only; pending requests only. |
| `request.start` | None | Assigned agent only; human acceptance and current decision agreements required. |
| `request.reply` | `body` | Either participant, human or agent; active requests only. |
| `request.cancel` | None | Requesting human while pending; either participating human after acceptance. |
| `decision.propose` | `text`, optional `references`, optional `decisionId` | Creates a decision or appends a revision to an existing one on this request. |
| `decision.agree` | `decisionId`, `revision`, `contentHash` | Records one acknowledgment per participant for that exact current revision. |
| `request.complete` | `branch`, full `commit`, `summary`, `checks`, optional `references` | Assigned agent only; in-progress work and current agreements required. |

Unknown command fields are rejected. A task cannot set its own requester identity, approval, status, server ID, or repository identity. Full Git IDs may be 40 or 64 hex characters; the domain does not check that those objects exist or are reachable.

References use portable repository-relative paths and optional full commit IDs. Limits include a 160-character title, 8,000-character body or decision, up to 20 references, and 1 to 20 completion check claims. Limits are character counts, not a substitute for a future HTTP byte limit or storage quota.

## Versions, retries, and decisions

Every successful mutation increments the request version and appends one event with a workspace cursor. Stale `expectedVersion` values fail before any state is committed.

Retry receipts are scoped to participant, role, operation, and key within the workspace. A repeated successful command with the same normalized payload returns the original result and adds no event. Reusing its key with different input fails. An earlier result can have an older request version than the current state: returning that receipt never rolls state back. Read the request again when current state is needed.

Failed commands leave no state or receipt behind. An operation that was rejected can be attempted again after resolving the problem. An exact retry of a completed command is still allowed after a request reaches a terminal state; new mutations are rejected.

Each decision retains its revision history. The content hash includes selected references as well as decision text. A new revision starts with no acknowledgments, even if the proposed text is unchanged. One participant's human and agent roles cannot count as two participants. Acknowledgments are workflow commitments; they are not proof that an assistant understood or followed a decision.

All attached current decisions must have both participants' agreement before start or completion. A mid-task revision blocks completion until re-agreed, but it does not stop code already executing outside the library. Updates become visible only when the caller reads them.

## Completion evidence

Completion records derive repository and reporter identity from trusted context. Each check has `command`, `outcome` (`passed`, `failed`, or `not_run`), and optional `details`. A not-run claim needs an explanation. Failed and not-run checks remain visible; they are not converted into passing evidence.

Every report is labeled `self_reported`. The domain does not execute the command, fetch the commit, or certify integration. A completed request means the assigned agent reported its work, not that the code is correct or safe to merge.

## Errors

`DomainError.code` is one of:

| Code | Meaning |
| --- | --- |
| `INVALID_INPUT` | Unknown fields, malformed IDs, invalid shapes, or exceeded limits |
| `FORBIDDEN` | Wrong workspace, participant, or role |
| `NOT_FOUND` | Request or decision absent from this workspace/request |
| `INVALID_STATE` | Invalid transition, duplicate agreement, or mutation of a terminal request |
| `VERSION_CONFLICT` | Caller used an outdated request version |
| `IDEMPOTENCY_CONFLICT` | Successful retry key reused with another payload |
| `STALE_DECISION` | Revision or content hash is no longer current |
| `DECISION_NOT_AGREED` | Required two-party agreement is missing |

## Storage contract and limitations

State contains requests, events, and retry receipts and can be serialized as JSON. Domain serialization tests establish encoding/decoding behavior; the separate SQLite adapter and storage tests verify persistence in actual database files.

A store must read the current state, execute the command, and commit the returned state atomically. Concurrent clients must not overwrite each other's snapshots. Events and retry receipts belong in that same transaction; the implemented SQLite adapter enforces this boundary. A future authentication layer must check credential revocation before calling the domain, including on a retry.

This reference model copies its state and retains histories without compaction. It is intended for the initial small proof of concept, not an optimized long-running service. Retention, authenticated endpoints, network inbox delivery, and MCP clients remain future work.
