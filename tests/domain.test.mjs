import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBoard, execute, readRequest, readInbox, readEvents, DomainError } from '../src/domain/board.ts';

const SHA = 'a'.repeat(40);
const actors = {
  alice: { workspaceId: 'crm', participantId: 'alice', role: 'agent' },
  aliceHuman: { workspaceId: 'crm', participantId: 'alice', role: 'human' },
  bob: { workspaceId: 'crm', participantId: 'bob', role: 'agent' },
  bobHuman: { workspaceId: 'crm', participantId: 'bob', role: 'human' },
};
function fixture() {
  let sequence = 0;
  let key = 0;
  let state = createBoard({ id: 'crm', repository: 'https://example.com/synthetic-crm.git', participants: ['alice', 'bob'] });
  const environment = { id: () => `generated-${++sequence}`, now: () => '2026-11-17T00:00:00.000Z',
    sha256: value => createHash('sha256').update(value).digest('hex') };
  let current;
  const send = (actor, input) => {
    const command = { retryKey: `retry-${++key}`, ...input };
    const outcome = execute(state, actor, command, environment);
    state = outcome.state;
    current = outcome.result.request;
    return outcome.result;
  };
  const create = (extra = {}) => send(actors.alice, { type: 'request.create', recipientId: 'bob', title: 'Expose severity',
    body: 'Task creation needs the health monitor severity.', ...extra });
  const change = (actor, type, extra = {}) => send(actor, { type, requestId: current.id, expectedVersion: current.version, ...extra });
  return { send, create, change, environment, get state() { return state; }, get request() { return current; } };
}
function fails(code, run) {
  assert.throws(run, error => error instanceof DomainError && error.code === code);
}
const completion = { branch: 'feat/severity', commit: SHA, summary: 'Added severity to the synthetic response.',
  checks: [{ command: 'npm test', outcome: 'passed' }], references: [{ path: 'src/health.ts', commit: SHA }] };
function start(f) { f.change(actors.bobHuman, 'request.accept'); f.change(actors.bob, 'request.start'); }
function agreeCurrent(f, decision = f.request.decisions.at(-1)) {
  const revision = decision.revisions.at(-1);
  for (const actor of [actors.alice, actors.bob]) f.change(actor, 'decision.agree', {
    decisionId: decision.id, revision: revision.revision, contentHash: revision.contentHash,
  });
}

test('a dependent request follows human acceptance, agent start, and self-reported completion', () => {
  const f = fixture();
  const created = f.create();
  assert.equal(created.request.status, 'pending');
  assert.equal(created.request.requesterId, 'alice');
  assert.equal(created.request.recipientId, 'bob');
  assert.equal(created.request.version, 1);
  assert.equal(created.event.beforeVersion, null);
  start(f);
  f.change(actors.bob, 'request.complete', completion);
  assert.equal(f.request.status, 'completed');
  assert.equal(f.request.version, 4);
  assert.equal(f.request.completion.verification, 'self_reported');
  assert.equal(f.request.completion.repository, f.state.workspace.repository);
  assert.deepEqual(f.request.completion.reporter, actors.bob);
  assert.deepEqual(f.state.events.map(event => event.cursor), [1, 2, 3, 4]);
});

test('both human-only decisions reject agents and the requesting human', async t => {
  for (const type of ['request.accept', 'request.decline']) for (const actor of [actors.bob, actors.alice, actors.aliceHuman]) {
    await t.test(`${type}: ${actor.participantId}/${actor.role}`, () => {
      const f = fixture(); f.create(); const before = JSON.stringify(f.state);
      fails('FORBIDDEN', () => f.change(actor, type));
      assert.equal(JSON.stringify(f.state), before);
    });
  }
});

test('work cannot start before acceptance, and only the assigned agent starts or completes', () => {
  const f = fixture(); f.create();
  fails('INVALID_STATE', () => f.change(actors.bob, 'request.start'));
  f.change(actors.bobHuman, 'request.accept');
  for (const actor of [actors.alice, actors.aliceHuman, actors.bobHuman]) fails('FORBIDDEN', () => f.change(actor, 'request.start'));
  fails('INVALID_STATE', () => f.change(actors.bob, 'request.complete', completion));
  f.change(actors.bob, 'request.start');
  for (const actor of [actors.alice, actors.aliceHuman, actors.bobHuman]) fails('FORBIDDEN', () => f.change(actor, 'request.complete', completion));
});

