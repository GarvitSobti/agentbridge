import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AgentRelayClient, localRelayURL } from '../src/mcp/relay-client.ts';

const profile = { version: 1, credentialId: 'test', workspaceId: 'workspace', participantId: 'alice', role: 'agent', token: 'ab_' + 'x'.repeat(43) };
const principal = { workspaceId: 'workspace', participantId: 'alice', role: 'agent' };
async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(async () => { const closed = new Promise((resolve, reject) => instance.close(error => error ? reject(error) : resolve())); instance.closeAllConnections(); await closed; });
  return `http://127.0.0.1:${instance.address().port}`;
}
const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };

test('MCP HTTP client rejects remote or credential-bearing URLs and human metadata', () => {
  for (const url of ['https://127.0.0.1:8787', 'http://localhost:8787', 'http://[::1]:8787', 'http://example.com', 'http://127.0.0.1/path', 'http://127.0.0.1/?token=x', 'http://user:pass@127.0.0.1', 'http://127.0.0.1/#x']) {
    assert.throws(() => localRelayURL(url), { code: 'INVALID_URL' });
  }
  assert.throws(() => new AgentRelayClient('http://127.0.0.1:8787', { ...profile, role: 'human' }), { code: 'AGENT_PROFILE_REQUIRED' });
});

test('MCP HTTP client checks effective identity and prevents direct privileged submits', async t => {
  let requests = 0;
  const url = await server(t, (_req, res) => { requests++; json(res, { principal: { ...principal, role: 'human' } }); });
  const client = new AgentRelayClient(url, profile);
  await assert.rejects(client.identity(), { code: 'AGENT_IDENTITY_REQUIRED' });
  for (const type of ['request.accept', 'request.decline', 'request.cancel', 'credential.issue']) await assert.rejects(client.submit({ type }), { code: 'AGENT_ACTION_REQUIRED' });
  assert.equal(requests, 1);
});

test('MCP HTTP client refuses redirects without forwarding its credential', async t => {
  let destinationCalls = 0;
  const destination = await server(t, (_req, res) => { destinationCalls++; json(res, { principal }); });
  const source = await server(t, (_req, res) => { res.writeHead(302, { location: destination + '/v1/identity' }); res.end(); });
  await assert.rejects(new AgentRelayClient(source, profile).identity(), { code: 'RELAY_UNAVAILABLE' });
  assert.equal(destinationCalls, 0);
});

test('MCP HTTP client bounds bytes and redacts malformed and rejected responses', async t => {
  let mode = 'normal'; let writes = 0;
  const url = await server(t, (req, res) => {
    if (req.url === '/v1/identity') return json(res, { principal, ignoredSecret: profile.token });
    if (req.method === 'POST') writes++;
    if (mode === 'huge') return json(res, { body: 'x'.repeat(1024 * 1024) });
    if (mode === 'invalid') { res.end(profile.token); return; }
    json(res, { error: { code: 'VERSION_CONFLICT', message: profile.token } }, 409);
  });
  const client = new AgentRelayClient(url, profile);
  assert.deepEqual(await client.identity(), { principal });
  await assert.rejects(client.submit({ type: 'request.create', retryKey: 'keep-this-key', body: '€'.repeat(23_000) }), { code: 'BODY_TOO_LARGE', retryKey: 'keep-this-key' });
  assert.equal(writes, 0);
  await assert.rejects(client.submit({ type: 'request.reply', retryKey: 'keep-this-key' }), error => error.code === 'VERSION_CONFLICT' && error.retryKey === 'keep-this-key' && !error.message.includes(profile.token));
  mode = 'invalid'; await assert.rejects(client.inbox(), error => error.code === 'INVALID_RESPONSE' && !error.message.includes(profile.token));
  mode = 'huge'; await assert.rejects(client.inbox(), { code: 'RESPONSE_TOO_LARGE' });
});
