# Architecture decision records

This is the append-only record of consequential decisions and their rationale. It describes design decisions, not evidence that a capability is implemented. Current component structure lives in [ARCHITECTURE.md](ARCHITECTURE.md).

Use statuses Proposed, Accepted, Rejected, and Superseded. Preserve old decisions and link the replacement when direction changes.

## ADR-001: Build a two-person open-source proof of concept

- Date: 2026-11-16
- Status: Accepted
- Context: The motivating problem is manual coordination between two developers' assistants on one shared microservice. Usefulness and willingness to pay are unproven. The project owner wants to test with a friend before commercial discovery.
- Decision: Limit the first proof of concept to two people, one repository, separate machines, and explicit requests. Release under MIT. Use a synthetic fixture before any private project material.
- Alternatives: Build a paid orchestration platform; support arbitrary teams and repositories; treat a demo as market validation.
- Rationale: This reproduces the original problem with a small, reviewable implementation and avoids premature commercial infrastructure.
- Consequences: No billing, enterprise identity, agent fleets, or claims of market fit. A successful trial supports further experimentation, not proof of demand.

## ADR-002: Use a deterministic relay with existing assistants

- Date: 2026-11-16
- Status: Accepted
- Context: The developers already have coding assistants. A separate model-powered coordinator adds cost and another source of interpretation errors.
- Decision: The relay stores structured requests, replies, decision revisions, and completion reports. Existing assistants perform reasoning and local code changes. Connect them through a local MCP adapter; provide a human CLI for approvals.
- Alternatives: Add a central LLM; require a new IDE; share full assistant sessions; run agents on the relay.
- Rationale: A mailbox can coordinate the first workflow without buying another model API integration or moving code execution.
- Consequences: No model API key for the relay. Assistant availability and compatibility are separate dependencies. Specific MCP SDK and transport details remain implementation choices to verify.

## ADR-003: Start with one TypeScript package and SQLite

- Date: 2026-11-16
- Status: Accepted
- Context: The first workload is a small persistent two-person inbox, not a high-volume multi-tenant service.
- Decision: Plan a TypeScript application targeting Node.js 24.x, one relay process, one local SQLite database, and shared domain logic for all adapters. Keep one package initially.
- Alternatives: Distributed microservices with queues; managed PostgreSQL from day one; ephemeral in-memory state.
- Rationale: This limits operational dependencies while preserving offline messages and a useful restart scenario. Shared domain logic makes authorization consistent across interfaces.
- Consequences: Do not mount SQLite as a shared network file or run multiple writers on different hosts. Driver choice and OS compatibility require verification. Revisit storage if measured concurrency or deployment requirements change.

## ADR-004: Enforce human acceptance as a distinct capability

- Date: 2026-11-16
- Status: Accepted
- Context: A peer request or an assistant's interpretation of consent must not authorize work on another developer's machine.
- Decision: Separate human and agent roles on the server. Only the addressed human may accept or decline incoming work. The human credential is not made available to the MCP adapter. The relay never runs shell commands or starts agents.
- Alternatives: A Boolean `humanApproved` field supplied by an agent; a shared all-powerful room token; automatic acceptance of trusted peers.
- Rationale: A server-enforced capability is stronger than a prompt convention and gives the receiving developer a clear decision point.
- Consequences: Additional credential handling and a human interface are required. This is not protection from a compromised laptop. Provisioning, rotation, and storage details remain open and must be recorded before network exposure.

## ADR-005: Receive updates through explicit inbox checks

- Date: 2026-11-16
- Status: Accepted
- Context: Assistant clients differ in their support for hooks, interruptions, and background activity. A message arriving at a server does not mean a running assistant reads it.
- Decision: Start with explicit inbox retrieval and resumable event cursors. Pending messages survive reconnects. No automatic agent wake-up or unbounded polling loop.
- Alternatives: Assume notifications interrupt every client; build editor-specific hooks first; use continuous agent loops.
- Rationale: This makes delivery behavior testable before depending on client-specific automation.
- Consequences: Humans may need to prompt an inbox check. Measure that friction during the pilot. Reconsider push or hooks only with evidence from the actual assistant pair.

## ADR-006: Version agreements and label completion evidence honestly

