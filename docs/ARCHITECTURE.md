# Architecture

Status: the transport-independent domain and SQLite persistence are implemented; relay, MCP, and human CLI components remain proposed. See [the decisions](DECISIONS.md) for rationale, [the domain guide](DOMAIN.md) for lifecycle APIs, and [the storage guide](STORAGE.md) for transactions and recovery.

## System shape

One relay service and database serve a two-person workspace. Each machine runs a local MCP adapter for its assistant and a human terminal interface. Both interfaces call the same relay and shared domain rules.

```mermaid
flowchart TB
    subgraph A[Developer A machine]
        AgentA[Existing coding assistant]
        AdapterA[Local MCP adapter]
        HumanA[Human CLI]
        AgentA --> AdapterA
    end
    subgraph B[Developer B machine]
        AgentB[Existing coding assistant]
        AdapterB[Local MCP adapter]
        HumanB[Human CLI]
        AgentB --> AdapterB
    end
    AdapterA --> API[Relay API]
    AdapterB --> API
    HumanA --> API
    HumanB --> API
    API --> Domain[Authorization and domain rules]
    Domain --> Store[(SQLite: state and events)]
```

## Responsibilities

| Component | Responsibility | Boundary |
| --- | --- | --- |
| Domain layer | Validate identities, transitions, decision revisions, and retry keys | No HTTP, model calls, or shell execution |
| Relay API | Authenticate requests, validate payloads, invoke domain operations, return errors | No assistant launching or repository edits |
| SQLite store | Persist current state, messages, agreement revisions, and lifecycle events | One relay instance; local database, not a shared network filesystem |
| MCP adapter | Expose allowed inbox, request, reply, agreement, and completion actions | Agent credential cannot accept work or obtain human credentials |
| Human CLI | Inspect and accept or decline incoming requests | Distinct human credential, kept out of the assistant's configuration |

Implementation language: TypeScript. Runtime: Node.js 24.x. The domain has no platform imports; trusted adapters supply IDs, time, and SHA-256 hashing. The store uses Node's built-in SQLite, and the runtime helper supplies Node crypto and time defaults. Node type definitions are development tooling. Actual compatibility with the two participants' assistant clients and operating systems must still be verified.

## Request lifecycle

```text
pending --addressed human accepts--> accepted --assigned agent starts--> in_progress
   |                                    |                                  |
   +--addressed human declines--> declined                                  +--> completed
   |
   +--requesting human cancels--> cancelled

accepted or in_progress --either participating human cancels--> cancelled
```

Terminal states are completed, declined, and cancelled. Further work uses a new request referencing the old one. Active requests allow messages without implicitly changing their lifecycle state; terminal requests are read-only. Exact retries of earlier successful commands still return their original result without modifying current state.

Decisions are a separate revisioned record. Each participant's human or scoped agent may acknowledge an exact decision revision; this never substitutes for human task acceptance. Starting work requires all decision references attached to the request to have both participants' agreement on their current revision. A new revision clears current agreement and blocks further progress/completion transitions until re-agreed. It cannot automatically stop code already running locally; the agent learns of the change on its next inbox check.

Completion requires an assigned participant, a summary, repository-relative references, a branch, a full commit ID, and reported checks (including an explicit not-run outcome). A completion is self-reported. The relay does not fetch Git objects or independently run the tests in the first version.

## Minimal records

- Workspace: ID, canonical repository identity, creation time.
- Participant: ID, workspace ID, display name, declared ownership paths.
- Credential: hashed token, participant, workspace, human or agent role, revocation state.
- Request: ID, requester, recipient, description, state, selected refs, decision refs, version, retry key.
- Message: ID, request, author and role, bounded body, monotonically increasing event cursor, server time.
- Decision revision: decision ID, revision, selected interface text/refs, content hash, acknowledgments.
- Completion report: request, reporter, branch, commit, summary, check claims and references.
- Event: actor, request/decision ID, operation, before/after version, cursor, server time.

Use database transactions for each state change and event append. Do not implement full event sourcing: current state is stored directly and events provide an audit history. Retry keys are scoped to actor and operation; reusing a key with a different payload is an error. Version checks reject conflicting updates.

## Delivery and reconnects

The adapter explicitly requests events after its last cursor and deduplicates by event ID. Reading a message does not accept a task. Offline messages remain stored. No WebSocket or assistant-specific hook is required for the initial proof of concept. Add push delivery only after measuring the limitations of explicit checks.

## Trust and credentials

The relay operator and database are trusted with deliberately shared messages; end-to-end encryption is outside this first design. TLS is required for access beyond loopback. Never expose an unauthenticated development server to the internet.

Separate human and agent credentials are a server-side capability boundary, not protection from a fully compromised laptop. The human credential must not be passed to the MCP adapter, tool arguments, prompts, or logs. Provisioning, rotation, and local storage details need a dedicated implementation ADR before network testing.

Peer messages may contain misleading instructions. Display sender identity, role, and references; treat the content as untrusted input. The relay must never interpret message text as an executable command. Declared ownership is coordination metadata, not a filesystem sandbox.

## Proposed source layout

Current source and planned adapters:

```text
src/domain/       Implemented: shared state machine, role rules, and input validation
src/storage/      Implemented: SQLite transactions, migrations, and persistent state
src/runtime.ts    Implemented: server-owned IDs, time, and SHA-256 defaults
tests/            Implemented: domain and real-file SQLite tests
examples/         Implemented: synthetic domain and storage restart demos
src/relay/        Planned: loopback HTTP entry point
src/mcp/          Planned: local assistant-facing adapter
src/cli/          Planned: human control interface
```

Keep one package until separate publishing or deployment needs justify splitting it. Deployment and real assistant compatibility remain unverified.

The pure executor returns a complete next-state candidate and never writes it. The SQLite adapter reconstructs that reference state inside a transaction and persists the changed request, one event, one retry receipt, and workspace revision together. `BEGIN IMMEDIATE` serializes writers before they read state; request/workspace revision checks provide additional conflict detection. Read methods use a consistent read transaction.

Requests contain revisioned decisions, messages, and completion reports as JSON. Events and retry receipts have separate tables and uniqueness constraints; workspace configuration and schema metadata are stored explicitly. Versioned migrations are transactional. Local file-backed connections use WAL mode with synchronous FULL. The synchronous adapter and unbounded reference histories are suitable for the small proof of concept, not a claim of high-volume performance. There is no network filesystem or multi-host database support.

Role checks currently operate on a trusted in-process Principal object. Authentication, credential verification, and human credential isolation are not implemented by this library; an API must establish that identity before calling it.