test('workspace isolation is checked on every command and read before looking up resources', () => {
  const f = fixture(); f.create();
  for (const actor of [{ ...actors.alice, workspaceId: 'other' }, { ...actors.alice, participantId: 'mallory' }, { ...actors.alice, role: 'admin' }]) {
    fails('FORBIDDEN', () => f.send(actor, { type: 'request.accept', requestId: 'missing', expectedVersion: 1 }));
    fails('FORBIDDEN', () => readRequest(f.state, actor, 'missing'));
    fails('FORBIDDEN', () => readInbox(f.state, actor));
    fails('FORBIDDEN', () => readEvents(f.state, actor));
  }
});

test('payloads cannot set identity, approval, status, IDs, or repository', () => {
  for (const injected of [{ role: 'human' }, { requesterId: 'bob' }, { humanApproved: true }, { status: 'accepted' }, { requestId: 'chosen' }, { repository: 'other' }]) {
    const f = fixture(); fails('INVALID_INPUT', () => f.create(injected)); assert.equal(f.state.requests.length, 0);
  }
  const f = fixture(); f.create();
  fails('INVALID_INPUT', () => f.change(actors.bob, 'request.accept', { role: 'human' }));
});

test('creation rejects self-addressing, unknown recipients, and invalid workspace configuration', () => {
  for (const recipientId of ['alice', 'mallory']) { const f = fixture(); fails('INVALID_INPUT', () => f.create({ recipientId })); }
  for (const participants of [['alice'], ['alice', 'alice'], ['alice', 'bob', 'charlie']]) {
    fails('INVALID_INPUT', () => createBoard({ id: 'crm', repository: 'synthetic', participants }));
  }
});

test('stale versions are rejected and a reply does not accept or start work', () => {
  const f = fixture(); f.create();
  const version = f.request.version;
  f.change(actors.bob, 'request.reply', { body: 'Which response shape do you need?' });
  assert.equal(f.request.status, 'pending');
  assert.deepEqual(f.request.messages[0].author, actors.bob);
  fails('VERSION_CONFLICT', () => f.change(actors.bobHuman, 'request.accept', { expectedVersion: version }));
  assert.equal(f.request.version, version + 1);
});

test('create retries replay the original result without new IDs, timestamps, or events', () => {
  const f = fixture();
  const first = f.create({ retryKey: 'network-retry' });
  const second = f.create({ retryKey: 'network-retry' });
  assert.equal(second.replayed, true);
  assert.equal(second.request.id, first.request.id);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.events.length, 1);
  const environment = { id() { throw Error('ID consumed'); }, now() { throw Error('clock consumed'); }, sha256: f.environment.sha256 };
  const replay = execute(f.state, actors.alice, { type: 'request.create', retryKey: 'network-retry', recipientId: 'bob',
    title: 'Expose severity', body: 'Task creation needs the health monitor severity.' }, environment);
  assert.equal(replay.result.replayed, true);
});

test('retries survive serialization and do not roll state back after later changes', () => {
  const f = fixture(); const created = f.create();
  const command = { type: 'request.accept', retryKey: 'accept-once', requestId: created.request.id, expectedVersion: 1 };
  f.send(actors.bobHuman, command);
  f.change(actors.bob, 'request.start');
  const serialized = JSON.parse(JSON.stringify(f.state));
  const replay = execute(serialized, actors.bobHuman, command, f.environment);
  assert.equal(replay.result.replayed, true);
  assert.equal(replay.result.request.status, 'accepted');
  assert.equal(readRequest(replay.state, actors.bob, created.request.id).status, 'in_progress');
  assert.equal(replay.state.events.length, 3);
});

test('retry scope includes role and operation, and payload changes are rejected', () => {
  const f = fixture(); f.create({ retryKey: 'same-key' });
  fails('IDEMPOTENCY_CONFLICT', () => f.create({ retryKey: 'same-key', body: 'Different task' }));
  f.change(actors.bobHuman, 'request.accept', { retryKey: 'shared' });
  fails('FORBIDDEN', () => f.send(actors.bob, { type: 'request.accept', retryKey: 'shared', requestId: f.request.id, expectedVersion: 1 }));
  f.change(actors.bob, 'request.start', { retryKey: 'shared' });
  assert.equal(f.request.status, 'in_progress');
});

test('decision acknowledgment never substitutes for human acceptance', () => {
  const f = fixture(); f.create();
  f.change(actors.alice, 'decision.propose', { text: 'severity is low, medium, or high' });
  agreeCurrent(f);
  fails('INVALID_STATE', () => f.change(actors.bob, 'request.start'));
  f.change(actors.bobHuman, 'request.accept');
  f.change(actors.bob, 'request.start');
  assert.equal(f.request.status, 'in_progress');
});

