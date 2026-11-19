# Run the local relay

This is a real HTTP service backed by SQLite, with two terminal clients on one laptop. Alice and Bob are demo participant identities. The commands below send actual requests to the relay; they do not connect Codex or Claude or run coding agents yet.

Use Node.js 24.x and open every terminal in the repository root. There are three windows: one relay window and two client windows. PowerShell commands use `npm.cmd`; on macOS/Linux use `npm` and adapt the variable syntax.

## Window 1: initialize and start the relay

```powershell
npm.cmd ci
npm.cmd run relay:init
npm.cmd run relay
```

Initialization creates a private local workspace with `alice-agent`, `alice-human`, `bob-agent`, and `bob-human` credential profiles. It prints profile metadata, never token values. Re-running initialization keeps existing profiles and does not undo revocation.

The relay prints an address such as `http://127.0.0.1:8787`. Leave it running. It binds only IPv4 loopback. For another computer, use the [HTTPS pilot setup](HTTPS_PILOT.md).

## Window 2: Alice requests work

```powershell
$retry = [guid]::NewGuid().ToString()
$created = npm.cmd --silent run bridge -- --profile alice-agent request --to bob --title "Expose severity" --body "Please add a severity field to the health response." --retry $retry | ConvertFrom-Json
$id = $created.request.id
$cursor = $created.event.cursor
$id
```

Copy the printed request ID into Window 3. The command returns a pending request at version 1. The explicit retry key lets you safely repeat the same request after an uncertain network failure; use a new key for a different task.

## Window 3: Bob reads, replies, approves, and starts

```powershell
$id = "PASTE_REQUEST_ID_HERE"
npm.cmd run bridge -- --profile bob-agent inbox
npm.cmd run bridge -- --profile bob-agent reply --id $id --version 1 --body "I can expose severity as low, medium, or high."
npm.cmd run bridge -- --profile bob-human accept --id $id --version 2
npm.cmd run bridge -- --profile bob-agent start --id $id --version 3
```

The reply advances the request to version 2 without approving it. The human profile accepts it at version 3. The agent profile starts it at version 4. An acceptance attempted with `bob-agent` is rejected by the server, regardless of identity claims in a task body or profile metadata.

If another command changes the request, inspect it with `get` and use its current version. Stale versions return `VERSION_CONFLICT`; the CLI never silently refreshes a version and approves unseen changes.

## Window 2: Alice sees the saved result

```powershell
npm.cmd run bridge -- --profile alice-agent get --id $id
npm.cmd run bridge -- --profile alice-agent events --after $cursor
```

The current request is `in_progress`, and catch-up shows events after the cursor Alice saved. Reading never accepts or starts work. Checks are explicit; there is no background agent polling loop.

Stop Window 1 with Ctrl+C and run `npm.cmd run relay` again. The same profiles, requests, audit events, and retry receipts remain. Repeating a successful command with its exact input and key returns its original result, which can be older than the current request; use `get` to inspect current state.

## Decisions and completion

High-level CLI commands cover request creation, inbox/get/events, replies, acceptance/decline, start, and cancel. All domain commands, including revisioned decisions and completion reports, can also be sent from an explicitly selected local JSON file:

```powershell
npm.cmd run bridge -- --profile bob-agent command --file .\completion.json
```

For example, after the sequence above, a synthetic `completion.json` could contain:

```json
{
  "type": "request.complete",
  "requestId": "REPLACE_WITH_REQUEST_ID",
  "expectedVersion": 4,
  "retryKey": "finish-this-demo-task",
  "branch": "feat/severity",
  "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "summary": "Synthetic completion report; no code was edited.",
  "checks": [
    { "command": "consumer integration test", "outcome": "not_run", "details": "This is a local relay demonstration." }
  ]
}
```

The example Git ID is a fixture, not a verified commit. For real work, supply actual references and check claims. Completion remains `self_reported`; the relay executes neither commands nor Git operations. See [DOMAIN.md](DOMAIN.md) for `decision.propose` and `decision.agree`, including revision and content-hash requirements.

## Local files and operator actions

Default relay home: `~/.agentbridge/local-demo` (on Windows, under your user profile). It holds `server.json`, `state.db` and SQLite sidecars, plus separate `agents/` and `humans/` credential directories. It is outside the checkout. Files are created owner-only on Unix; Windows uses the current user's filesystem access controls. This is local capability separation, not an OS sandbox: processes with the same user's filesystem access can read those files.

Use `AGENTBRIDGE_HOME` or `--home PATH` for a different private directory outside the checkout. All windows must use the same home. The relay refuses to initialize private state inside its repository.

The SQLite registry stores SHA-256 hashes of random 256-bit bearer tokens, mapped to a workspace, participant, and human/agent role. Raw tokens live only in the explicitly created private profile files and process memory. The server derives identity from its registry, not profile labels or task fields. It checks revocation on every authenticated request and again after reading a write body. No HTTP endpoint issues credentials or accesses local files.

Inspect profile names and credential IDs without printing tokens:

```powershell
npm.cmd run bridge -- profiles
npm.cmd run bridge -- --profile bob-agent whoami
```

Revoke a credential as the local operator, then explicitly issue a replacement under a new profile name:

```powershell
npm.cmd run relay:credential -- revoke --id "PASTE_CREDENTIAL_ID"
npm.cmd run relay:credential -- issue --participant bob --role agent --profile bob-agent-v2
```

Revocation persists across restart and initialization. Existing profile files are not overwritten. Human profiles must not be supplied to an MCP adapter. The [implemented stdio adapter](MCP.md) verifies its effective role through `/v1/identity` at startup and before tool operations. Actual assistant pairing remains unverified.

## HTTP contract and limits

| Method and path | Result |
| --- | --- |
| `GET /health` | Minimal unauthenticated liveness response |
| `GET /v1/identity` | Registry-derived principal |
| `GET /v1/inbox` | Active requests addressed to the credential's participant |
| `GET /v1/requests/:id` | Current request |
| `GET /v1/events?after=0&limit=100` | Workspace event catch-up |
| `POST /v1/commands` | Validated domain command and original retry result |

Except for health, routes require an Authorization bearer credential. JSON bodies are limited to 64 KiB, including chunked requests. Invalid or revoked credentials return 401, forbidden roles 403, malformed input 400, excessive bodies 413, unsupported content types 415, conflicts 409, and temporary storage errors 503. Internal error causes and tokens are never returned. An uncertain write should be retried with exactly the same payload, version, and key; CLI errors include the retry key where available.

The service rejects browser Origin headers and unexpected Host headers. It limits headers, connections, and request duration. Local profiles send credentials to the IPv4 loopback relay. Hosted profiles use their registered HTTPS origin. All clients refuse redirects.

For a busy default port, start with `npm.cmd run relay -- --port 9000`, and pass `--url http://127.0.0.1:9000` to each `bridge` command. Use `--help` on either CLI for available arguments. A failed operation returns a nonzero exit code; profile tokens are not accepted as command-line arguments.
