import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readConfig, databasePath, loadProfile, configuredEndpoint, relayEndpoint } from '../src/cli/profiles.ts';
import { SqliteStore } from '../src/storage/sqlite-store.ts';
import { startRelay } from '../src/relay/server.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const bind = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const close = server => new Promise((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve());
  server.closeAllConnections();
});

function requireData(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return result.structuredContent.data;
}

test('only a profile pinned to the exact HTTPS origin can send a credential there', () => {
  const pinned = 'https://relay.example.test:8443';
  assert.equal(relayEndpoint(pinned, pinned).origin, pinned);
  assert.equal(relayEndpoint('http://127.0.0.1:8787').origin, 'http://127.0.0.1:8787');
  for (const invalid of ['https://example.test:8443', 'https://relay.example.test', 'http://127.0.0.1:8787',
    pinned + '/wrong', pinned + '/?', pinned + '/#', 'https://user@relay.example.test:8443']) {
    assert.throws(() => relayEndpoint(invalid, pinned), { code: 'INVALID_URL' });
  }
  assert.throws(() => relayEndpoint(pinned), { code: 'INVALID_URL' });
  assert.throws(() => configuredEndpoint({ workspace: { id: 'a' }, relayOrigin: pinned }, { workspaceId: 'b', relayOrigin: pinned }),
    { code: 'PROFILE_CONFIG_MISMATCH' });
});

