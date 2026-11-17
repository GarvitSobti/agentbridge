# Project memory

Last updated: 2026-11-17

## Current position

Milestone M0 is complete. The first M1 slice is implemented on `feat/request-domain`: a transport-independent request domain, strict TypeScript checking, behavioral tests, and a synthetic handoff demo. SQLite persistence and the relay remain next. No real assistant integration or pilot outcome has been verified.

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

## Verification

- `npm.cmd ci` with a writable offline package cache: passed using the committed dependency versions and integrity data.
- `npm.cmd run check`: passed on Node.js 24.1.0; documentation checks (15 Markdown files and 44 local file links), strict TypeScript checking, and 34 passing tests.
- `npm.cmd run demo:domain`: passed; eight synthetic transitions end in a self-reported completion with an explicitly not-run integration check.
- `git diff --check`: passed.
- Node 24.1.0 emits the expected experimental type-stripping warning; it does not perform type checking, so the separate compiler check is required.
- Hosted checks passed for implementation commit `6ebf026c6388cdbc40592812137b85e878cfb5d1`: https://github.com/GarvitSobti/agentbridge/actions/runs/44051745233. Inspect the pull request for subsequent results. Network, persistence, actual credential authentication, and real assistant integrations have not been tested because they are not implemented.

## Open questions

- Which Claude client (Code, Desktop, or web) and OS will the second participant use? Verify the actual pair before claiming compatibility.
- Which synthetic CRM fixture best reproduces the original coordination problem without sharing private project code?
- Final authentication details and credential storage need an implementation ADR before network exposure.
- MCP SDK and SQLite driver choices are deferred. Domain validation currently has no package dependency; TypeScript 5.9.3 is the single pinned development dependency.
- Product name can change. No package-name or trademark availability has been established.

## Publication

The public repository is https://github.com/GarvitSobti/agentbridge, with the foundation on main. Domain implementation is published on `feat/request-domain` in PR #1: https://github.com/GarvitSobti/agentbridge/pull/1. The local feature branch tracks origin/feat/request-domain. Preserve the original preparation commits on local-foundation; inspect Git history and the PR for published revisions.

## Next task

Continue M1: implement a SQLite store that applies domain state, events, and retry receipts in one transaction. Verify restart/reconnect behavior and concurrent writes before adding the loopback relay and two-terminal demonstration. See [the roadmap](docs/ROADMAP.md). Do not expose a network service or claim authenticated human approval before ADR-007 is resolved and implemented.
