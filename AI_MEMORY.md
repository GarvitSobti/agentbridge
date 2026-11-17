# Project memory

Last updated: 2026-11-17

## Current position

Milestone M0 is complete. PR #1 was merged and verified on main at `d16c6e63bf25642f6286f020688c00728fdd854a`. The next M1 slice on `feat/sqlite-persistence` adds SQLite persistence, transactional migrations, recovery/concurrency tests, and a storage demonstration. The loopback relay remains next. No real assistant integration or pilot outcome has been verified.

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
- Role and workspace checks on trusted Principal objects; credential authentication is not implemented.
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
- Storage close/reopen demo, docs/STORAGE.md, and ADR-010. Credential authentication and network delivery are still absent.

## Verification

- On Node.js 24.1.0 with SQLite 3.49.1, strict source TypeScript checking and 52 behavioral tests pass (34 domain, 18 storage).
- `npm.cmd ci` passed from the committed lockfile using a writable offline cache; `npm.cmd run check` passed, including 16 Markdown files and 51 local file links. `git diff --check` passed.
- `npm.cmd run demo:domain` exercises eight synthetic lifecycle transitions; `npm.cmd run demo:storage` verifies a saved accepted request and safe original-create retry after reopening a real database file.
- CI runs documentation checks, TypeScript, the domain/storage test suite, and both demos. Inspect the storage PR for its latest hosted result.
- The lockfile pins development tooling and package integrity. Runtime dependencies remain empty.
- Node 24.1.0 emits expected SQLite and type-stripping warnings. Type stripping is not type checking; the compiler check remains required.
- Network, actual credential authentication, and real assistant integrations remain untested because they are not implemented. Crash tests simulate a killed writer, not power or hardware failure.

## Open questions

- Which Claude client (Code, Desktop, or web) and OS will the second participant use? Verify the actual pair before claiming compatibility.
- Which synthetic CRM fixture best reproduces the original coordination problem without sharing private project code?
- Final authentication details and credential storage need an implementation ADR before network exposure.
- MCP SDK choice is deferred. SQLite uses the Node built-in; TypeScript 5.9.3 and @types/node 24.1.0 are pinned development dependencies (undici-types is transitive development tooling).
- Product name can change. No package-name or trademark availability has been established.

## Publication

The public repository is https://github.com/GarvitSobti/agentbridge. Domain PR #1 is merged. Storage work belongs on `feat/sqlite-persistence`; review its pull request and hosted checks before merging. Preserve the original preparation commits on local-foundation; inspect Git history for published revisions.

## Next task

Continue M1: build a loopback-only relay using the SQLite adapter and a two-terminal synthetic request/reply workflow. Resolve the local authentication and human/agent capability details in ADR-007 before accepting identity over HTTP. Do not expose a service beyond loopback or claim real assistant integration. MCP connection and the Claude client/OS check follow in M2.
