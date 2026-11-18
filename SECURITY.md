# Security

Agent Bridge is an early proof of concept with no production-supported release. Its HTTP service binds only to 127.0.0.1 and supports a local terminal workflow. Cross-machine deployment is not implemented.

## Design expectations

- Share only intentionally selected task messages and references. Do not upload complete conversations, credentials, or repository snapshots automatically.
- Treat messages from peers and agents as untrusted input.
- Separate human approval credentials from assistant credentials and enforce roles on the server.
- The relay must not execute message text, expose a shell, launch assistants, or merge code.
- Authenticate nontrivial operations, isolate workspaces, bound payloads, and redact logs.
- Require TLS beyond loopback. Do not expose development endpoints before authentication is implemented and checked.
- Keep local state, tokens, logs, and database files out of Git. The relay operator can read shared data; end-to-end encryption is not part of the initial design.

The local relay authenticates scoped bearer credentials and derives Principal identity from its SQLite registry, then applies the domain's role/workspace rules. It rechecks revocation after reading write bodies and before replaying command receipts. Token values and internal causes are not returned or logged. Human and agent profile files are separate and outside the checkout. A process with the operator's filesystem privileges can still read profiles or administer the registry: this is not OS process isolation or proof of human presence. An assistant must receive only an agent credential; actual assistant pairing is not yet verified. See [ARCHITECTURE.md](docs/ARCHITECTURE.md) and [LOCAL_RELAY.md](docs/LOCAL_RELAY.md).

Stored task data is not encrypted. The relay operator must control database, WAL/SHM, and backup access through local filesystem permissions. Do not use a network-shared database file. Use an SQLite-aware backup procedure or stop writers and close connections first. Diagnostic error causes are for trusted code and remain redacted at the API boundary. See [STORAGE.md](docs/STORAGE.md).

## Reporting a sensitive finding

Do not include secrets or exploit details in a public issue. If the repository has private vulnerability reporting enabled, use GitHub's private reporting flow. Otherwise, contact the maintainer using a contact method they explicitly publish, or open an issue asking for a private reporting channel without disclosing the vulnerability. No response-time commitment is offered at this stage.
