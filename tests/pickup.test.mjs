import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { initializeLocal, loadProfile, databasePath } from '../src/cli/local.ts';
import { startRelay } from '../src/relay/server.ts';
import { SqliteStore } from '../src/storage/sqlite-store.ts';
import { AgentRelayClient } from '../src/mcp/relay-client.ts';
import { runApprovedPickup } from '../src/pickup/runner.ts';

test('a human reviews the exact prompt and a local runner claims and commits it once', { timeout: 30_000 }, async t => {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'agentbridge-pickup-test-'));
  const home = path.join(directory, 'private');
  const repository = path.join(directory, 'repo');
  const workspace = { id: 'pickup-test', repository: 'https://example.test/team/fixture.git', participants: ['garvit', 'nitipa'] };
  const origin = 'https://workspace.example.test';
  const hooks = path.join(directory, 'absent-hooks');
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.hooksPath=' + hooks, ...args],
    { cwd, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  fs.mkdirSync(repository);
  git(repository, 'init', '--initial-branch=main', '--template=');
  git(repository, 'config', 'user.name', 'Pickup Fixture');
  git(repository, 'config', 'user.email', 'fixture@example.test');
  git(repository, 'config', 'commit.gpgSign', 'false');
  git(repository, 'remote', 'add', 'origin', workspace.repository);
  fs.writeFileSync(path.join(repository, 'producer.mjs'), 'export const hours = 4;\n');
  git(repository, 'add', 'producer.mjs');
  git(repository, 'commit', '-m', 'Base fixture');
  const base = git(repository, 'rev-parse', 'HEAD');

  initializeLocal(home, 8787, { workspace });
  let store = new SqliteStore(databasePath(home), workspace);
  let relay = await startRelay(store, 0, origin);
  const port = Number(new URL(relay.url).port);
  t.after(async () => {
    await relay.close();
    store.close();
    const target = fs.realpathSync(directory);
    if (path.dirname(target) !== parent || !path.basename(target).startsWith('agentbridge-pickup-test-')) throw Error('Unsafe cleanup path');
    fs.rmSync(target, { recursive: true, force: true });
  });

  const profile = loadProfile(home, 'nitipa-agent');
  const garvit = new AgentRelayClient(relay.url, loadProfile(home, 'garvit-agent'));
  const nitipa = new AgentRelayClient(relay.url, profile);
  const send = async (route, data, cookie) => {
    const response = await fetch(relay.url + '/workspace/api/' + route, {
      method: data ? 'POST' : 'GET',
      headers: { ...(cookie ? { cookie } : {}),
        ...(data ? { 'content-type': 'application/json', origin } : {}) },
      body: data && JSON.stringify(data),
      signal: AbortSignal.timeout(4000),
    });
    return { status: response.status, data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const browser = await send('sign-in', { invite: store.issueBrowserInvite('nitipa').token });
  assert.equal(browser.status, 200);
  const owner = await send('sign-in', { invite: store.issueBrowserInvite('garvit').token });
  const recipient = browser.cookie;

  const { request } = await garvit.submit({ type: 'request.create', retryKey: 'pickup-preview', recipientId: 'nitipa',
    title: 'Change the producer deadline', body: 'The producer must return one hour.', references: [{ path: 'producer.mjs' }] });
  const inbox = () => send('inbox?request=' + request.id, undefined, recipient);
  const { data: { pickupPreview: first } } = await inbox();
  assert.match(first.prompt, /The producer must return one hour/);
  assert.equal((await send('inbox', undefined, owner.cookie)).data.pickupPreview, undefined);
  const approval = {
    type: 'request.approve_pickup', requestId: request.id, expectedVersion: request.version,
    retryKey: 'approve-original', promptHash: first.promptHash,
  };
  assert.equal((await send('decision', approval, owner.cookie)).status, 403);
  await assert.rejects(nitipa.submit({ ...approval, type: 'request.claim_pickup' }), { code: 'INVALID_STATE' });
  await garvit.submit({ type: 'request.reply', requestId: request.id, expectedVersion: request.version,
    retryKey: 'clarify', body: 'Use an integer for the deadline.' });
  assert.equal((await send('decision', approval, recipient)).status, 409);
  const next = (await inbox()).data;
  assert.match(next.pickupPreview.prompt, /Use an integer/);
  const updated = { ...approval, expectedVersion: next.request.version, retryKey: 'approve-updated', promptHash: next.pickupPreview.promptHash };
  const accepted = await send('decision', updated, recipient);
  assert.equal(accepted.data.request.status, 'accepted');
  assert.equal(accepted.data.request.pickup.prompt, next.pickupPreview.prompt);
  assert.equal((await send('decision', updated, recipient)).data.replayed, true);

  await relay.close();
  store.close();
  store = new SqliteStore(databasePath(home), workspace);
  relay = await startRelay(store, port, origin);
  let edits = 0;
  const options = {
    relay: nitipa, repository, expectedRepository: workspace.repository,
    stateDirectory: path.join(home, 'pickups'),
    async edit(prompt, checkout) {
      edits++;
      assert.equal(prompt, next.pickupPreview.prompt);
      fs.writeFileSync(path.join(checkout, 'producer.mjs'), 'export const hours = 1;\n');
      return 'Set the producer deadline to one hour.';
    },
  };
  const results = await Promise.all([runApprovedPickup(options), runApprovedPickup(options)]);
  assert.equal(edits, 1);
  const completed = results.find(result => result.status === 'completed');
  assert.ok(completed, JSON.stringify(results));
  assert.equal(git(repository, 'rev-parse', 'HEAD'), base);
  assert.equal(git(repository, 'show', completed.commit + ':producer.mjs'), 'export const hours = 1;');
  assert.equal((await inbox()).data.request.completion.commit, completed.commit);
  assert.equal((await runApprovedPickup(options)).status, 'waiting');
  const events = (await nitipa.events()).events;
  assert.equal(events.filter(event => event.operation === 'request.claim_pickup').length, 1);

  const { request: limited } = await garvit.submit({ type: 'request.create', retryKey: 'file-scope', recipientId: 'nitipa',
    title: 'Edit producer only', body: 'Use an integer deadline.', references: [{ path: 'producer.mjs' }] });
  const { pickupPreview } = (await send('inbox?request=' + limited.id, undefined, recipient)).data;
  await send('decision', { ...approval, requestId: limited.id, expectedVersion: limited.version,
    promptHash: pickupPreview.promptHash, retryKey: 'approve-scope' }, recipient);
  const refused = await runApprovedPickup({
    ...options,
    async edit(_prompt, checkout) {
      fs.writeFileSync(path.join(checkout, 'producer.mjs'), 'export const hours = 1;\n');
      fs.writeFileSync(path.join(checkout, 'other.mjs'), 'export const unrelated = true;\n');
      return '';
    },
  });
  assert.equal(refused.status, 'needs_attention');
  assert.match(refused.reason, /outside the approved file list/);
  assert.equal(git(refused.checkout, 'rev-parse', 'HEAD'), base);
  assert.equal((await nitipa.getRequest(limited.id)).request.completion, undefined);
});

test('an agent cannot approve a pickup or complete a run under a changed ticket', () => {
  // The role and version rules execute on the shared domain path used by HTTP and CLI.
  const workspace = { id: 'run-test', repository: 'https://example.test/team/fixture.git', participants: ['garvit', 'nitipa'] };
  const store = new SqliteStore(':memory:', workspace);
  const actor = (participantId, role = 'agent') => ({ workspaceId: workspace.id, participantId, role });
  try {
    const { request } = store.execute(actor('garvit'), { type: 'request.create', recipientId: 'nitipa',
      title: 'Deadline', body: 'Return one hour.', references: [{ path: 'producer.mjs' }], retryKey: 'create' });
    const preview = store.browserWorkspace(actor('nitipa', 'human'), request.id).pickupPreview;
    const approval = { type: 'request.approve_pickup', requestId: request.id, expectedVersion: 1, promptHash: preview.promptHash, retryKey: 'approve' };
    assert.throws(() => store.execute(actor('nitipa'), approval), { code: 'FORBIDDEN' });
    assert.throws(() => store.execute(actor('nitipa', 'human'), { ...approval, promptHash: '0'.repeat(64) }), { code: 'VERSION_CONFLICT' });
    store.execute(actor('nitipa', 'human'), approval);
    store.execute(actor('nitipa'), { type: 'request.claim_pickup', requestId: request.id, expectedVersion: 2, promptHash: preview.promptHash, retryKey: 'claim' });
    store.execute(actor('garvit'), { type: 'request.reply', requestId: request.id, expectedVersion: 3, body: 'Use a different deadline.', retryKey: 'reply' });
    assert.throws(() => store.execute(actor('nitipa'), { type: 'request.complete', requestId: request.id, expectedVersion: 4,
      pickupRunId: 'claim', retryKey: 'complete', branch: 'fixture', commit: 'a'.repeat(40), summary: 'Edited.',
      checks: [{ command: 'fixture check', outcome: 'passed' }] }), { code: 'INVALID_STATE' });
  } finally {
    store.close();
  }
});
