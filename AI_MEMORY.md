# Project memory

Last updated: 2026-11-17

## Current position

Milestone M0 is complete: documentation and repository foundation are published and verified on GitHub. Runtime implementation has not started. No end-to-end agent integration or pilot outcome has been verified.

Working name: Agent Bridge. Repository: `GarvitSobti/agentbridge`. Owner: Garvit Sobti. License: MIT, included in LICENSE. The unpublished package uses the name `agent-bridge`.

## Confirmed direction

- Build an open-source proof of concept before pursuing commercial validation.
- First test: Garvit and a friend coordinate two agents while working on one shared project from separate machines and branches.
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

## Verification

- `node scripts/check-repo.mjs`: passed; 14 Markdown files, 39 local file links, 18 required files, valid package metadata.
- `node --check scripts/check-repo.mjs`: passed.
- `npm.cmd run check`: passed on Windows using Node.js 24.1.0.
- `git check-ignore`: confirmed environment files, local credentials directory, SQLite state, dependencies, and generated output are excluded.
- All 22 published file blob hashes match the prepared foundation.
- GitHub-hosted repository checks passed for foundation commit `89c42224f61377908507650b35bdf2d8eb3e11f2`: https://github.com/GarvitSobti/agentbridge/actions/runs/43910852912.
- External URLs, Markdown anchors, and runtime/assistant integrations have not been validated by the repository checker. For later CI results, inspect GitHub Actions.

## Open questions

- Which assistant and OS will the second participant use? Verify the actual pair before claiming compatibility.
- Which synthetic CRM fixture best reproduces the original coordination problem without sharing private project code?
- Final authentication details and credential storage need an implementation ADR before network exposure.
- Concrete MCP SDK, validation library, and SQLite driver choices are deferred until implementation.
- Product name can change. No package-name or trademark availability has been established.

## Publication

The public repository is https://github.com/GarvitSobti/agentbridge, with the foundation on main. Repository access is authorized. The local checkout tracks origin/main and preserves its original preparation commits on local-foundation. Inspect `git log -1` for the current revision.

## Next task

M1: implement a transport-independent request state machine with tests for participant identity, human-only acceptance, invalid transitions, and retries. Then build a two-terminal relay demonstration against that shared domain logic. See [the roadmap](docs/ROADMAP.md).
