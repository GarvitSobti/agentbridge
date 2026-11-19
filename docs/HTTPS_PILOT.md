# Run one workspace across two laptops

The first hosted slice puts a TLS proxy in front of the existing loopback relay. One operator runs it for two invited participants and one Git repository. A connector on each laptop sends outbound HTTPS requests using its own account's agent profile. Human approval is available through the terminal client and the separate human profile.

Use the synthetic CRM fixture for the first run. The hosted relay can read the task messages, agreed contract text, commit references and test claims that participants submit. Git carries code between laptops. Each participant uses their existing repository and assistant access. For a company repo, use a hosting and assistant setup that the company has approved for the data being shared.

## Run the relay on the host

Use Node.js 24, a persistent private data directory owned by the relay account, and a DNS name served over HTTPS. This example uses Caddy on the same host as the relay. Set the public host before issuing profiles. Replace the example host and repository for your pilot.

```sh
export AGENTBRIDGE_RELAY_HOST=relay.example.com
npm ci
npm run relay:init -- --home /var/lib/agentbridge-pilot \
  --origin "https://$AGENTBRIDGE_RELAY_HOST" \
  --workspace crm-pilot --repository https://github.com/example/crm-fixture.git \
  --participants alice,bob
npm run relay -- --home /var/lib/agentbridge-pilot
```

Run the proxy in a second terminal on the relay host with the same `AGENTBRIDGE_RELAY_HOST` value:

```sh
caddy run --config deploy/Caddyfile --adapter caddyfile
```

The relay keeps port 8787 on 127.0.0.1. The proxy accepts HTTPS, replaces the upstream Host header, and preserves Origin so browser requests remain subject to the relay's existing origin restriction. Keep the relay listener and the proxy's administration port on the host. Use a publicly trusted certificate on the pilot DNS name. Consult [Caddy's HTTPS setup](https://caddyserver.com/docs/automatic-https) and [reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

## Provision each laptop

Make a private directory outside the source checkout for each participant. Give Alice a copy of `server.json`, `agents/alice-agent.json`, and `humans/alice-human.json`. Give Bob the matching Bob files. Preserve the relative layout and share each person's files with that person through an approved secret transfer channel. On Unix give the directory mode 700 and the files mode 600. On Windows use the participant's private user directory.

The operator retains the database and all other profiles. The profiles carry the registered HTTPS origin, and the CLI and MCP adapter reject a changed destination, plaintext HTTP, and redirects. Node verifies the server certificate using its normal trust configuration. Issue or revoke a credential with the existing server-side operator commands. Keep human credentials in the approval terminal.

On each laptop, run from an Agent Bridge checkout with the pinned dependencies installed:

```powershell
npm.cmd run bridge -- --home C:\private\crm-pilot --profile alice-agent whoami
```

Use the corresponding Bob profile on the other laptop. Follow the [MCP launch guide](MCP.md) using each laptop's own agent profile and `--home`. The adapter reads the registered HTTPS destination from those files.

## Test the handoff

1. Alice opens a request and saves its ID. Bob reads it with his own agent profile and accepts as a human in the separate terminal.
2. Bob starts work through MCP, changes the fixture on his branch, and pushes using his normal Git credentials.
3. Alice fetches the branch into her local checkout and starts the [review watcher](AUTO_REVIEW.md) for the request. Bob reports the exact commit and checks through MCP. Alice's watcher picks up the completion. If it reports a missing commit, fetch that commit and rerun.
4. Disconnect a participant and restart the relay. Reconnect and read events after a saved cursor. Retry a previously submitted command with the same retry key and arguments and confirm it returns its original result.

The verification suite uses a temporary TLS proxy, separate client directories and real SDK processes. It exercises certificate validation, remote credential routing, the human approval boundary, persistence, retry and revocation. OpenSSL supplies the ephemeral test certificate. It uses the installed binary on Unix or Git for Windows' bundled binary when available. The actual deployment and two-laptop pilot still need a run.

The dashboard increment will add browser sign-in, invite and device pairing, version-aware approval, and a shared request and review timeline.
