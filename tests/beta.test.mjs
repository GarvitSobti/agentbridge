import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { BetaHost, initializeBeta } from '../src/relay/beta.ts';
import { startRelay } from '../src/relay/server.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('owner and teammate create a workspace and pair distinct agents for a real HTTPS handoff', { timeout: 45_000 }, async t => {
  const windowsOpenSSL = path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git', 'usr', 'bin', 'openssl.exe');
  const openssl = process.platform === 'win32' && fs.existsSync(windowsOpenSSL) ? windowsOpenSSL : 'openssl';
  if (spawnSync(openssl, ['version'], { windowsHide: true }).status !== 0) {
    t.skip('Install OpenSSL to run the HTTPS beta test.');
    return;
  }
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'agentbridge-beta-test-'));
  const home = path.join(directory, 'host');
  const clients = [];
  let proxy;
  let relay;
  let host;
  t.after(async () => {
    await Promise.all(clients.map(client => client.close()));
    if (proxy?.listening) await new Promise(resolve => { proxy.close(resolve); proxy.closeAllConnections(); });
    await relay?.close();
    host?.close();
    const target = fs.realpathSync(directory);
    if (path.dirname(target) !== parent || !path.basename(target).startsWith('agentbridge-beta-test-')) throw Error('Unsafe cleanup path');
    fs.rmSync(target, { recursive: true, force: true });
  });
  const cert = path.join(directory, 'cert.pem');
  const key = path.join(directory, 'key.pem');
  const config = path.join(directory, 'openssl.cnf');
  fs.writeFileSync(config, '[req]\ndistinguished_name = dn\n[dn]\n');
  assert.equal(spawnSync(openssl, ['req', '-config', config, '-new', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert], { timeout: 8_000 }).status, 0);
  const ca = fs.readFileSync(cert);
  proxy = https.createServer({ key: fs.readFileSync(key), cert: ca }, (req, res) => {
    const target = new URL(relay.url);
    const upstream = http.request(target, { method: req.method, path: req.url, headers: { ...req.headers, host: target.host } }, reply => {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
    });
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const origin = 'https://127.0.0.1:' + proxy.address().port;
  const token = (link, name) => new URLSearchParams(new URL(link).hash.slice(1)).get(name);
  const firstOwner = initializeBeta(home, origin);
  const owner = initializeBeta(home, origin);
  assert.notEqual(owner.url, firstOwner.url);
  assert.ok(!fs.readFileSync(path.join(home, 'owner.json'), 'utf8').includes(token(owner.url, 'owner')));
  host = new BetaHost(home);
  relay = await startRelay(undefined, 0, origin, host);
  assert.equal(host.store, undefined);

  function send(route, { data, cookie, browserOrigin, bearer } = {}) {
    return new Promise((resolve, reject) => {
      const payload = data === undefined ? undefined : JSON.stringify(data);
      const request = https.request(origin + route, {
        ca, method: payload === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(8_000),
        headers: {
          ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
          ...(cookie ? { cookie } : {}), ...(browserOrigin ? { origin: browserOrigin } : {}),
          ...(bearer ? { authorization: 'Bearer ' + bearer } : {}),
        },
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          try {
            const content = Buffer.concat(chunks).toString();
            resolve({
              status: response.statusCode,
              cookie: response.headers['set-cookie']?.[0]?.split(';')[0],
              data: response.headers['content-type']?.startsWith('application/json') ? JSON.parse(content) : content,
            });
          } catch (error) { reject(error); }
        });
      });
      request.on('error', reject);
      request.end(payload);
    });
  }
  const call = (route, data, cookie, browserOrigin = origin) => send('/workspace/api/' + route, { data, cookie, browserOrigin });
  const inbox = cookie => send('/workspace/api/inbox', { cookie });
  const workspace = { name: 'Contract handoff', repository: 'https://example.test/team/fixture.git', owner: 'alice', teammate: 'bob' };
  const create = { ...workspace, invite: token(owner.url, 'owner') };
  assert.match((await send('/workspace/')).data, /Create workspace/);
  assert.equal((await inbox()).status, 401);
  assert.equal((await call('create', create, undefined, 'https://example.test')).status, 403);
  assert.equal((await call('create', { ...workspace, invite: token(firstOwner.url, 'owner') })).status, 401);
  assert.equal((await call('create', { ...create, repository: 'https://user:pass@example.test/repo' })).status, 400);

  const issued = await Promise.all([call('create', create), call('create', create)]);
  assert.deepEqual(issued.map(result => result.status).sort(), [201, 409]);
  const aliceCookie = issued.find(result => result.status === 201).cookie;
  assert.ok(aliceCookie);
  const alice = await inbox(aliceCookie);
  assert.equal(alice.data.workspace.name, workspace.name);
  assert.equal(alice.data.setup.canInvite, true);
  assert.deepEqual(alice.data.setup.paired, []);
  assert.equal((await call('invite', {})).status, 401);

  const oldLink = await call('invite', {}, aliceCookie);
  const link = await call('invite', {}, aliceCookie);
  assert.equal(oldLink.status, 201);
  assert.equal(link.status, 201);
  assert.equal((await call('sign-in', { invite: token(oldLink.data.url, 'invite') })).status, 401);
  const bob = await call('sign-in', { invite: token(link.data.url, 'invite') });
  assert.equal(bob.status, 200);
  assert.equal((await call('sign-in', { invite: token(link.data.url, 'invite') })).status, 401);
  assert.equal((await call('invite', {}, bob.cookie)).status, 403);

  const codeFor = async cookie => {
    const result = await call('pair-code', {}, cookie);
    assert.equal(result.status, 201);
    return result.data.code;
  };
  const manualCode = await codeFor(aliceCookie);
  const manualToken = 'ab_' + randomBytes(32).toString('base64url');
  const data = { code: manualCode, tokenHash: sha256(manualToken) };
  const claim = await send('/v1/pair', { data });
  assert.equal(claim.status, 200);
  assert.equal(claim.data.principal.participantId, 'alice');
  assert.ok(!('token' in claim.data));
  assert.deepEqual((await send('/v1/pair', { data })).data, claim.data);
  assert.equal((await send('/v1/pair', { data: { ...data, tokenHash: '1'.repeat(64) } })).status, 401);
  assert.equal((await send('/v1/pair', { data, browserOrigin: origin })).status, 403);

  function connect(code, participant, client) {
    const env = { ...process.env, NODE_EXTRA_CA_CERTS: cert, NODE_TLS_REJECT_UNAUTHORIZED: '1' };
    return new Promise((resolve, reject) => {
      const child = execFile(process.execPath, [
        path.join(root, 'src/cli/connect.ts'), '--origin', origin, '--client', client,
        '--home', path.join(directory, participant), '--profile-only',
      ], { cwd: root, env, timeout: 12_000, windowsHide: true }, (error, stdout) => {
        if (error) reject(new Error('Pairing CLI failed for ' + participant + ': ' + error.stderr));
        else {
          try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
        }
      });
      child.stdin.on('error', reject);
      child.stdin.end(code + '\n');
    });
  }
  const aliceDevice = await connect(await codeFor(aliceCookie), 'alice', 'codex');
  const bobDevice = await connect(await codeFor(bob.cookie), 'bob', 'claude');
  assert.equal(aliceDevice.principal.participantId, 'alice');
  assert.equal(bobDevice.principal.participantId, 'bob');
  assert.equal((await send('/v1/identity', { bearer: manualToken })).status, 401);
  assert.deepEqual(new Set((await inbox(bob.cookie)).data.setup.paired), new Set(['alice', 'bob']));

  async function mcp(device) {
    const transport = new StdioClientTransport({
      command: process.execPath, args: [path.join(root, 'src/mcp/stdio.ts'), '--home', device.home, '--profile', device.profile],
      env: { NODE_EXTRA_CA_CERTS: cert, NODE_TLS_REJECT_UNAUTHORIZED: '1' }, stderr: 'pipe',
    });
    const client = new Client({ name: 'beta-onboarding-test', version: '1' });
    clients.push(client);
    await client.connect(transport);
    return async (name, args) => {
      const result = await client.callTool({ name: 'agentbridge_' + name, arguments: args });
      assert.notEqual(result.isError, true, JSON.stringify(result.content));
      return result.structuredContent.data;
    };
  }
  const sendAlice = await mcp(aliceDevice);
  const sendBob = await mcp(bobDevice);
  const { request } = await sendAlice('request', {
    recipientId: 'bob', title: 'Expose a deadline', body: 'Include the agreed deadline.', retryKey: 'beta-request',
  });
  const accepted = await call('decision', {
    type: 'request.accept', requestId: request.id, expectedVersion: request.version, retryKey: 'beta-accept',
  }, bob.cookie);
  assert.equal(accepted.data.request.status, 'accepted');
  const { request: started } = await sendBob('start', { requestId: request.id, expectedVersion: accepted.data.request.version, retryKey: 'beta-start' });
  await sendBob('complete', {
    requestId: request.id, expectedVersion: started.version, retryKey: 'beta-complete',
    branch: 'fixture/bob', commit: 'a'.repeat(40), summary: 'Synthetic handoff report.',
    checks: [{ command: 'fixture checks', outcome: 'not_run', details: 'This exercise verifies onboarding and transport.' }],
  });
  await relay.close();
  host.close();
  host = new BetaHost(home);
  relay = await startRelay(undefined, 0, origin, host);
  const finished = await inbox(aliceCookie);
  assert.equal(finished.data.request.status, 'completed');
  assert.deepEqual(new Set(finished.data.setup.paired), new Set(['alice', 'bob']));
  assert.equal((await sendAlice('get_request', { requestId: request.id })).request.status, 'completed');
});