- Date: 2026-11-16
- Status: Accepted
- Context: Both agents can agree on an interface and then silently build against different revisions. An agent's completion message is not proof that two changes integrate.
- Decision: Record agreement against an exact decision revision, content hash, and selected Git references. A new revision needs new agreement. Completion includes a commit, summary, and reported checks labeled as self-reported. Store current state plus append-only lifecycle events transactionally.
- Alternatives: Mutable shared notes with no revision; a generic `done` flag; full event sourcing; relay-run integration environments.
- Rationale: Explicit references make stale assumptions and claims inspectable without taking responsibility for remote execution.
- Consequences: More metadata than a chat room, but no independent certification or automatic fetching of private Git objects. Revision changes cannot forcibly stop work already running on a laptop.

## ADR-007: Authentication and deployment details

- Date: 2026-11-16
- Status: Proposed
- Context: The two-person network test needs authentication, human/agent capability separation, and a reachable relay without disclosing private credentials.
- Progress: ADR-011 covers loopback credentials and ADR-014 accepts the operator-provisioned HTTPS pilot. Browser identity, automated pairing, and live cross-machine verification remain open.
- Proposal: Bind opaque, revocable credentials to a workspace, participant, and role; persist token hashes only. Require TLS beyond loopback, bounded payloads, and redacted logs. Provide operator-controlled membership for two participants rather than public signup.
- Alternatives to evaluate: A device approval flow; a separate local approval channel; authenticated private networking.
- Open questions: Initial provisioning, human credential storage, token rotation, revocation, backup handling, and hosting platform.
- Acceptance condition: Document the chosen flow, test role and workspace isolation, and verify that agent configuration and logs do not contain human credentials before cross-machine exposure.

## ADR-008: Start with a pure, transport-independent request domain

- Date: 2026-11-17
- Status: Accepted
- Context: The relay, human CLI, and MCP adapter must enforce the same lifecycle and role rules. Testing those rules should not require a server, database, or live assistant.
- Decision: Implement a pure command executor returning a complete next-state candidate and a result. Inject server-owned IDs, time, and SHA-256 hashing. Keep identity separate from command payloads. Retain decision revisions, structured events, and retry receipts in JSON-serializable reference state.
- Alternatives: Implement rules directly in HTTP handlers; have the domain authenticate credentials; add SQLite and transport details before validating behavior.
- Rationale: The small core can be checked exhaustively for the first workflow and reused by future adapters. Explicit inputs and no external effects make failure and retry behavior inspectable.
- Consequences: The in-memory reference model is not durable or an authenticated service. Its future store must commit state, events, and retry receipts atomically. Domain callers are trusted server code. Terminal requests are read-only; further work uses a new request. Successful retries return the original result without regressing current state.

## ADR-009: Use Node's test runner and pinned TypeScript checking

- Date: 2026-11-17
- Status: Accepted
- Context: The initial domain needs executable tests and type checking without a runtime framework or build pipeline.
- Decision: Use erasable TypeScript for the domain, strict no-emit checking with TypeScript 5.9.3, Node.js 24.x's TypeScript execution, and node:test. Tests and the synthetic demo are JavaScript modules using Node built-ins. Commit the package lockfile; use npm ci in CI.
- Alternatives: Add a transpiler, test framework, runtime schema library, or platform type packages before they are needed.
- Rationale: The domain has no platform imports and can be type checked without Node type definitions. One pinned development dependency is sufficient; type stripping alone is not type checking.
- Consequences: There are no runtime package dependencies. The JavaScript tests and demo are executed but not TypeScript-checked. Early Node 24 versions emit a type-stripping warning. Revisit tooling when adapters introduce platform-specific types or publishing requires compiled output.

## ADR-010: Persist commands atomically with Node's built-in SQLite

