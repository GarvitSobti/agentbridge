# Invite-only beta onboarding

One beta relay serves one workspace for two people and one Git repository. The operator starts the relay and issues one owner link. The owner creates the workspace, invites their teammate, and both members pair their own agents in the browser.

## Open the beta as an operator

Use Node 24, a private data directory on persistent storage, and a registered HTTPS origin. Follow the proxy configuration in the [HTTPS pilot guide](HTTPS_PILOT.md). For an isolated rehearsal, use the temporary tunnel and Host override in the [browser inbox guide](BROWSER_INBOX.md).

Run from the Agent Bridge checkout after installing its locked dependencies:

```powershell
$betaOrigin = Read-Host "Enter the HTTPS relay origin"
$betaHome = Join-Path $env:USERPROFILE ".agentbridge\beta"
$owner = node src/cli/relay.ts beta-init --home $betaHome --origin $betaOrigin | ConvertFrom-Json
Set-Clipboard -Value $owner.url
npm.cmd run beta -- --home $betaHome
```

Share the clipboard link privately with the selected owner. It expires in one hour. Before workspace creation, rerunning `beta-init` for the same origin replaces the owner link. Once the workspace exists, restart the relay with the same `beta` command and directory. The active workspace configuration and SQLite database live under `workspace/` inside that private directory.

If the owner loses their browser session after creating the workspace, the operator can privately issue a fresh member invite from the active workspace directory:

```powershell
$workspaceHome = Join-Path $betaHome "workspace"
$member = Read-Host "Enter the owner's workspace username"
$owner = node src/cli/relay.ts invite issue --home $workspaceHome --participant $member | ConvertFrom-Json
Set-Clipboard -Value $owner.url
```

## Create the workspace and invite a teammate

1. Open the owner link. Enter the workspace name, HTTPS repository URL, and two distinct usernames.
2. Choose **Create workspace**. Under **Workspace setup**, create the one-time teammate invite and share it privately. Its validity is 15 minutes.
3. The teammate opens the link and chooses **Open workspace**. Both accounts see the same inbox and pairing status.

A repository URL identifies the work. Each developer uses their existing Git access and checkout.

## Connect an agent

On each developer’s computer, install Node 24 and install Agent Bridge once:

```sh
git clone https://github.com/GarvitSobti/agentbridge.git
cd agentbridge
npm ci
```

On Windows PowerShell, use `npm.cmd ci` if PowerShell blocks `npm.ps1`. In the web app, select **Codex** or **Claude Code**, generate a pairing code, and copy the setup command. Run that command in your Agent Bridge checkout. Paste the code at the prompt. It expires in 10 minutes.

The connector saves an agent-only profile outside the checkout and attempts to register a named MCP server in the selected assistant. If registration needs a manual step, the connector prints its registration command. Open a new session in the assistant and check `agentbridge_identity` for your expected workspace and username. The assistant uses its existing login.

Once both roster entries show **Agent paired**, have one agent send a request using `agentbridge_request`. The teammate approves in the browser. Their agent then starts the request and reports the exact commit when finished. The browser timeline updates as the relay receives those actions. [Handoff tools](MCP.md)

Pairing a replacement device revokes the previous paired credential for that member. To remove access, the operator uses `relay credential revoke` from the active workspace directory. Existing [manual profile setup](HTTPS_PILOT.md) is also available for workspaces initialized in the operator-provisioned mode.
