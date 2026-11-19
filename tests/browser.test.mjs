import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../src/storage/sqlite-store.ts';
import { startRelay } from '../src/relay/server.ts';

const workspace = { id: 'browser-test', repository: 'https://example.test/fixture.git', participants: ['alice', 'bob'] };
const origin = 'https://pilot.example.test';

function setup(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'agentbridge-browser-test-'));
  const filename = path.join(directory, 'relay.db');
  const store = new SqliteStore(filename, workspace);
  t.after(() => {
    store.close();
    const target = fs.realpathSync(directory);
    if (path.dirname(target) !== parent || !path.basename(target).startsWith('agentbridge-browser-test-')) throw Error('Unsafe cleanup path');
    fs.rmSync(target, { recursive: true, force: true });
  });
  return { filename, store };
}

test('browser access is workspace-bound, one-use, time-limited, hash-only, and revocable', t => {
  const { filename, store } = setup(t);
  const operator = new SqliteStore(filename, workspace);
  const other = new SqliteStore(filename, { ...workspace, id: 'other' });
  const database = new DatabaseSync(filename);
  try {
    const invite = operator.issueBrowserInvite('bob');
    assert.equal(other.redeemBrowserInvite(invite.token), null);
    assert.equal(store.authenticateBrowser(invite.token), null);
    assert.equal(store.redeemBrowserInvite(store.issueCredential('bob', 'agent').token), null);

    const session = store.redeemBrowserInvite(invite.token);
    assert.ok(session);
    assert.equal(operator.redeemBrowserInvite(invite.token), null);
    assert.equal(other.authenticateBrowser(session), null);
    assert.equal(store.authenticate(session), null);
    assert.deepEqual(operator.authenticateBrowser(session), { workspaceId: workspace.id, participantId: 'bob', role: 'human' });
    const access = database.prepare('SELECT token_hash FROM browser_access WHERE id = ?').get(invite.id);
    assert.match(access.token_hash, /^[a-f0-9]{64}$/);
    assert.equal(other.revokeBrowserAccess(invite.id), false);
    assert.equal(operator.revokeBrowserAccess(invite.id), true);
    assert.equal(store.authenticateBrowser(session), null);

    const expired = store.issueBrowserInvite('alice');
    database.prepare('UPDATE browser_access SET expires_at = 0 WHERE id = ?').run(expired.id);
    assert.equal(store.redeemBrowserInvite(expired.token), null);
    const current = store.issueBrowserInvite('alice');
    const currentSession = store.redeemBrowserInvite(current.token);
    database.prepare('UPDATE browser_access SET expires_at = 0 WHERE id = ?').run(current.id);
    assert.equal(store.authenticateBrowser(currentSession), null);
  } finally {
    database.close();
    other.close();
    operator.close();
  }
});

