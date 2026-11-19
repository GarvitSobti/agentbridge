import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../src/storage/sqlite-store.ts';
import { startRelay, MAX_BODY_BYTES } from '../src/relay/server.ts';

const workspace = { id: 'http-demo', repository: 'local://synthetic', participants: ['alice', 'bob'] };
function temporary(t, cleanup = async () => {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbridge-relay-test-'));
  t.after(async () => {
    await cleanup();
    const absolute = fs.realpathSync(directory);
    if (path.dirname(absolute) !== fs.realpathSync(os.tmpdir()) || !path.basename(absolute).startsWith('agentbridge-relay-test-')) throw Error('Unsafe test cleanup');
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  return directory;
}
async function fixture(t) {
  let store;
  let relay;
  const directory = temporary(t, async () => { if (relay) await relay.close(); store?.close(); });
  const filename = path.join(directory, 'relay.db');
  store = new SqliteStore(filename, workspace);
  const credentials = {};
  for (const person of ['alice', 'bob']) for (const role of ['agent', 'human']) credentials[`${person}-${role}`] = store.issueCredential(person, role);
  relay = await startRelay(store, 0);
  const send = async (profile, route, command, extra = {}) => {
    const response = await fetch(new URL(route, relay.url), { method: command === undefined ? 'GET' : 'POST',
      headers: { ...(profile ? { authorization: 'Bearer ' + credentials[profile].token } : {}),
        ...(command === undefined ? {} : { 'content-type': 'application/json' }), ...(extra.headers ?? {}) },
      ...(command === undefined ? {} : { body: JSON.stringify(command) }), signal: AbortSignal.timeout(5_000) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  };
  return { directory, filename, credentials, send, get store() { return store; }, get relay() { return relay; }, async restart() {
    await relay.close(); store.close();
    store = new SqliteStore(filename, workspace); relay = await startRelay(store, 0);
  } };
}
const create = (retryKey = 'http-create') => ({ type: 'request.create', retryKey, recipientId: 'bob', title: 'Expose severity', body: 'Need a severity field.' });

test('opaque credentials persist as hashes and revocation survives reopening', t => {
  const directory = temporary(t); const filename = path.join(directory, 'auth.db');
  let store = new SqliteStore(filename, workspace);
  try {
    const issued = store.issueCredential('bob', 'agent');
    assert.deepEqual(store.authenticate(issued.token), issued.principal);
    for (const invalid of [null, '', 'ab_invalid', issued.token.slice(0, -1) + (issued.token.endsWith('a') ? 'b' : 'a')]) assert.equal(store.authenticate(invalid), null);
    const db = new DatabaseSync(filename);
    try {
      const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(issued.id);
      assert.equal(row.token_hash.length, 64);
      assert.ok(!JSON.stringify(row).includes(issued.token));
    } finally { db.close(); }
    store.close(); store = new SqliteStore(filename, workspace);
    assert.deepEqual(store.authenticate(issued.token), issued.principal);
    assert.equal(store.revokeCredential(issued.id), true);
    assert.equal(store.revokeCredential(issued.id), false);
    store.close(); store = new SqliteStore(filename, workspace);
    assert.equal(store.authenticate(issued.token), null);
  } finally { store.close(); }
});

test('schema v1 upgrades to the current schema without changing saved work', t => {
  const directory = temporary(t); const filename = path.join(directory, 'upgrade.db');
  let store = new SqliteStore(filename, workspace);
  const request = store.execute({ workspaceId: workspace.id, participantId: 'alice', role: 'agent' }, create()).request;
  store.close();
  const db = new DatabaseSync(filename);
  try { db.exec('DROP TABLE agent_pairs; DROP TABLE browser_access; DROP TABLE credentials; PRAGMA user_version = 1'); } finally { db.close(); }
  store = new SqliteStore(filename, workspace);
  try {
    assert.deepEqual(store.getRequest({ workspaceId: workspace.id, participantId: 'alice', role: 'agent' }, request.id), request);
    assert.ok(store.issueCredential('bob', 'human').token);
  } finally { store.close(); }
});

test('real HTTP enforces agent/human ownership and completes a two-party lifecycle', async t => {
  const f = await fixture(t);
  const created = await f.send('alice-agent', '/v1/commands', create());
  assert.equal(created.status, 200);
  let request = created.data.request;
  const accept = { type: 'request.accept', requestId: request.id, expectedVersion: 1, retryKey: 'approve' };
  for (const profile of ['bob-agent', 'alice-agent', 'alice-human']) {
    const response = await f.send(profile, '/v1/commands', accept);
    assert.equal(response.status, 403); assert.equal(response.data.error.code, 'FORBIDDEN');
  }
  const identity = await f.send('bob-agent', '/v1/identity');
  assert.equal(identity.data.principal.role, 'agent');
  request = (await f.send('bob-human', '/v1/commands', accept)).data.request;
  request = (await f.send('bob-agent', '/v1/commands', { type: 'request.start', requestId: request.id, expectedVersion: request.version, retryKey: 'start' })).data.request;
  const completed = await f.send('bob-agent', '/v1/commands', { type: 'request.complete', requestId: request.id, expectedVersion: request.version,
    retryKey: 'complete', branch: 'feat/severity', commit: 'a'.repeat(40), summary: 'Synthetic work report.',
    checks: [{ command: 'integration test', outcome: 'not_run', details: 'No real code is edited in this fixture.' }] });
  assert.equal(completed.status, 200);
  assert.equal(completed.data.request.completion.verification, 'self_reported');
  assert.equal((await f.send('bob-agent', '/v1/inbox')).data.requests.length, 0);
});

test('identity cannot be supplied in a task and unauthorized requests reveal no credential', async t => {
  const f = await fixture(t);
  assert.equal((await f.send(null, '/health')).status, 200);
  for (const route of ['/v1/inbox', '/v1/events', '/v1/requests/missing']) {
    const response = await f.send(null, route); assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
  }
  const forged = await f.send('alice-agent', '/v1/commands', { ...create(), role: 'human', requesterId: 'bob' });
  assert.equal(forged.status, 400);
  const unknown = await f.send(null, '/v1/inbox', undefined, { headers: { authorization: 'Bearer ab_' + 'z'.repeat(43) } });
  assert.equal(unknown.status, 401);
  assert.ok(!JSON.stringify(unknown.data).includes('z'.repeat(43)));
  const issued = f.credentials['alice-agent']; f.store.revokeCredential(issued.id);
  assert.equal((await f.send('alice-agent', '/v1/commands', create())).status, 401);
});

test('concurrent HTTP retries commit once, and stale updates return conflicts', async t => {
  const f = await fixture(t);
  const replies = await Promise.all([f.send('alice-agent', '/v1/commands', create()), f.send('alice-agent', '/v1/commands', create())]);
  assert.deepEqual(replies.map(r => r.data.replayed).sort(), [false, true]);
  const request = replies[0].data.request;
  const edit = { type: 'request.reply', requestId: request.id, expectedVersion: 1, body: 'Clarifying severity' };
  const updates = await Promise.all(['one', 'two'].map(key => f.send('bob-agent', '/v1/commands', { ...edit, retryKey: key })));
  assert.deepEqual(updates.map(r => r.status).sort(), [200, 409]);
  assert.equal(updates.find(r => r.status === 409).data.error.code, 'VERSION_CONFLICT');
  assert.equal((await f.send('alice-agent', '/v1/events')).data.events.length, 2);
});

test('relay restart preserves credentials, inbox state, event cursors, and safe retry', async t => {
  const f = await fixture(t);
  const created = await f.send('alice-agent', '/v1/commands', create());
  await f.restart();
  const inbox = await f.send('bob-agent', '/v1/inbox');
  assert.equal(inbox.status, 200); assert.equal(inbox.data.requests[0].id, created.data.request.id);
  assert.equal((await f.send('alice-agent', '/v1/commands', create())).data.replayed, true);
  const accept = { type: 'request.accept', requestId: created.data.request.id, expectedVersion: 1, retryKey: 'accept' };
  assert.equal((await f.send('bob-human', '/v1/commands', accept)).status, 200);
  assert.deepEqual((await f.send('bob-agent', '/v1/events?after=1&limit=1')).data.events.map(e => e.cursor), [2]);
});

test('HTTP rejects invalid JSON, oversized bodies, browser origins, and ambiguous queries', async t => {
  const f = await fixture(t); const token = f.credentials['alice-agent'].token;
  const raw = async (body, headers = {}) => fetch(f.relay.url + '/v1/commands', { method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...headers }, body });
  assert.equal((await raw('{bad json')).status, 400);
  assert.equal((await raw('{}', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await raw('x'.repeat(MAX_BODY_BYTES + 1))).status, 413);
  assert.equal((await raw(JSON.stringify(create()), { origin: 'https://example.com' })).status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    const request = http.get(f.relay.url + '/v1/inbox', { headers: { host: 'attacker.example', authorization: 'Bearer ' + token } }, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
  });
  assert.equal(wrongHost, 403);
  for (const route of ['/v1/events?after=0&after=1', '/v1/events?limit=101', '/v1/events?after=-1', '/v1/inbox?token=secret']) {
    assert.equal((await f.send('alice-agent', route)).status, 400);
  }
  assert.equal((await f.send('bob-agent', '/v1/inbox')).data.requests.length, 0);
});

test('a credential revoked during a partial body cannot execute the command', async t => {
  const f = await fixture(t); const credential = f.credentials['alice-agent'];
  const payload = JSON.stringify(create());
  let request;
  const outcome = new Promise((resolve, reject) => {
    request = http.request(f.relay.url + '/v1/commands', { method: 'POST', headers: {
      authorization: 'Bearer ' + credential.token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
    } }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() })); });
    request.once('error', reject);
  });
  request.write(payload.slice(0, 10));
  await new Promise(resolve => setTimeout(resolve, 30));
  f.store.revokeCredential(credential.id);
  request.end(payload.slice(10));
  const result = await outcome;
  assert.equal(result.status, 401);
  assert.ok(!result.body.includes(credential.token));
  assert.equal((await f.send('bob-agent', '/v1/inbox')).data.requests.length, 0);
});

test('only loopback binding is offered and lifecycle shutdown is idempotent', async t => {
  const f = await fixture(t);
  assert.equal(new URL(f.relay.url).hostname, '127.0.0.1');
  await assert.rejects(() => startRelay(f.store, -1), RangeError);
  await f.relay.close(); await f.relay.close();
});

test('chunked bodies obey the byte limit without a Content-Length header', async t => {
  const f = await fixture(t);
  const outcome = await new Promise((resolve, reject) => {
    const request = http.request(f.relay.url + '/v1/commands', { method: 'POST', headers: {
      authorization: 'Bearer ' + f.credentials['alice-agent'].token, 'content-type': 'application/json',
    } }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
    request.once('error', reject);
    request.write('"' + 'x'.repeat(MAX_BODY_BYTES)); request.end('"');
  });
  assert.equal(outcome, 413);
  assert.equal((await f.send('bob-agent', '/v1/inbox')).data.requests.length, 0);
});

test('revocation is checked before returning a previously successful command receipt', async t => {
  const f = await fixture(t);
  assert.equal((await f.send('alice-agent', '/v1/commands', create())).status, 200);
  f.store.revokeCredential(f.credentials['alice-agent'].id);
  assert.equal((await f.send('alice-agent', '/v1/commands', create())).status, 401);
  assert.equal((await f.send('bob-agent', '/v1/events')).data.events.length, 1);
});
