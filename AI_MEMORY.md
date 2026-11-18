# Project memory

Last updated: 2026-11-17

## Current position

M0 and the local M1 implementation are complete. Storage PR #2 was merged and verified on main at `adc36001bba82a885511d66ac6097159a37c676b`. The `feat/local-relay` slice adds an authenticated loopback service, separate human/agent profiles, local operator actions, and real terminal clients. Next is M2: MCP and actual assistant pairing. No real assistant integration or pilot outcome has been verified.

Working name: Agent Bridge. Repository: `GarvitSobti/agentbridge`. Owner: Garvit Sobti. License: MIT, included in LICENSE. The unpublished package uses the name `agent-bridge`.

## Confirmed direction

- Build an open-source proof of concept before pursuing commercial validation.
- First test: Garvit and a friend coordinate two agents while working on one shared project from separate machines and branches. The friend uses Claude; the exact client and OS are not yet confirmed.
- Solve explicit requests, clarifications, agreed decisions, and handoffs.
- Use existing assistants; the relay has no model and needs no separate model API key.
- Require human acceptance before an agent starts work requested by a peer.
- Begin with explicit inbox checks. Do not promise agent wake-up or automatic background delivery.
- Keep Git operations, execution, and review in the developers' existing workflows.
- Existing projects overlap; uniqueness and usefulness remain unproven.

## Foundation delivered

- README with motivation, proposed workflow, truthful status, and contributor checks.
- AGENTS.md and codex.md with development and handoff guidance.
- Scope, architecture, ADRs, roadmap, and a two-person validation plan.
- Contribution and security guidance, MIT license, and repository conventions.
- Dependency-free repository checker and a CI definition for that checker.

## Domain slice delivered

- Request creation, human-role acceptance/decline, assigned-agent start/completion, cancellation, replies, and defensive inbox/event reads.
- Role and workspace checks on trusted Principal objects; the local relay now constructs those identities from its credential registry.
- Revisioned decisions with content hashes, preserved history, and two-participant agreement gates.
- Expected-version conflicts and retry receipts that survive JSON serialization without replaying effects or rolling back current state.
- Bounded runtime input validation and structured errors; completion evidence remains self-reported.
- Strict TypeScript source, node:test scenarios, and an eight-step single-process synthetic demo.
- ADR-008/009 and docs/DOMAIN.md describe the implementation and its limits.

## Storage slice delivered

- Built-in Node SQLite with workspace, request, audit-event, and retry-receipt tables; no runtime package dependency.
- BEGIN IMMEDIATE wraps current-state loading, domain execution, all command writes, and workspace revision changes.
- Transactional schema migration, application identity checks, compatible reopen, and rejection of foreign/newer databases.
- Persistent inbox/events, idempotency receipts, decision revisions, and self-reported completion evidence.
- Real-file tests with competing writer threads, a killed child writer, lock timeouts, and SQL fault injection.
- Storage close/reopen demo, docs/STORAGE.md, and ADR-010.

## Local relay slice delivered

- Loopback-only HTTP service with persistent inbox/request/event reads and domain command writes.
- Random opaque credentials mapped to workspace/participant/role; SQLite migration 2 stores hashes and persistent revocation only.
- Separate private human/agent profile files outside the repository, explicit CLI profile selection, and local-only credential issuance/revocation.
- Authentication rechecked after write-body reading and before replaying saved command results; bounded JSON, Host/Origin checks, and redacted errors.
- Real CLI bootstrap/server/client processes, including request, reply, human-profile acceptance, agent-profile start, restart, and revocation.
- docs/LOCAL_RELAY.md has the complete three-window PowerShell walkthrough; ADR-011 records the local authentication boundary. Same-user filesystem privileges remain trusted, so this is not OS process isolation or proof of human presence.

## Verification

- On Node.js 24.1.0 with SQLite 3.49.1, strict source TypeScript checking and 67 behavioral tests pass (34 domain, 18 storage, 11 HTTP/auth, 4 CLI process tests).
- `npm.cmd run check` covers documentation, TypeScript, and the complete behavioral suite. The existing committed development dependency versions are unchanged; runtime dependencies remain empty.
- Current documentation check passes for 17 Markdown files and 59 local file links. Both npm CLI help entry points and `git diff --check` pass.
- `npm.cmd run demo:domain` exercises eight synthetic lifecycle transitions; `npm.cmd run demo:storage` verifies a saved accepted request and safe original-create retry after reopening a real database file.
- CI runs documentation checks, TypeScript, domain/storage/HTTP/CLI tests, and both synthetic demos. Inspect the local relay PR for the latest hosted result.
- The lockfile pins development tooling and package integrity. Runtime dependencies remain empty.
- Node 24.1.0 emits expected SQLite and type-stripping warnings. Type stripping is not type checking; the compiler check remains required.
- Loopback HTTP and local credential authentication are tested over actual connections and separate processes. Real coding assistants, remote transport/TLS, and cross-machine provisioning remain unimplemented. Crash tests simulate a killed writer, not power or hardware failure.

## Open questions

- Which Claude client (Code, Desktop, or web) and OS will the second participant use? Verify the actual pair before claiming compatibility.
- Which synthetic CRM fixture best reproduces the original coordination problem without sharing private project code?
- Remote authentication/distribution and TLS remain open in ADR-007. Local provisioning, private profile storage, revocation, and the trusted-host limit are accepted in ADR-011.
- MCP SDK choice is deferred. SQLite uses the Node built-in; TypeScript 5.9.3 and @types/node 24.1.0 are pinned development dependencies (undici-types is transitive development tooling).
- Product name can change. No package-name or trademark availability has been established.

## Publication

The public repository is https://github.com/GarvitSobti/agentbridge. PRs #1 and #2 are merged. Local relay work belongs on `feat/local-relay`; review its pull request and hosted checks before merging. Preserve original preparation commits on local-foundation; inspect Git history for published revisions.

## Next task

Begin M2: confirm the friend's exact Claude client and OS, then connect an MCP adapter to the local relay using only an explicitly selected agent profile. Verify effective role with /v1/identity and exercise an actual assistant request/reply/approval handoff. Human credentials and local operator actions must never be exposed as agent tools. Cross-machine deployment remains M3.
