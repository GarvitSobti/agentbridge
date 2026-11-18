import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore, StoreError } from '../src/storage/sqlite-store.ts';
import { DomainError } from '../src/domain/board.ts';
import { APPLICATION_ID, MIGRATIONS } from '../src/storage/migrations.ts';

const workspace = { id: 'crm', repository: 'https://example.com/synthetic-crm.git', participants: ['alice', 'bob'] };
const actor = (participantId, role = 'agent') => ({ workspaceId: 'crm', participantId, role });
const createCommand = (retryKey = 'create-once') => ({ type: 'request.create', retryKey, recipientId: 'bob',
  title: 'Expose health severity', body: 'Task creation needs severity.' });
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbridge-store-test-'));
  const filename = path.join(directory, 'state.db');
  const stores = [];
  t.after(() => {
    for (const store of stores) store.close();
    // Delete only this test's own verified direct child of the temporary directory.
    const absolute = fs.realpathSync(directory);
    if (path.dirname(absolute) !== fs.realpathSync(os.tmpdir()) || !path.basename(absolute).startsWith('agentbridge-store-test-')) throw Error('Unsafe test cleanup path');
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  return { filename, open(config = workspace, options = {}) { const store = new SqliteStore(filename, config, options); stores.push(store); return store; } };
}
function fails(code, run, ErrorType = DomainError) {
  assert.throws(run, error => error instanceof ErrorType && error.code === code);
}
function inspect(filename, fn) {
  const db = new DatabaseSync(filename);
  try { return fn(db); } finally { db.close(); }
}
function counts(filename) {
  return inspect(filename, db => Object.fromEntries(['requests', 'events', 'retry_receipts'].map(table =>
    [table, db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count])));
}
async function race(filename, commands) {
  const gate = new SharedArrayBuffer(4);
  const workers = commands.map(command => new Worker(new URL('./fixtures/sqlite-writer.mjs', import.meta.url), {
    workerData: { filename, workspace, principal: command.principal, command: command.command, gate },
  }));
  try {
    await Promise.all(workers.map(worker => new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.on('message', message => { if (message.ready) resolve(); });
      worker.once('exit', code => { if (code !== 0) reject(Error(`Worker exited before ready: ${code}`)); });
    })));
    const outcomes = workers.map(worker => new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.on('message', message => { if (message.result || message.error) resolve(message); });
      worker.once('exit', code => { if (code !== 0) reject(Error(`Worker exited without a result: ${code}`)); });
    }));
    Atomics.store(new Int32Array(gate), 0, 1);
    Atomics.notify(new Int32Array(gate), 0);
    return await Promise.all(outcomes);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}

test('initialization migrates an empty file and reopening is idempotent', t => {
  const f = fixture(t);
  f.open().close();
  f.open({ ...workspace, participants: ['bob', 'alice'] }).close();
  assert.deepEqual(counts(f.filename), { requests: 0, events: 0, retry_receipts: 0 });
  inspect(f.filename, db => {
    assert.equal(db.prepare('PRAGMA application_id').get().application_id, APPLICATION_ID);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.at(-1).version);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(db.prepare('SELECT count(*) AS count FROM workspaces').get().count, 1);
  });
});

