# Codex development guide

This file is explicitly referenced by [AGENTS.md](AGENTS.md), the repository instruction entry point. It is a project guide, not a replacement for system instructions or a guarantee of automatic conversational memory.

## Start a session

1. Read [AI_MEMORY.md](AI_MEMORY.md), then confirm the actual Git status and relevant files. The checkout is the source of truth when notes are stale.
2. Read the relevant scope, architecture, and decision sections.
3. State the task and the smallest verifiable result. Continue work already authorized by the user.
4. Read existing code before choosing dependencies or changing conventions.

## Development conventions

- Runtime target: Node.js 24.x. Domain implementation language: TypeScript, using erasable syntax and strict checking. Tests and the demo are JavaScript modules.
- Keep relay, domain logic, and adapters in one repository. Avoid microservices for this proof of concept.
- Prefer a small dependency set. Record the rationale and lockfile when dependencies are introduced.
- Keep credentials distinct from task data. Derive participant identity and role from credentials, not request payloads.
- Use structured errors, explicit state transitions, server-generated IDs and timestamps, and bounded payloads.
- Preserve message history. Handle retries without duplicating a request or executing a transition twice.
- A reply is not acceptance; acceptance is not execution; a completion report is not verified integration.
- Specify what a test result refers to: repository, commit, command, outcome, and reporter.
- Write meaningful tests for permissions, transitions, retry behavior, persistence, and failures as those capabilities are implemented.
- Keep source changes and their documentation together. Do not publish imaginary install commands or fabricated results.

## Available verification

```sh
npm ci
npm run check
npm run demo:domain
```

`npm run check` runs `check:docs`, `typecheck`, and `test`. The domain source is type checked; JavaScript tests and the demo run directly in Node. The synthetic demo exercises a single-process handoff. It does not authenticate humans, connect real agents, use a network, or persist state. No application build or verified assistant setup exists yet.

The documentation-only checker remains available without installed dependencies: `node scripts/check-repo.mjs`. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

## End a session

Update [AI_MEMORY.md](AI_MEMORY.md) with:

- Date and current milestone.
- What actually changed and what remains unimplemented.
- Exact checks and their outcomes, including anything not run.
- Blockers or unresolved decisions.
- One next task with a concrete acceptance condition.

For a consequential design change, add an ADR to [docs/DECISIONS.md](docs/DECISIONS.md) and update [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Git history records changes; memory records the current handoff. Do not maintain duplicate session transcripts.

## Documentation roles

Product boundaries belong in docs/SCOPE.md; component design in docs/ARCHITECTURE.md; rationale in docs/DECISIONS.md; delivery sequencing in docs/ROADMAP.md; current progress in AI_MEMORY.md. Keep README.md approachable for a first-time visitor.
