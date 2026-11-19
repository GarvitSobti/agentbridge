# Browser inbox

Agent Bridge serves a shared inbox for the two members of one HTTPS workspace. The inbox shows requests, the approval state, recent activity, and the branch, commit, and checks reported by the completing agent. It refreshes while the tab is visible. Participants use their existing CLI or MCP setup to send and pick up work.

An operator issues a browser invite for a named participant. The link expires after 15 minutes and can be opened once. The resulting browser session lasts eight hours, or until sign-out or operator revocation. Share the URL privately with that participant. Anyone holding the unused invite can sign in as the named person.

## Start from a hosted workspace

Set up the relay and reverse proxy in the [HTTPS pilot guide](HTTPS_PILOT.md). From the Agent Bridge checkout on the relay host, issue Bob's invite:

```powershell
$invite = node src/cli/relay.ts invite issue --home $pilotHome --participant bob | ConvertFrom-Json
$invite.url
```

The operator can revoke either the unused invite or the browser session created from it with the same ID:

```powershell
node src/cli/relay.ts invite revoke --home $pilotHome --id $invite.id
```

The browser requires the registered HTTPS origin. Session cookies stay in the browser and agent credentials stay in their scoped profiles. Both transports use the same version and actor rules. When the request changes while someone is reading it, the old approval is rejected and the inbox reloads the latest version.

## Test on a phone with a temporary tunnel

Use a synthetic workspace. In one PowerShell window, start a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) and wait for `Registered tunnel connection`:

```powershell
cloudflared tunnel --url http://127.0.0.1:8787 --http-host-header 127.0.0.1:8787
```

In a second PowerShell window opened in the Agent Bridge checkout, initialize a fresh workspace for the HTTPS URL and start the relay:

```powershell
$pilotOrigin = Read-Host "Paste the new HTTPS tunnel URL"
$pilotHome = Join-Path $env:TEMP ("agentbridge-web-" + [guid]::NewGuid().ToString("N"))
npm.cmd ci
npm.cmd run relay:init -- --home $pilotHome --origin $pilotOrigin --workspace browser-pilot --repository https://example.test/fixture.git --participants alice,bob
$pilotHome
$invite = node src/cli/relay.ts invite issue --home $pilotHome --participant bob | ConvertFrom-Json
$invite.url
npm.cmd run relay -- --home $pilotHome
```

Open the invite on your phone and tap **Open workspace**. In a third PowerShell window in the checkout, send a request as Alice:

```powershell
$pilotHome = Read-Host "Paste the private pilot directory printed during setup"
npm.cmd run bridge -- --home $pilotHome --profile alice-agent request --to bob --title "Review the severity contract" --body "Confirm the valid severity values and report the Git commit when ready."
```

Tap **Accept request** on the phone, then use Bob's agent profile to read the accepted request. To complete the real-assistant demo, connect Alice and Bob with their separate MCP profiles as described in [MCP.md](MCP.md), and have Bob report a commit from a fixture checkout. The phone should show the completion in the same request timeline. Keep the browser approval and chat/assistant sessions separate.

Stop the relay and tunnel with Ctrl+C after the exercise. A new temporary hostname requires a fresh workspace and profiles registered for that hostname.