test('every attached decision needs agreement from both participants', () => {
  const f = fixture(); f.create();
  f.change(actors.alice, 'decision.propose', { text: 'severity uses a string enum' });
  agreeCurrent(f);
  f.change(actors.bob, 'decision.propose', { text: 'include ruleId in the response' });
  f.change(actors.bobHuman, 'request.accept');
  fails('DECISION_NOT_AGREED', () => f.change(actors.bob, 'request.start'));
  agreeCurrent(f);
  f.change(actors.bob, 'request.start');
});

test('mid-task revisions preserve history, clear agreement, and block completion', () => {
  const f = fixture(); f.create();
  f.change(actors.alice, 'decision.propose', { text: 'severity is a number', references: [{ path: 'api/schema.json', commit: SHA }] });
  agreeCurrent(f); start(f);
  const old = structuredClone(f.request.decisions[0]);
  f.change(actors.bob, 'decision.propose', { decisionId: old.id, text: 'severity is a string enum' });
  const latest = f.request.decisions[0].revisions.at(-1);
  assert.equal(latest.revision, 2);
  assert.notEqual(latest.contentHash, old.revisions[0].contentHash);
  assert.equal(latest.acknowledgments.length, 0);
  assert.deepEqual(f.request.decisions[0].revisions[0], old.revisions[0]);
  assert.equal(f.request.status, 'in_progress');
  fails('DECISION_NOT_AGREED', () => f.change(actors.bob, 'request.complete', completion));
  fails('STALE_DECISION', () => f.change(actors.alice, 'decision.agree', {
    decisionId: old.id, revision: 1, contentHash: old.revisions[0].contentHash,
  }));
  fails('STALE_DECISION', () => f.change(actors.alice, 'decision.agree', {
    decisionId: old.id, revision: 2, contentHash: old.revisions[0].contentHash,
  }));
  agreeCurrent(f);
  f.change(actors.bob, 'request.complete', completion);
  assert.equal(f.request.status, 'completed');
});

test('terminal requests are read-only, but exact operation retries remain safe', async t => {
  for (const terminal of ['completed', 'declined', 'cancelled']) await t.test(terminal, () => {
    const f = fixture(); f.create();
    if (terminal === 'completed') { start(f); f.change(actors.bob, 'request.complete', completion); }
    if (terminal === 'declined') f.change(actors.bobHuman, 'request.decline');
    if (terminal === 'cancelled') f.change(actors.aliceHuman, 'request.cancel');
    for (const actor of [actors.alice, actors.bobHuman]) fails('INVALID_STATE', () => f.change(actor, 'request.reply', { body: 'Extra work' }));
    assert.equal(readRequest(f.state, actors.alice, f.request.id).status, terminal);
  });
});

test('cancellation requires the correct human and does not allow agents', () => {
  const f = fixture(); f.create();
  for (const actor of [actors.bobHuman, actors.alice, actors.bob]) fails('FORBIDDEN', () => f.change(actor, 'request.cancel'));
  f.change(actors.bobHuman, 'request.accept');
  f.change(actors.bobHuman, 'request.cancel');
  assert.equal(f.request.status, 'cancelled');
});

test('completion requires a full commit, valid branch, and explicit check claims', () => {
  const f = fixture(); f.create(); start(f);
  for (const invalid of [{ commit: 'abc123' }, { branch: '../main' }, { branch: 'feat//test' }, { branch: 'feat/test.lock' },
    { checks: [] }, { checks: [{ command: 'npm test', outcome: 'not_run' }] }, { checks: [{ command: 'npm test', outcome: 'verified' }] }]) {
    fails('INVALID_INPUT', () => f.change(actors.bob, 'request.complete', { ...completion, ...invalid }));
  }
  f.change(actors.bob, 'request.complete', { ...completion, checks: [{ command: 'npm test', outcome: 'not_run', details: 'Fixture test runner is not available.' }] });
  assert.equal(f.request.completion.verification, 'self_reported');
});

test('input limits and nonportable paths fail before a task is created', () => {
  for (const path of ['/etc/passwd', '../secrets', 'src/../secrets', 'C:\\keys', 'src//file', 'src/./file', 'src/file\0']) {
    const f = fixture(); fails('INVALID_INPUT', () => f.create({ references: [{ path }] })); assert.equal(f.state.requests.length, 0);
  }
  for (const invalid of [{ title: 'x'.repeat(161) }, { body: ' ' }, { body: 'x'.repeat(8001) },
    { references: Array.from({ length: 21 }, () => ({ path: 'src/a' })) }, { retryKey: '' }]) {
    const f = fixture(); fails('INVALID_INPUT', () => f.create(invalid));
  }
});

test('unknown or malformed commands produce structured errors without mutation', () => {
  const f = fixture(); const before = JSON.stringify(f.state);
  for (const value of [null, [], {}, { type: 'constructor' }, { type: 'request.destroy' }]) fails('INVALID_INPUT', () => execute(f.state, actors.alice, value, f.environment));
  fails('NOT_FOUND', () => readRequest(f.state, actors.alice, 'missing'));
  assert.equal(JSON.stringify(f.state), before);
});

