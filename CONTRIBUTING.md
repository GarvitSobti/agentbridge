# Contributing

Agent Bridge has a request domain prototype. The next implementation target is persistent storage and a local relay. Read [the scope](docs/SCOPE.md) and [the current progress](AI_MEMORY.md) before starting.

## Work on a change

1. Start a short-lived branch from main, for example `docs/clarify-handoffs` or `feat/request-state-machine`.
2. Keep one pull request focused on one behavior or decision.
3. Explain the problem, resulting behavior, and relevant tradeoffs.
4. Update public documentation when behavior or setup changes.
5. Record architectural changes in [the ADR log](docs/DECISIONS.md).
6. Run `npm run check` from the repository root. Run `npm run demo:domain` when changing the demonstrated lifecycle.

Use Node.js 24.x and run `npm ci` to install the pinned TypeScript compiler. The domain has no runtime package dependencies. A dependency-free documentation-only check is also available: `node scripts/check-repo.mjs`.

## Verification expectations

Documentation changes need working local links and accurate status statements. Domain changes need meaningful tests for the behavior introduced, especially role rules, state transitions, retry handling, and decision revisions. Persistence and network tests must be added with those capabilities. Report what was not run and why.

Never claim a client is supported before exercising its actual integration. A self-reported completion or generated test summary is not independent verification.

## Issues and pull requests

Bug reports should include expected and actual behavior, reproduction steps, relevant versions, and redacted evidence. Use the issue template for proposed work and tie it to a roadmap milestone. Keep speculative commercial features separate from the first proof of concept.

Respect collaborators, explain disagreements concretely, and do not publish personal data, proprietary code, credentials, or full assistant transcripts. For sensitive findings, follow [SECURITY.md](SECURITY.md).

## License

Contributions are made under the repository's [MIT License](LICENSE). Use material you have the right to contribute. Keep attribution and notices for any third-party code introduced.
