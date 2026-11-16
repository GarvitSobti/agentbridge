# Security

Agent Bridge is an early proof of concept with no production-supported release. There is currently no implemented network service. Do not use experimental builds for sensitive production workflows.

## Design expectations

- Share only intentionally selected task messages and references. Do not upload complete conversations, credentials, or repository snapshots automatically.
- Treat messages from peers and agents as untrusted input.
- Separate human approval credentials from assistant credentials and enforce roles on the server.
- The relay must not execute message text, expose a shell, launch assistants, or merge code.
- Authenticate nontrivial operations, isolate workspaces, bound payloads, and redact logs.
- Require TLS beyond loopback. Do not expose development endpoints before authentication is implemented and checked.
- Keep local state, tokens, logs, and database files out of Git. The relay operator can read shared data; end-to-end encryption is not part of the initial design.

These are requirements, not a claim that security controls have been implemented or audited. See [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Reporting a sensitive finding

Do not include secrets or exploit details in a public issue. If the repository has private vulnerability reporting enabled, use GitHub's private reporting flow. Otherwise, contact the maintainer using a contact method they explicitly publish, or open an issue asking for a private reporting channel without disclosing the vulnerability. No response-time commitment is offered at this stage.
