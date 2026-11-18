# Project memory

Last updated: 2026-11-18

## Current position

M0 and local M1 are complete. PRs #1 (domain), #2 (SQLite), and #3 (authenticated relay/CLI) are merged; main was verified at `0a7298f787335858bb6f37399b745a56be284084`. The owner confirmed the manual local relay workflow works on Windows. The `feat/mcp-adapter` slice implements M2's local protocol layer. Actual assistant pairing, cross-machine operation, and pilot outcomes remain unverified. Check GitHub for this branch's PR/check status before merging.

Working name: Agent Bridge. Repository: `GarvitSobti/agentbridge`. Owner: Garvit Sobti. MIT license. Unpublished package name: `agent-bridge`.

## Confirmed direction

- Build an open-source two-person proof of concept before commercial discovery.
- Two developers, one repository, separate branches; eventual test across two machines. The friend uses Claude, but the exact client and OS are still unknown.
- Explicit requests, clarifications, revisioned interface decisions, and self-reported completion references.
- Use existing assistants. No model or separate model API key in the relay.
- Human acceptance remains a distinct server-enforced role. Keep human profiles out of MCP configuration.
- Explicit inbox/event checks only; no agent wake-up, execution, Git operations, or automatic merging.
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

## Verification

- Baseline 67 domain/storage/HTTP/CLI tests pass locally on Node 24.1.0, SQLite 3.49.1, after the profile-reader refactor. Four new HTTP client boundary tests also pass locally.
- Hosted check at commit `bbcc0cdecd677584317a15d8fe5d765f4d575cbe` passed documentation, strict TypeScript, all 74 then-current tests (including seven official SDK stdio tests), and both existing synthetic demos. [CI evidence](https://github.com/GarvitSobti/agentbridge/actions/runs/44318439552).
- The four later HTTP tests bring the expected full total to 78; inspect the latest PR checks for the final combined result rather than treating this expected count as a recorded pass.
- Shell npm networking is denied in this managed session. npm generated the dependency lockfile in a temporary read-only-permission GitHub workflow, then the workflow was removed from the final branch. Official SDK tests/typechecking run in hosted CI; the newly pinned SDK is not installed in this local checkout. Never substitute a cached older SDK as compatibility evidence.
- Runtime: official server SDK 2.4.0 and Zod 4.6.5. Development: official client SDK 2.4.0, TypeScript 5.9.3, Node types 24.1.0. Registry resolutions and integrity are locked.
- MCP tests use two SDK clients and scripted human-role CLI acceptance, without models. They do not verify actual assistant clients, prompt-injection resistance, human presence, or real code integration. Completion remains self-reported. Writer-kill tests do not simulate power/hardware failure.
- Node 24.1.0 emits SQLite/type-stripping warnings. Type stripping does not replace TypeScript checking.

## Publication and workspace

Public repo: https://github.com/GarvitSobti/agentbridge. Feature work belongs on `feat/mcp-adapter`; do not merge without the owner's instruction. Preserve preparation history on `local-foundation`. This managed session uses a permitted temporary checkout; it does not edit the Desktop checkout or the unrelated Devops project. Pull the merged PR into the Desktop checkout before following its guide.

## Next task

Confirm the exact Claude client/OS, then verify one local two-assistant handoff using explicit Alice/Bob agent profiles and separate human-profile approval. Record actual client versions, launch configuration, tool discovery, and request/reply/decision/start/completion evidence. Do not mark M2 complete from protocol tests alone. Remote provisioning, TLS, and two-machine access remain ADR-007/M3; choose a synthetic CRM fixture before sharing project material.