test('separate client homes use a TLS front door, preserve human approval, and catch up after restart', { timeout: 40_000 }, async t => {
  const windowsOpenSSL = path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git', 'usr', 'bin', 'openssl.exe');
  const openssl = process.platform === 'win32' && fs.existsSync(windowsOpenSSL) ? windowsOpenSSL : 'openssl';
  if (spawnSync(openssl, ['version'], { windowsHide: true }).status !== 0) {
    t.skip('Install OpenSSL to run the TLS integration test.');
    return;
  }
  const temp = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temp, 'agentbridge-https-test-'));
  const operator = path.join(directory, 'operator');
  const cert = path.join(directory, 'cert.pem');
  const key = path.join(directory, 'key.pem');
  const certificateConfig = path.join(directory, 'openssl.cnf');
  const clients = [];
  let proxy;
  let relay;
  let store;
  t.after(async () => {
    await Promise.all(clients.map(client => client.close()));
    if (proxy?.listening) await close(proxy);
    if (relay) await relay.close();
    store?.close();
    const target = fs.realpathSync(directory);
    if (path.dirname(target) !== temp || !path.basename(target).startsWith('agentbridge-https-test-')) throw Error('Unsafe cleanup path');
    fs.rmSync(target, { recursive: true, force: true });
  });
  fs.writeFileSync(certificateConfig, '[req]\ndistinguished_name = dn\n[dn]\n');
  await run(openssl, ['req', '-config', certificateConfig, '-new', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert], { cwd: directory, timeout: 8_000 });

  let requests = 0;
  proxy = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    requests++;
    const upstream = new URL(relay.url);
    // Model the documented reverse proxy boundary, including forwarding browser Origin unchanged.
    const backend = http.request(upstream, { path: req.url, method: req.method, headers: { ...req.headers, host: upstream.host } },
      response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    backend.on('error', () => { res.writeHead(503); res.end(); });
    req.pipe(backend);
  });
  await bind(proxy);
  const origin = 'https://127.0.0.1:' + proxy.address().port;
  const exec = (entry, args, options = {}) => run(process.execPath, [path.join(root, 'src/cli', entry), ...args],
    { cwd: root, timeout: 8_000, env: { ...process.env, NODE_EXTRA_CA_CERTS: cert, NODE_TLS_REJECT_UNAUTHORIZED: '1', ...options } });
  const setup = ['init', '--home', operator, '--origin', origin, '--workspace', 'pilot', '--repository', 'https://example.test/fixture.git',
    '--participants', 'alice,bob'];
  const initialized = JSON.parse((await exec('relay.ts', setup)).stdout);
  assert.equal(initialized.initialized, true);
  assert.ok(initialized.profiles.every(profile => profile.relayOrigin === origin && !('token' in profile)));
  await assert.rejects(exec('relay.ts', setup.map(arg => arg === origin ? 'https://another.example.test' : arg)),
    error => error.stderr.includes('WORKSPACE_CONFIG_CONFLICT'));
  const config = readConfig(operator);
  assert.equal(config.relayOrigin, origin);
  store = new SqliteStore(databasePath(operator), config.workspace);
  relay = await startRelay(store, 0);

  function member(name, roles) {
    const home = path.join(directory, name);
    fs.mkdirSync(home, { mode: 0o700 });
    const copy = relative => fs.writeFileSync(path.join(home, relative), fs.readFileSync(path.join(operator, relative)), { mode: 0o600, flag: 'wx' });
    copy('server.json');
    for (const role of roles) {
      const folder = role === 'agent' ? 'agents' : 'humans';
      fs.mkdirSync(path.join(home, folder), { mode: 0o700 });
      copy(folder + '/' + name + '-' + role + '.json');
    }
    return home;
  }
  const aliceHome = member('alice', ['agent']);
  const bobHome = member('bob', ['agent', 'human']);
  assert.equal(fs.existsSync(databasePath(aliceHome)), false);
  assert.equal(fs.existsSync(databasePath(bobHome)), false);
  const bridge = (home, profile, ...args) => exec('bridge.ts', ['--home', home, '--profile', profile, ...args]);
  const before = requests;
  await assert.rejects(bridge(aliceHome, 'alice-agent', '--url', relay.url, 'whoami'), error => error.stderr.includes('INVALID_URL'));
  await assert.rejects(exec('bridge.ts', ['--home', aliceHome, '--profile', 'alice-agent', 'whoami'], { NODE_EXTRA_CA_CERTS: '' }),
    error => error.stderr.includes('NETWORK_ERROR'));
  assert.equal(requests, before, 'invalid endpoints and untrusted certificates never reach the HTTPS handler');
  const webCode = await new Promise((resolve, reject) => {
    const req = https.get(origin + '/v1/identity', { ca: fs.readFileSync(cert), headers: {
      origin, authorization: 'Bearer ' + loadProfile(aliceHome, 'alice-agent').token,
    } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(webCode, 403);

  async function mcp(home, profile) {
    const transport = new StdioClientTransport({ command: process.execPath, stderr: 'pipe',
      args: [path.join(root, 'src/mcp/stdio.ts'), '--home', home, '--profile', profile],
      env: { NODE_EXTRA_CA_CERTS: cert, NODE_TLS_REJECT_UNAUTHORIZED: '1' } });
    const client = new Client({ name: 'https-pilot-test', version: '1' });
    clients.push(client);
    await client.connect(transport);
    return (name, args) => client.callTool({ name: 'agentbridge_' + name, arguments: args });
  }
  const alice = await mcp(aliceHome, 'alice-agent');
  const bob = await mcp(bobHome, 'bob-agent');
  const task = { recipientId: 'bob', title: 'Expose severity', body: 'Include the calculated severity.', retryKey: 'https-create' };
  const { request: made, event } = requireData(await alice('request', task));
  await assert.rejects(bridge(bobHome, 'bob-agent', 'accept', '--id', made.id, '--version', '1'), error => error.stderr.includes('FORBIDDEN'));
  const { request: accepted } = JSON.parse((await bridge(bobHome, 'bob-human', 'accept', '--id', made.id, '--version', '1')).stdout);
  const { request: started } = requireData(await bob('start', { requestId: made.id, expectedVersion: accepted.version, retryKey: 'https-start' }));
  const { request: done } = requireData(await bob('complete', {
    requestId: made.id, expectedVersion: started.version, retryKey: 'https-complete',
    branch: 'lab/bob', commit: 'b'.repeat(40), summary: 'Synthetic transport exercise',
    checks: [{ command: 'producer tests', outcome: 'not_run', details: 'Only the transport is exercised.' }],
  }));
  assert.equal(done.status, 'completed');

  await relay.close();
  store.close();
  store = new SqliteStore(databasePath(operator), config.workspace);
  relay = await startRelay(store, 0);
  const catchup = requireData(await alice('events', { after: event.cursor }));
  assert.deepEqual(catchup.events.map(event => event.operation), ['request.accept', 'request.start', 'request.complete']);
  assert.equal(requireData(await alice('request', task)).replayed, true);
  assert.equal(requireData(await alice('get_request', { requestId: made.id })).request.status, 'completed');

  store.revokeCredential(loadProfile(operator, 'bob-agent').credentialId);
  const revoked = await bob('inbox', {});
  assert.equal(revoked.isError, true);
  assert.equal(JSON.parse(revoked.content[0].text).error.code, 'UNAUTHORIZED');
});
