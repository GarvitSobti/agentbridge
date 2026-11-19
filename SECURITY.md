# Security

Agent Bridge is an early proof of concept. Its HTTP service binds only to 127.0.0.1. The [HTTPS pilot](docs/HTTPS_PILOT.md) uses distinct operator-provisioned profiles for two invited participants.

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

The MCP adapter verifies its actual agent role, workspace, and participant through `/v1/identity` at startup and before each tool operation. Human profile metadata is rejected, and relabeling a human token as an agent fails the relay identity check. Reads/writes remain authenticated by the relay, including revocation checks. The adapter imports profile readers without opening SQLite or importing credential administration. Its ten tools cannot accept/decline/cancel work, issue credentials, run a shell, or perform Git operations. Stdout carries SDK protocol messages only; diagnostics and error messages exclude raw credentials and internal causes.

The adapter accepts loopback HTTP for local profiles or the registered HTTPS origin for hosted profiles. It refuses redirects and keeps its existing request, response, and timeout limits. Peer content is returned under an explicit untrusted-data envelope. The envelope relies on the assistant to treat task content as data. See [MCP.md](docs/MCP.md).

## Reporting a sensitive finding

Do not include secrets or exploit details in a public issue. If the repository has private vulnerability reporting enabled, use GitHub's private reporting flow. Otherwise, contact the maintainer using a contact method they explicitly publish, or open an issue asking for a private reporting channel without disclosing the vulnerability. No response-time commitment is offered at this stage.