- Date: 2026-11-17
- Status: Accepted
- Context: The merged domain returns an immutable next-state candidate, but requests and retry receipts still need restart durability. Concurrent callers must not save snapshots derived from the same stale state. A native package or ORM is unnecessary for the first two-person relay.
- Decision: Use Node.js 24.x's built-in DatabaseSync. Before executing a command, acquire BEGIN IMMEDIATE and load current state. Save the changed request, audit event, retry receipt, and workspace revision in one transaction. Use separate workspace/request/event/receipt tables, bound SQL values, foreign keys, and unique retry/event keys; keep decisions and messages inside request JSON. Reads use a consistent read transaction. Use local WAL files, synchronous FULL, and a bounded busy timeout. Add Node type definitions as pinned development tooling.
- Alternatives: Persist a JSON file; save an entire workspace document as a single SQL row; introduce a third-party SQLite addon, ORM, or remote database; read before acquiring a write transaction.
- Rationale: This reuses the tested domain while making partial writes and duplicate retries observable at a small, explicit transaction boundary. Separate audit/receipt rows provide uniqueness and inspection without normalizing every nested domain record. Built-in SQLite adds no runtime package dependency or addon build step.
- Consequences: The synchronous driver blocks the calling event loop while executing or waiting for locks. Database files and WAL/SHM sidecars must stay on a local relay host. Credentials are not implemented by the store, and data is not encrypted. State reconstruction still loads reference histories. Large-history optimization, retention, backups, and distributed deployment remain separate work. Early Node 24 emits an experimental SQLite warning.
- Verification: Real-file tests exercise reopen, preserved decisions and retries, partial-write rollback, versioned migration failure, concurrent writers, lock timeout recovery, workspace boundaries, and an abruptly killed child writer. The synthetic storage demo closes/reopens a connection and verifies saved state plus safe retry. These checks do not establish behavior under power loss or remote filesystems.
- Sources: [Node SQLite API](https://nodejs.org/download/release/v24.9.0/docs/api/sqlite.html), [SQLite transactions](https://www.sqlite.org/lang_transaction.html).

## ADR-011: Authenticate a loopback relay with separate local capabilities

- Date: 2026-11-17
- Status: Accepted
- Context: The next proof-of-concept step is a real service and two terminal clients on one laptop. Identity objects cannot be accepted from HTTP task payloads, and agent credentials must not approve another developer's work.
- Decision: Bind the HTTP service only to 127.0.0.1. Use random 256-bit bearer tokens mapped server-side to one workspace, participant, and human/agent role. Append SQLite migration 2 for token hashes and persistent revocation; never persist plaintext tokens in SQLite. Bootstrap explicit profiles into separate agent/human directories in a private home outside the repository. Provide local operator issuance/revocation with no HTTP administration endpoint. Authenticate every read/write and recheck revocation after reading a write body. Use the same tested domain/store for all task operations.
- Alternatives: Trust a role or humanApproved field in request JSON; use one shared all-powerful room token; introduce public signup or remote identity infrastructure for the local demonstration.
- Rationale: The server can enforce a narrow capability boundary with no new runtime package or model API integration. Explicit profiles make the local workflow testable, while opaque credentials keep task messages separate from identity.
- Consequences: This is not OS process isolation or proof of human presence. A process with the operator's filesystem privileges can read credentials/registry or invoke local issuance, so the local demo assumes a trusted host and operator. Future assistant adapters must receive only an agent credential and verify its effective role through /v1/identity. Cross-machine distribution, TLS, and a suitable remote operator boundary remain under ADR-007/M3.
- HTTP boundary: No browser origins, unexpected Host headers, CORS, upgrades, remote binds, or redirects in the client. Limit JSON to 64 KiB (including chunked bodies), header size, connection count, and request duration. Return structured errors without raw token values or internal causes. Include retry keys for uncertain CLI writes; never silently retry or refresh approval versions.
- Verification: Actual HTTP and separate-process CLI tests cover request/reply/approval/start, agent-token denial, forged identity fields, restart, revocation before retries and during partial bodies, body limits, metadata forgery, profile privacy, and local operator replacement. No real assistant connection has been verified.
- Sources: [Node HTTP](https://nodejs.org/download/release/v24.1.0/docs/api/http.html), [Node crypto](https://nodejs.org/download/release/v24.1.0/docs/api/crypto.html), [Node filesystem](https://nodejs.org/download/release/v24.1.0/docs/api/fs.html).

## ADR-012: Use the official MCP v2 SDK over local stdio

- Date: 2026-11-18
- Status: Accepted
- Context: The local relay works through terminal clients. Existing assistants need a narrow tool surface without receiving human credentials, opening the database, or inventing a separate authorization path.
- Decision: Pin `@modelcontextprotocol/server` 2.4.0 and Zod 4.6.5 at runtime, with matching `@modelcontextprotocol/client` 2.4.0 for protocol tests. Use local stdio and launch Node directly. Expose ten typed agent tools, with no human approval, administration, shell, Git, or generic command tool. Split profile readers from local SQLite/bootstrap operations. Verify the selected credential's actual workspace, participant, and agent role through `/v1/identity` at startup and before each tool operation; the relay still authenticates each request independently.
- Alternatives: Handwrite MCP JSON-RPC and lifecycle negotiation; use an older cached SDK solely because it is locally available; expose a network MCP service; load the operator module from the adapter.
- Rationale: The official SDK owns protocol negotiation, validation, and stdio lifecycle. A local process reuses the tested HTTP boundary without introducing another listening endpoint. Narrow tools make capability discovery clear, while server-side roles remain authoritative.
- Consequences: The package now has runtime dependencies. SDK client/server versions and registry integrity are locked together; schema validation is separate from domain validation. Stdout is reserved for protocol output. Peer content has an explicit untrusted-data envelope, which is not an instruction-isolation guarantee. Writes require caller-selected stable retry keys; existing-request writes require an expected version. Requests/responses are bounded, requests time out, and redirects are refused. There is no automatic retry, background poll, cursor persistence, or agent wake-up.
- Verification: Official SDK clients drive actual stdio subprocesses against a real relay, including a full synthetic lifecycle and separate human-profile CLI acceptance. Tests cover schema rejection, forged metadata, effective role changes, revocation, uncertain-write retry semantics, relay restart, untrusted peer text, redirects, size limits, and sanitized errors. These establish protocol behavior, not actual Codex/Claude compatibility, human presence, or a two-machine pilot.
- Sources: [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [server tools](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md), [Codex MCP configuration](https://developers.openai.com/codex/mcp).

## ADR-013: Opt in to review one completed handoff

- Date: 2026-11-19
- Status: Accepted
- Context: In the two-Codex lab the requester had to prompt their assistant to read a completion that was already recorded.
- Decision: Add a requester-side watcher for a single explicitly selected request and local checkout. Launch a dedicated Codex review turn using the completion commit's bounded diff and current decision record. Reserve one automatic attempt on local disk and save the review separately.
- Alternatives: Inject into the interactive Codex session with its existing tools. Subscribe to every completion in a workspace. Implement client-specific push servers.
- Rationale: A dedicated turn has a small input and clear permissions. Selecting one request limits activation and lets a completion from any MCP producer trigger the same flow. Polling the terminal request supports catch-up without a second event store.
- Consequences: The recipient supplies a local checkout containing the commit. A crash after the reservation leaves an uncertain outcome for the human to inspect. Live model completion and mixed-client validation are separate from SDK tests.

## ADR-014: Put the invite-only pilot behind a TLS proxy

- Date: 2026-11-19
- Status: Accepted
- Context: A real Codex and Claude Code completed a mixed-client handoff on one laptop. Two teammates need a common relay across machines and their own Git and assistant sessions.
- Decision: Run one existing SQLite-backed loopback relay behind a same-host TLS proxy. An operator initializes one workspace and provisions distinct human and agent profiles. Each remote profile and its workspace configuration carry the exact HTTPS origin.
- Alternatives: Bind the development relay publicly. Introduce browser login, a device grant, and a multi-tenant database in the same change.
- Rationale: The pilot reuses audited lifecycle and authorization rules. It lets us test the cross-machine handoff with a small deployment and preserve the existing approval boundary.
- Consequences: The operator distributes and revokes credentials. Clients rely on standard TLS certificate validation. Browser sessions and pairing require a separate API. Git transfer stays in the participants' existing workflow.
- Verification: The [HTTPS pilot guide](HTTPS_PILOT.md) describes the TLS integration test and live deployment steps.

## New ADR template

```text
ADR-NNN: Title
Date:
Status:
Context:
Decision or proposal:
Alternatives:
Rationale:
Consequences:
Verification or revisit trigger:
```