test('requests, decisions, replies, and retry receipts survive closing and reopening', t => {
  const f = fixture(t); let store = f.open();
  const created = store.execute(actor('alice'), createCommand());
  let current = created.request;
  const change = (principal, type, input = {}) => {
    current = store.execute(principal, { type, requestId: current.id, expectedVersion: current.version, retryKey: `key-${current.version}`, ...input }).request;
  };
  change(actor('bob'), 'request.reply', { body: 'Severity can be a string enum.' });
  change(actor('alice'), 'decision.propose', { text: 'severity: low | medium | high' });
  const decision = current.decisions[0];
  for (const person of ['alice', 'bob']) change(actor(person), 'decision.agree', {
    decisionId: decision.id, revision: 1, contentHash: decision.revisions[0].contentHash,
  });
  change(actor('bob', 'human'), 'request.accept');
  store.close(); store = f.open();
  assert.deepEqual(store.getRequest(actor('alice'), current.id), current);
  assert.equal(store.inbox(actor('bob'))[0].messages.length, 1);
  const retry = store.execute(actor('alice'), createCommand());
  assert.equal(retry.replayed, true);
  assert.equal(retry.request.status, 'pending');
  assert.equal(store.getRequest(actor('bob'), current.id).status, 'accepted');
  assert.equal(store.events(actor('alice')).length, 6);
  change(actor('bob'), 'request.start');
  assert.equal(current.status, 'in_progress');
  assert.deepEqual(counts(f.filename), { requests: 1, events: 7, retry_receipts: 7 });
});

test('domain rejections leave no durable change and the connection remains usable', t => {
  const f = fixture(t); const store = f.open();
  const request = store.execute(actor('alice'), createCommand()).request;
  const accept = { type: 'request.accept', requestId: request.id, expectedVersion: 1, retryKey: 'accept' };
  fails('FORBIDDEN', () => store.execute(actor('bob'), accept));
  assert.deepEqual(counts(f.filename), { requests: 1, events: 1, retry_receipts: 1 });
  assert.equal(store.execute(actor('bob', 'human'), accept).request.status, 'accepted');
});

test('a SQL failure after request and event writes rolls back the complete command', t => {
  const f = fixture(t); const store = f.open();
  inspect(f.filename, db => db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON retry_receipts BEGIN SELECT RAISE(ABORT, 'test fault'); END"));
  fails('STORAGE_FAILURE', () => store.execute(actor('alice'), createCommand()), StoreError);
  assert.deepEqual(counts(f.filename), { requests: 0, events: 0, retry_receipts: 0 });
  store.close();
  const reopened = f.open();
  assert.equal(reopened.inbox(actor('bob')).length, 0);
  inspect(f.filename, db => db.exec('DROP TRIGGER fail_receipt'));
  assert.equal(reopened.execute(actor('alice'), createCommand()).replayed, false);
  assert.deepEqual(counts(f.filename), { requests: 1, events: 1, retry_receipts: 1 });
});

test('concurrent creates serialize without lost requests or duplicate event cursors', { timeout: 15_000 }, async t => {
  const f = fixture(t); const store = f.open();
  const results = await race(f.filename, ['first', 'second'].map(key => ({ principal: actor('alice'), command: createCommand(key) })));
  assert.ok(results.every(result => result.result));
  assert.notEqual(results[0].result.request.id, results[1].result.request.id);
  assert.equal(store.inbox(actor('bob')).length, 2);
  assert.deepEqual(store.events(actor('alice')).map(event => event.cursor), [1, 2]);
  assert.deepEqual(counts(f.filename), { requests: 2, events: 2, retry_receipts: 2 });
});

test('concurrent duplicate commands commit once and return one replay', { timeout: 15_000 }, async t => {
  const f = fixture(t); f.open();
  const input = { principal: actor('alice'), command: createCommand() };
  const results = await race(f.filename, [input, input]);
  assert.ok(results.every(result => result.result));
  assert.deepEqual(results.map(result => result.result.replayed).sort(), [false, true]);
  assert.equal(results[0].result.request.id, results[1].result.request.id);
  assert.deepEqual(counts(f.filename), { requests: 1, events: 1, retry_receipts: 1 });
});

test('concurrent edits of the same version produce one version conflict', { timeout: 15_000 }, async t => {
  const f = fixture(t); const store = f.open();
  const request = store.execute(actor('alice'), createCommand()).request;
  const results = await race(f.filename, ['first', 'second'].map(key => ({ principal: actor('bob'),
    command: { type: 'request.reply', requestId: request.id, expectedVersion: 1, retryKey: key, body: key } })));
  assert.equal(results.filter(result => result.result).length, 1);
  assert.equal(results.find(result => result.error).error.code, 'VERSION_CONFLICT');
  assert.equal(store.getRequest(actor('alice'), request.id).messages.length, 1);
  assert.deepEqual(counts(f.filename), { requests: 1, events: 2, retry_receipts: 2 });
});

test('a held write lock times out cleanly and the original command can be retried', t => {
  const f = fixture(t); const store = f.open(workspace, { busyTimeoutMs: 20 });
  const blocker = new DatabaseSync(f.filename);
  try {
    blocker.exec('BEGIN IMMEDIATE');
    fails('STORAGE_BUSY', () => store.execute(actor('alice'), createCommand()), StoreError);
    blocker.exec('ROLLBACK');
    assert.equal(store.execute(actor('alice'), createCommand()).replayed, false);
  } finally { blocker.close(); }
});

test('killing a writer with an open transaction preserves the last committed request', { timeout: 15_000 }, async t => {
  const f = fixture(t); const store = f.open();
  const original = store.execute(actor('alice'), createCommand()).request;
  store.close();
  const child = fork(new URL('./fixtures/sqlite-crash.mjs', import.meta.url), [f.filename], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('message', message => message.staged ? resolve() : reject(Error('Writer failed to stage changes')));
    child.once('exit', () => reject(Error('Writer exited before staging')));
  });
  const exited = once(child, 'exit');
  child.kill();
  await exited;
  const reopened = f.open();
  assert.deepEqual(reopened.getRequest(actor('bob'), original.id), original);
  assert.equal(reopened.execute(actor('alice'), createCommand()).replayed, true);
  assert.deepEqual(counts(f.filename), { requests: 1, events: 1, retry_receipts: 1 });
});