test('the invite inbox accepts only recipient decisions on the current request version', async t => {
  const { store } = setup(t);
  await assert.rejects(startRelay(store, 0, 'http://pilot.example.test'), /canonical HTTPS origin/);
  const relay = await startRelay(store, 0, origin);
  try {
    const alice = store.issueCredential('alice', 'agent');
    const bob = store.issueCredential('bob', 'agent');
    const aliceInvite = store.issueBrowserInvite('alice');
    const bobInvite = store.issueBrowserInvite('bob');
    const send = async (route, { data, cookie, bearer, requestOrigin } = {}) => {
      const response = await fetch(relay.url + route, {
        method: data === undefined ? 'GET' : 'POST',
        headers: {
          ...(data === undefined ? {} : { 'content-type': 'application/json' }),
          ...(cookie ? { cookie } : {}),
          ...(bearer ? { authorization: 'Bearer ' + bearer } : {}),
          ...(requestOrigin ? { origin: requestOrigin } : {}),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const type = response.headers.get('content-type');
      return { status: response.status, data: type.startsWith('application/json') ? await response.json() : await response.text(), headers: response.headers };
    };
    const web = (route, options) => send('/workspace/api/' + route, options);
    const post = (route, data, cookie, requestOrigin = origin) => web(route, { data, cookie, requestOrigin });
    const page = await send('/workspace/');
    assert.equal(page.status, 200);
    assert.match(page.data, /Workspace inbox/);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await send('/workspace/app.js')).status, 200);
    assert.equal((await web('inbox')).status, 401);
    assert.equal((await web('inbox', { bearer: bob.token })).status, 401);
    assert.equal((await post('sign-in', { invite: bobInvite.token }, undefined, 'https://example.test')).status, 403);

    const login = async invite => {
      const result = await post('sign-in', { invite: invite.token });
      assert.equal(result.status, 200);
      assert.deepEqual(result.data, { signedIn: true });
      const setCookie = result.headers.get('set-cookie');
      assert.match(setCookie, /^__Host-agentbridge=abs_.+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/);
      return setCookie.split(';')[0];
    };
    const aliceCookie = await login(aliceInvite);
    const bobCookie = await login(bobInvite);
    assert.equal((await post('sign-in', { invite: bobInvite.token })).status, 401);
    assert.equal((await send('/v1/inbox', { cookie: bobCookie })).status, 401);
    assert.equal((await send('/v1/inbox', { bearer: bob.token, requestOrigin: origin })).status, 403);

    const create = { type: 'request.create', recipientId: 'bob', title: 'Add severity', body: 'Include a severity field.', retryKey: 'create' };
    const { data: { request } } = await send('/v1/commands', { data: create, bearer: alice.token });
    const inbox = await web('inbox', { cookie: bobCookie });
    assert.equal(inbox.data.participant, 'bob');
    assert.equal(inbox.data.request.id, request.id);
    assert.equal(inbox.data.events[0].operation, 'request.create');
    assert.equal((await web('inbox', { cookie: bobCookie, requestOrigin: 'https://example.test' })).status, 403);

    const accept = { type: 'request.accept', requestId: request.id, expectedVersion: 1, retryKey: 'accept' };
    assert.equal((await web('decision', { data: accept, cookie: bobCookie })).status, 403);
    assert.equal((await web('decision', { data: accept, bearer: bob.token, requestOrigin: origin })).status, 401);
    assert.equal((await post('decision', accept, aliceCookie)).status, 403);
    assert.equal((await post('decision', { ...accept, type: 'request.start' }, bobCookie)).status, 400);
    const reply = { type: 'request.reply', requestId: request.id, expectedVersion: 1, body: 'Updated details', retryKey: 'reply' };
    assert.equal((await send('/v1/commands', { data: reply, bearer: bob.token })).status, 200);
    assert.equal((await post('decision', accept, bobCookie)).status, 409);
    const current = { ...accept, expectedVersion: 2 };
    assert.equal((await post('decision', current, bobCookie)).data.request.status, 'accepted');
    assert.equal((await post('decision', current, bobCookie)).data.replayed, true);

    const start = { type: 'request.start', requestId: request.id, expectedVersion: 3, retryKey: 'start' };
    assert.equal((await send('/v1/commands', { data: start, bearer: bob.token })).status, 200);
    const complete = { ...start, type: 'request.complete', expectedVersion: 4, retryKey: 'complete',
      branch: 'fixture/bob', commit: 'a'.repeat(40), summary: 'Reported from the test',
      checks: [{ command: 'node test', outcome: 'passed' }] };
    assert.equal((await send('/v1/commands', { data: complete, bearer: bob.token })).status, 200);
    const final = await web('inbox?request=' + request.id, { cookie: aliceCookie });
    assert.equal(final.data.request.status, 'completed');
    assert.equal(final.data.request.completion.commit, complete.commit);
    assert.deepEqual(final.data.events.map(event => event.operation), ['request.create', 'request.reply', 'request.accept', 'request.start', 'request.complete']);
    assert.equal((await post('sign-out', {}, bobCookie)).status, 200);
    assert.equal((await web('inbox', { cookie: bobCookie })).status, 401);
  } finally {
    await relay.close();
  }
});
