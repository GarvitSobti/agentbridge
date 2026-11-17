# Security

Agent Bridge is an early proof of concept with no production-supported release. There is local SQLite persistence but no implemented network service. Do not use experimental builds for sensitive production workflows.

## Design expectations

- Share only intentionally selected task messages and references. Do not upload complete conversations, credentials, or repository snapshots automatically.
- Treat messages from peers and agents as untrusted input.
- Separate human approval credentials from assistant credentials and enforce roles on the server.
- The relay must not execute message text, expose a shell, launch assistants, or merge code.
- Authenticate nontrivial operations, isolate workspaces, bound payloads, and redact logs.
- Require TLS beyond loopback. Do not expose development endpoints before authentication is implemented and checked.
- Keep local state, tokens, logs, and database files out of Git. The relay operator can read shared data; end-to-end encryption is not part of the initial design.

The domain prototype checks roles and workspace membership on trusted in-process identity objects. Credential authentication, token isolation, and a network boundary are not implemented. The requirements above are not a claim of implemented or audited service security. See [ARCHITECTURE.md](docs/ARCHITECTURE.md).

Stored task data is not encrypted. The relay operator must control database, WAL/SHM, and backup access through local filesystem permissions. Do not use a network-shared database file. Use an SQLite-aware backup procedure or stop writers and close connections first. Diagnostic error causes are for trusted code and must be redacted by a future API. See [STORAGE.md](docs/STORAGE.md).

## Reporting a sensitive finding

Do not include secrets or exploit details in a public issue. If the repository has private vulnerability reporting enabled, use GitHub's private reporting flow. Otherwise, contact the maintainer using a contact method they explicitly publish, or open an issue asking for a private reporting channel without disclosing the vulnerability. No response-time commitment is offered at this stage.
