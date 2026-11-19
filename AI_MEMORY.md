# Project memory

Last updated: 2026-11-19

## Current position

PRs #1 through #5 are merged. The HTTPS pilot starts from main at `0cbc42608d903a1d3643da870560256b3c6d4403`. Two real Codex sessions completed a mid-task decision revision. Claude Code later reported a fresh synthetic CRM completion that Codex reviewed automatically in about 12 seconds on one laptop. A two-laptop handoff remains open.

Working name: Agent Bridge. Repository: `GarvitSobti/agentbridge`. Owner: Garvit Sobti. MIT license. Unpublished package name: `agent-bridge`.

## Confirmed direction

- Build an open-source two-person proof of concept before commercial discovery.
- Two developers, one repository, separate branches; eventual test across two machines. The friend uses Claude, but the exact client and OS are still unknown.
- Explicit requests, clarifications, revisioned interface decisions, and self-reported completion references.
- Use existing assistants. No model or separate model API key in the relay.
- Human acceptance remains a distinct server-enforced role. Keep human profiles out of MCP configuration.
- Explicit inbox checks remain the default. The requester can opt in to one local Codex review for a selected outgoing request. The relay manages coordination and human approvals.
- Same-user operator privileges remain trusted. Role separation does not isolate filesystem access or prove a human is present.
- Existing products overlap. Uniqueness, reduced coordination effort, and willingness to pay are unproven.

## Delivered

- Repository instructions, scope, architecture, ADR log, roadmap, validation plan, security/contribution guidance, and checks.
- Domain lifecycle, bounded inputs, workspace/role checks, stale-version errors, stable retry receipts, immutable decision revisions and current-agreement gates.
- Built-in SQLite, append-only migrations, transactional state/event/receipt updates, persistent inbox and event cursors, writer/crash/failure tests.
- Authenticated IPv4-loopback HTTP, hash-only credential registry, persistent revocation, private separate agent/human profiles, local operator actions, and terminal clients. Credentials and the database stay outside the checkout.
- Stdio MCP adapter with ten agent-scoped tools using the official v2 SDK. Effective role/workspace/participant checked at startup and per call. No privileged or catch-all tools. Profile-reader module avoids SQLite/operator imports in the adapter.
- Strict Zod tool schemas, stable write retry keys, expected versions, bounded HTTP requests/responses, redirect refusal, sanitized errors, and untrusted peer-content envelopes.
- Official SDK subprocess tests plus HTTP boundary tests. [MCP guide](docs/MCP.md) documents direct-Node host configuration, human approval, error/retry semantics, and what remains unverified. ADR-012 records the dependency/transport choices.
- [Review watcher](docs/AUTO_REVIEW.md) reads one terminal completion and passes a bounded Git diff and agreement context to a dedicated Codex CLI review. Private reservation and result records suppress duplicate launches after concurrent checks or restart. See ADR-013.
- [HTTPS pilot](docs/HTTPS_PILOT.md) lets an operator initialize one named workspace and register the relay's HTTPS origin. A same-host Caddy example fronts the loopback relay. Terminal, MCP, and review clients use private origin-bound profiles. See ADR-014.

## Verification

- Baseline 67 domain/storage/HTTP/CLI tests pass locally on Node 24.1.0, SQLite 3.49.1, after the profile-reader refactor. Four new HTTP client boundary tests also pass locally.
- Hosted check at commit `bbcc0cdecd677584317a15d8fe5d765f4d575cbe` passed documentation, strict TypeScript, all 74 then-current tests (including seven official SDK stdio tests), and both existing synthetic demos. [CI evidence](https://github.com/GarvitSobti/agentbridge/actions/runs/44318439552).
- The final MCP PR passed 78 tests. The review slice passed `npm.cmd run check` on Windows with documentation, strict source checking, and 79 tests. The new test uses a real Git commit, an official SDK producer, and an injected reviewer. It covers requester scope, a missing commit, racing dispatch attempts, and local record reuse after relay restart.
- Local Windows verification of the HTTPS pilot passed `npm.cmd run check` with 81 tests. The new suite uses runtime-generated TLS, isolated participant profile directories, both stdio MCP clients, the human CLI, origin checks, untrusted certificate rejection, relay restart, retry, and revocation. Caddy deployment and a live two-laptop test remain open.
- Runtime: official server SDK 2.4.0 and Zod 4.6.5. Development: official client SDK 2.4.0, TypeScript 5.9.3, Node types 24.1.0. Registry resolutions and integrity are locked.
- MCP tests use two SDK clients and scripted human-role CLI acceptance, without models. They do not verify actual assistant clients, prompt-injection resistance, human presence, or real code integration. Completion remains self-reported. Writer-kill tests do not simulate power/hardware failure.
- Node 24.1.0 emits SQLite/type-stripping warnings. Type stripping does not replace TypeScript checking.

## Publication and workspace

Public repo: https://github.com/GarvitSobti/agentbridge. Hosted pilot work lives on `feat/https-relay-pilot`. The owner's lab is separate from the GitHub source and holds the synthetic fixture and local evidence.

## Next task

Deploy a private pilot workspace with a persistent host and a trusted TLS origin. Have two teammates use their own Git checkouts and run one request through human approval, commit handoff, review, and reconnect. Then add browser sign-in, invite and device pairing, and status views against the same rules.