test('inbox catch-up and retry keys still obey workspace isolation after restart', t => {
  const f = fixture(t); const store = f.open();
  const request = store.execute(actor('alice'), createCommand()).request;
  store.execute(actor('bob', 'human'), { type: 'request.accept', requestId: request.id, expectedVersion: 1, retryKey: 'accept' });
  store.close();
  const reopened = f.open();
  assert.deepEqual(reopened.events(actor('bob'), 1).map(event => event.cursor), [2]);
  fails('IDEMPOTENCY_CONFLICT', () => reopened.execute(actor('alice'), { ...createCommand(), title: 'Changed payload' }));
  for (const principal of [{ ...actor('alice'), workspaceId: 'other' }, actor('mallory')]) {
    fails('FORBIDDEN', () => reopened.inbox(principal));
    fails('FORBIDDEN', () => reopened.events(principal));
    fails('FORBIDDEN', () => reopened.getRequest(principal, request.id));
    fails('FORBIDDEN', () => reopened.execute(principal, createCommand()));
  }
});

test('separate workspaces in one local file cannot overwrite each other', t => {
  const f = fixture(t); const first = f.open();
  const other = { id: 'other', repository: 'https://example.com/other.git', participants: ['alice', 'bob'] };
  const second = f.open(other);
  const original = first.execute(actor('alice'), createCommand()).request;
  const principal = { ...actor('alice'), workspaceId: 'other' };
  second.execute(principal, createCommand());
  fails('NOT_FOUND', () => second.getRequest(principal, original.id));
  assert.equal(first.events(actor('alice')).length, 1);
  assert.equal(second.events(principal).length, 1);
});

test('workspace initialization rejects changed membership or repository without replacing data', t => {
  const f = fixture(t); const store = f.open(); store.execute(actor('alice'), createCommand());
  for (const changed of [{ ...workspace, repository: 'different' }, { ...workspace, participants: ['alice', 'mallory'] }]) {
    fails('WORKSPACE_MISMATCH', () => f.open(changed), StoreError);
  }
  assert.equal(store.inbox(actor('bob')).length, 1);
});

