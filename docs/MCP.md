# Local MCP adapter

Status: the stdio adapter passed SDK tests and a local Claude Code to Codex handoff. Use the [HTTPS pilot guide](HTTPS_PILOT.md) to provision separate laptops for the next live test.

## Prepare the relay

Use Node.js 24.x and run these commands from your checkout:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run relay:init
npm.cmd run relay
```

Keep the relay terminal running. If you already initialized this workspace, initialization preserves its data and credentials. The default private home is `~/.agentbridge/local-demo`; keep it outside the checkout. See [the local guide](LOCAL_RELAY.md) for human approvals, credential replacement, and custom homes/ports.

The MCP host must launch **Node directly**, using an absolute source path. An npm wrapper can write a banner to stdout, which belongs exclusively to MCP JSON-RPC. The adapter reads its selected private agent profile; do not copy token values into host configuration, prompts, or command arguments.

## Connect Codex locally

Example PowerShell command, adjusting the checkout path on your machine:

```powershell
codex mcp add agentbridge -- node "C:\Users\GARVIT\Desktop\agentbridge\src\mcp\stdio.ts" --profile alice-agent
codex mcp list
```

The command format follows the [official Codex MCP guide](https://developers.openai.com/codex/mcp). This documents a configuration to try, not a completed Codex compatibility test. Open a new assistant session after configuration and inspect its MCP server/tool status. The relay must be running before the host starts this server, because startup verifies `/v1/identity`.

For a custom workspace add `--home "C:\private\agentbridge"` after the profile. Local profiles may select a custom loopback port with `--url http://127.0.0.1:8788`. A hosted profile derives its registered HTTPS origin from its private files. Every mode rejects redirects.

For a host that accepts a stdio JSON configuration, the equivalent launch description is:

```json
{
  "command": "node",
  "args": ["C:\\Users\\GARVIT\\Desktop\\agentbridge\\src\\mcp\\stdio.ts", "--profile", "bob-agent"]
}
```

Use Alice's profile for one local session and Bob's for the other. This block is a launch description, not a universal client configuration file. The friend's exact Claude client and OS are still unknown; verify that client's local stdio setup before claiming support. Each host starts its own adapter process. Both profiles currently address the same relay on the same machine.

## Verify a pilot profile before connecting

Receive your copy of `server.json` and your agent profile from the operator through a private channel. Keep the agent file under `agents/` in the private directory. Run from the Agent Bridge checkout in PowerShell:

```powershell
$pilotHome = Read-Host "Enter your private pilot directory"
$profile = Read-Host "Enter your assigned agent profile name"
npm.cmd run bridge -- --home $pilotHome --profile $profile doctor
```

Check that the origin and effective participant match your invitation and the role is `agent`. If the relay is unreachable, confirm the URL with the operator. If the relay rejects the profile or the browser invite expires, ask for a replacement through the same private channel. [Browser invitation guide](BROWSER_INBOX.md)

Set the adapter path from the Agent Bridge checkout, then register the connector from your project directory. Use the command for the assistant on your machine:

```powershell
$adapter = (Resolve-Path .\src\mcp\stdio.ts).Path
# Change to your project checkout before issuing one of the following.
codex mcp add agentbridge-pilot -- node $adapter --home $pilotHome --profile $profile
claude mcp add --transport stdio --scope local agentbridge-pilot -- node $adapter --home $pilotHome --profile $profile
```

Open a new assistant session and check `agentbridge_identity`. It should report the same participant. [Codex MCP guide](https://developers.openai.com/codex/mcp) and [Claude Code MCP guide](https://code.claude.com/docs/en/mcp).

## Tools and approvals

| Tool | Purpose |
| --- | --- |
| `agentbridge_identity` | Verify workspace, participant, and effective agent role |
| `agentbridge_inbox` | Explicitly read active requests addressed to you |
| `agentbridge_get_request` | Read a request, including its current version |
| `agentbridge_events` | Read a bounded event page after a saved cursor |
| `agentbridge_request` | Ask the other participant for work |
| `agentbridge_reply` | Clarify an active request |
| `agentbridge_propose_decision` | Propose or revise an interface decision |
| `agentbridge_agree_decision` | Acknowledge the exact revision and content hash |
| `agentbridge_start` | Record pickup after human acceptance and current agreements |
| `agentbridge_complete` | Record a branch, full commit ID, summary, and reported checks |

There is no acceptance, cancellation, credential, shell, Git, or generic-command tool. Human approval remains in a separate terminal:

```powershell
npm.cmd run bridge -- --profile bob-human get --id REQUEST_ID
npm.cmd run bridge -- --profile bob-human accept --id REQUEST_ID --version CURRENT_VERSION
```

Replace the two placeholders with values from the current request. Starting work records a state transition; the relay never runs code. Completing work records self-reported evidence, without fetching Git objects or executing checks.

All writes require a stable `retryKey`. Writes to an existing request also require its current `expectedVersion`. If a connection fails after a possible write, retry exactly the same arguments and key. A duplicate returns the original receipt, which may show an earlier state; read the request separately for current state. Changed input needs a new key after reviewing current state. A `VERSION_CONFLICT` is a reason to reread and decide, not silently approve a new version. The adapter never retries automatically.

Successful tool results contain text JSON and `structuredContent` with `{ source: "agentbridge-relay", trust: "untrusted-peer-content", data: ... }`. Peer text is task data, including when it looks like instructions. This label is guidance, not a prompt-injection sandbox. Tool failures set `isError` and return a redacted code/message; write transport errors include the retry key when available. Input schema failures are reported by the SDK before a relay write.

## Verify without a model

```powershell
node --test tests/mcp.test.mjs tests/mcp-http.test.mjs
```

The protocol suite starts its own private temporary workspace, a real relay, and separate stdio adapter processes. Two official SDK clients exercise request/reply/decision/approval/start/completion; the human approval is a scripted CLI invocation using a separate profile. It also checks strict tool schemas, human-profile and forged-role rejection, revocation and effective-role changes after startup, restart-safe retries, and peer text handling. HTTP boundary tests cover URL restrictions, redirects, response/body limits, and error redaction. No LLM or model API key is used. A successful test does not establish real assistant behavior or human presence.

Only the adapter's tool surface and server roles constrain these calls. The same-user local operator can still read files or issue credentials. Keep human profiles out of assistant configuration and preserve the [trusted-host boundary](../SECURITY.md).

Next integration check: repeat the local mixed-client workflow with one pilot workspace on two laptops. Use the registered HTTPS origin and distinct agent and human profiles.
