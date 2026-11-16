# Contributing

Agent Bridge is at the documentation-foundation stage. The first implementation target is a small two-person coordination workflow. Read [the scope](docs/SCOPE.md) and [the current progress](AI_MEMORY.md) before starting.

## Work on a change

1. Start a short-lived branch from main, for example `docs/clarify-handoffs` or `feat/request-state-machine`.
2. Keep one pull request focused on one behavior or decision.
3. Explain the problem, resulting behavior, and relevant tradeoffs.
4. Update public documentation when behavior or setup changes.
5. Record architectural changes in [the ADR log](docs/DECISIONS.md).
6. Run `node scripts/check-repo.mjs` from the repository root.

No dependency installation is needed for the current check. Application build and runtime test commands will be documented when implemented. Use Node.js 24.x.

## Verification expectations

Documentation changes need working local links and accurate status statements. Runtime changes will need meaningful tests for the behavior introduced, especially permissions, state transitions, retry handling, decision revisions, and persistence. Report what was not run and why.

Never claim a client is supported before exercising its actual integration. A self-reported completion or generated test summary is not independent verification.

## Issues and pull requests

Bug reports should include expected and actual behavior, reproduction steps, relevant versions, and redacted evidence. Use the issue template for proposed work and tie it to a roadmap milestone. Keep speculative commercial features separate from the first proof of concept.

Respect collaborators, explain disagreements concretely, and do not publish personal data, proprietary code, credentials, or full assistant transcripts. For sensitive findings, follow [SECURITY.md](SECURITY.md).

## License

Contributions are made under the repository's [MIT License](LICENSE). Use material you have the right to contribute. Keep attribution and notices for any third-party code introduced.