test('foreign and newer-schema databases are rejected without being reset', t => {
  const f = fixture(t);
  inspect(f.filename, db => db.exec('CREATE TABLE private_data (value TEXT); INSERT INTO private_data VALUES (\'preserve me\')'));
  fails('FOREIGN_DATABASE', () => f.open(), StoreError);
  inspect(f.filename, db => assert.equal(db.prepare('SELECT value FROM private_data').get().value, 'preserve me'));
  const other = path.join(path.dirname(f.filename), 'future.db');
  inspect(other, db => db.exec(`PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = 999`));
  fails('SCHEMA_TOO_NEW', () => new SqliteStore(other, workspace), StoreError);
  inspect(other, db => assert.equal(db.prepare('PRAGMA user_version').get().user_version, 999));
});

test('inconsistent stored envelopes fail closed rather than being overwritten', t => {
  const f = fixture(t); const store = f.open();
  store.execute(actor('alice'), createCommand());
  inspect(f.filename, db => db.exec('UPDATE workspaces SET revision = 99'));
  fails('CORRUPT_STATE', () => store.inbox(actor('bob')), StoreError);
  fails('CORRUPT_STATE', () => store.execute(actor('alice'), createCommand('another')), StoreError);
  assert.deepEqual(counts(f.filename), { requests: 1, events: 1, retry_receipts: 1 });
});

test('closing is idempotent, closed connections reject operations, and limits are validated', t => {
  const f = fixture(t); const store = f.open(); store.close(); store.close();
  fails('CLOSED', () => store.inbox(actor('bob')), StoreError);
  fails('CLOSED', () => store.execute(actor('alice'), createCommand()), StoreError);
  for (const busyTimeoutMs of [-1, 30_001, 1.5]) assert.throws(() => f.open(workspace, { busyTimeoutMs }), RangeError);
});

test('terminal completion evidence and its exact retry survive a restart', t => {
  const f = fixture(t); let store = f.open();
  let request = store.execute(actor('alice'), createCommand()).request;
  for (const [principal, type] of [[actor('bob', 'human'), 'request.accept'], [actor('bob'), 'request.start']]) {
    request = store.execute(principal, { type, requestId: request.id, expectedVersion: request.version, retryKey: type }).request;
  }
  const command = { type: 'request.complete', requestId: request.id, expectedVersion: request.version, retryKey: 'finish',
    branch: 'feat/severity', commit: 'a'.repeat(40), summary: 'Synthetic report only.',
    checks: [{ command: 'integration test', outcome: 'not_run', details: 'No integration runner in this fixture.' }] };
  const completed = store.execute(actor('bob'), command);
  store.close(); store = f.open();
  const retry = store.execute(actor('bob'), command);
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.request, completed.request);
  assert.equal(store.getRequest(actor('alice'), request.id).completion.verification, 'self_reported');
  assert.deepEqual(counts(f.filename), { requests: 1, events: 4, retry_receipts: 4 });
});

test('migration failure rolls back earlier DDL without removing existing data', t => {
  const f = fixture(t);
  inspect(f.filename, db => db.exec(`PRAGMA application_id = ${APPLICATION_ID}; CREATE TABLE requests (keep TEXT); INSERT INTO requests VALUES ('original')`));
  fails('STORAGE_FAILURE', () => f.open(), StoreError);
  inspect(f.filename, db => {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'workspaces'").get().count, 0);
    assert.equal(db.prepare('SELECT keep FROM requests').get().keep, 'original');
  });
});

test('task text is bound as data and cannot execute SQL', t => {
  const f = fixture(t); const store = f.open();
  const body = "'); DROP TABLE requests; --";
  const request = store.execute(actor('alice'), { ...createCommand(), body }).request;
  assert.equal(store.getRequest(actor('bob'), request.id).body, body);
  assert.deepEqual(counts(f.filename), { requests: 1, events: 1, retry_receipts: 1 });
});