test('execution and reads do not expose mutable references to stored state', () => {
  const f = fixture(); const initial = f.state; const result = f.create();
  assert.equal(initial.requests.length, 0);
  result.request.title = 'Tampered'; result.event.actor.role = 'human';
  const read = readRequest(f.state, actors.bob, result.request.id); read.title = 'Also tampered';
  const inbox = readInbox(f.state, actors.bob); inbox[0].title = 'Changed inbox';
  assert.equal(f.state.requests[0].title, 'Expose severity');
  assert.equal(f.state.events[0].actor.role, 'agent');
});

test('inbox reads are non-mutating and event cursors support bounded catch-up', () => {
  const f = fixture(); f.create();
  const before = JSON.stringify(f.state);
  assert.equal(readInbox(f.state, actors.alice).length, 0);
  assert.equal(readInbox(f.state, actors.bob).length, 1);
  assert.equal(JSON.stringify(f.state), before);
  start(f);
  const page = readEvents(f.state, actors.alice, 1, 1);
  assert.deepEqual(page.map(event => event.cursor), [2]);
  assert.deepEqual(readEvents(f.state, actors.bob, page[0].cursor).map(event => event.cursor), [3]);
  for (const [after, limit] of [[-1, 1], [0, 101], [0, 0], [1.5, 1]]) fails('INVALID_INPUT', () => readEvents(f.state, actors.alice, after, limit));
});

test('human and agent identities from one participant cannot count as two-party agreement', () => {
  const f = fixture(); f.create();
  f.change(actors.alice, 'decision.propose', { text: 'severity uses a string enum' });
  const decision = f.request.decisions[0];
  const agreement = { decisionId: decision.id, revision: 1, contentHash: decision.revisions[0].contentHash };
  f.change(actors.alice, 'decision.agree', agreement);
  fails('INVALID_STATE', () => f.change(actors.aliceHuman, 'decision.agree', agreement));
  f.change(actors.bobHuman, 'request.accept');
  fails('DECISION_NOT_AGREED', () => f.change(actors.bob, 'request.start'));
});

test('agreement hashes bind code references and decisions cannot be moved between requests', () => {
  const f = fixture(); f.create();
  f.change(actors.alice, 'decision.propose', { text: 'Use severity', references: [{ path: 'api/schema.json', commit: SHA }] });
  const original = structuredClone(f.request.decisions[0]);
  f.change(actors.alice, 'decision.propose', { decisionId: original.id, text: 'Use severity', references: [{ path: 'api/schema.json', commit: 'b'.repeat(40) }] });
  assert.notEqual(f.request.decisions[0].revisions[1].contentHash, original.revisions[0].contentHash);
  f.create();
  fails('NOT_FOUND', () => f.change(actors.bob, 'decision.agree', {
    decisionId: original.id, revision: 1, contentHash: original.revisions[0].contentHash,
  }));
  fails('NOT_FOUND', () => f.change(actors.bob, 'decision.propose', { decisionId: original.id, text: 'Hijack decision' }));
});

test('a failed operation leaves no event or retry receipt and can be retried after resolving the failure', () => {
  const f = fixture(); f.create();
  const before = JSON.stringify(f.state);
  fails('INVALID_STATE', () => f.change(actors.bob, 'request.start', { retryKey: 'start-after-approval' }));
  assert.equal(JSON.stringify(f.state), before);
  f.change(actors.bobHuman, 'request.accept');
  const result = f.change(actors.bob, 'request.start', { retryKey: 'start-after-approval' });
  assert.equal(result.replayed, false);
  assert.equal(f.state.receipts.length, 3);
});

test('replaying a completed operation does not generate another completion event', () => {
  const f = fixture(); f.create(); start(f);
  const command = { type: 'request.complete', retryKey: 'complete-once', requestId: f.request.id,
    expectedVersion: f.request.version, ...completion };
  f.send(actors.bob, command);
  const before = JSON.stringify(f.state);
  const replay = f.send(actors.bob, command);
  assert.equal(replay.replayed, true);
  assert.equal(JSON.stringify(f.state), before);
});

test('invalid request versions and malformed principal shapes are rejected', () => {
  const f = fixture(); f.create();
  for (const expectedVersion of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, '1']) {
    fails('INVALID_INPUT', () => f.change(actors.bobHuman, 'request.accept', { expectedVersion }));
  }
  for (const actor of [null, [], 'bob']) fails('INVALID_INPUT', () => readInbox(f.state, actor));
});
