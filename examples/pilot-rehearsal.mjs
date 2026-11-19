import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { databasePath, initializeLocal, loadProfile } from '../src/cli/local.ts';
import { AgentRelayClient } from '../src/mcp/relay-client.ts';
import { startRelay } from '../src/relay/server.ts';
import { SqliteStore } from '../src/storage/sqlite-store.ts';
import { checkHandoff } from '../src/review/handoff.ts';
import { readCommitDiff } from '../src/review/codex.ts';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = new URL('./pilot-fixture/', import.meta.url);
const workspace = { id: 'pilot-rehearsal', repository: 'local://pilot-rehearsal', participants: ['alice', 'bob'] };
const parent = await fs.realpath(os.tmpdir());
const prefix = 'agentbridge-pilot-';
const directory = await fs.mkdtemp(path.join(parent, prefix));
const home = path.join(directory, 'private');
const aliceRepo = path.join(directory, 'alice');
const bobRepo = path.join(directory, 'bob');
const hooks = path.join(directory, 'empty-hooks');
const branch = 'fixture/review-deadline';
let store;
let relay;

const git = async (cwd, ...args) => (await run('git', [
  '-c', 'user.name=Agent Bridge Fixture', '-c', 'user.email=fixture@example.test',
  '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=' + hooks, ...args,
], { cwd, timeout: 10_000, windowsHide: true })).stdout.trim();

try {
  await fs.mkdir(hooks);
  await fs.mkdir(aliceRepo);
  await git(aliceRepo, 'init', '--initial-branch=main', '--template=');
  for (const file of ['consumer.mjs', 'contract.test.mjs']) await fs.copyFile(new URL(file, fixture), path.join(aliceRepo, file));
  const producer = await fs.readFile(new URL('producer.mjs', fixture), 'utf8');
  await fs.writeFile(path.join(aliceRepo, 'producer.mjs'), producer.replace('reviewWithinHours', 'followUpHours'));
  await git(aliceRepo, 'add', '--', 'producer.mjs', 'consumer.mjs', 'contract.test.mjs');
  await git(aliceRepo, 'commit', '-m', 'Fixture baseline with the legacy field');
  await git(directory, 'clone', '--no-local', '--template=', aliceRepo, bobRepo);
  await git(bobRepo, 'switch', '-c', branch);
  const testArgs = ['--test', 'contract.test.mjs'];
  await assert.rejects(run(process.execPath, testArgs, { cwd: bobRepo, timeout: 10_000 }),
    error => error.code === 1 && error.stdout.includes('ERR_ASSERTION') && error.stdout.includes('followUpHours'));

  initializeLocal(home, 8787, { workspace });
  store = new SqliteStore(databasePath(home), workspace);
  relay = await startRelay(store, 0);
  const url = relay.url;
  const port = Number(new URL(url).port);
  const aliceProfile = loadProfile(home, 'alice-agent');
  const bobProfile = loadProfile(home, 'bob-agent');
  const alice = new AgentRelayClient(url, aliceProfile);
  const bob = new AgentRelayClient(url, bobProfile);
  const cli = async (profile, ...args) => {
    const { stdout } = await run(process.execPath, [path.join(root, 'src/cli/bridge.ts'), '--home', home,
      '--url', url, '--profile', profile, ...args], { cwd: root, timeout: 10_000, windowsHide: true });
    return JSON.parse(stdout);
  };

  const create = {
    type: 'request.create', retryKey: 'fixture-create', recipientId: 'bob', title: 'Provide a review deadline',
    body: 'Expose the agreed deadline in the health summary consumed by the review task.', references: [{ path: 'producer.mjs' }],
  };
  // Discard the receipt even though the relay processed the write. Reconnect with the exact input.
  const lostResponse = await fetch(url + '/v1/commands', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { authorization: 'Bearer ' + aliceProfile.token, 'content-type': 'application/json' },
    body: JSON.stringify(create),
  });
  assert.equal(lostResponse.status, 200);
  await lostResponse.body.cancel();
  await relay.close();
  store.close();
  store = new SqliteStore(databasePath(home), workspace);
  relay = await startRelay(store, port);
  const receipt = await alice.submit(create);
  assert.equal(receipt.replayed, true);
  let request = receipt.request;
  assert.equal(request.status, 'pending');
  assert.deepEqual((await bob.inbox()).requests.map(item => item.id), [request.id]);
  console.log('Reconnected after relay restart. Retrying the discarded receipt produced one pending request.');

  function transition(type, retryKey, details = {}) {
    return { type, requestId: request.id, expectedVersion: request.version, retryKey, ...details };
  }
  const propose = (retryKey, text, decisionId) => alice.submit(transition('decision.propose', retryKey,
    { text, references: [{ path: 'producer.mjs' }], ...(decisionId ? { decisionId } : {}) }));
  const agree = (agent, retryKey, decisionId, revision) => agent.submit(transition('decision.agree', retryKey,
    { decisionId, revision: revision.revision, contentHash: revision.contentHash }));

  request = (await propose('fixture-propose-1', 'Use followUpHours for the deadline.')).request;
  const { id: decisionId, revisions: [draft] } = request.decisions[0];
  request = (await agree(alice, 'fixture-alice-1', decisionId, draft)).request;
  request = (await agree(bob, 'fixture-bob-1', decisionId, draft)).request;
  const staleVersion = String(request.version);
  request = (await propose('fixture-propose-2', 'Use reviewWithinHours: high is 4, medium is 48, and low is null.', decisionId)).request;
  const revised = request.decisions[0].revisions.at(-1);
  assert.equal(revised.revision, 2);
  await assert.rejects(agree(bob, 'fixture-old-agreement', decisionId, draft), { code: 'STALE_DECISION' });

  const accept = (profile, version, key) => cli(profile, 'accept', '--id', request.id, '--version', String(version), '--retry', key);
  await assert.rejects(accept('bob-human', staleVersion, 'fixture-stale-approval'), error => error.stderr.includes('VERSION_CONFLICT'));
  await assert.rejects(accept('bob-agent', request.version, 'fixture-agent-approval'), error => error.stderr.includes('FORBIDDEN'));
  const approvalVersion = request.version;
  request = (await accept('bob-human', approvalVersion, 'fixture-approval')).request;
  assert.equal(request.status, 'accepted');
  assert.equal((await accept('bob-human', approvalVersion, 'fixture-approval')).replayed, true);
  await assert.rejects(bob.submit(transition('request.start', 'fixture-start-too-early')), { code: 'DECISION_NOT_AGREED' });
  request = (await agree(alice, 'fixture-alice-2', decisionId, revised)).request;
  request = (await agree(bob, 'fixture-bob-2', decisionId, revised)).request;
  request = (await bob.submit(transition('request.start', 'fixture-start'))).request;
  console.log('Rejected stale agreement, stale approval, agent approval and early start. Scripted human approval was recorded once.');

  await fs.writeFile(path.join(bobRepo, 'producer.mjs'), producer);
  await run(process.execPath, testArgs, { cwd: bobRepo, timeout: 10_000 });
  await git(bobRepo, 'add', '--', 'producer.mjs');
  await git(bobRepo, 'commit', '-m', 'Adopt the agreed reviewWithinHours field');
  const commit = await git(bobRepo, 'rev-parse', 'HEAD');
  request = (await bob.submit(transition('request.complete', 'fixture-complete', {
    branch, commit, summary: 'Updated the producer to use reviewWithinHours.',
    checks: [{ command: 'node --test contract.test.mjs', outcome: 'passed' }],
    references: [{ path: 'producer.mjs', commit }],
  }))).request;
  assert.equal(request.status, 'completed');

  let reviews = 0;
  const options = {
    relay: alice,
    expected: { workspaceId: workspace.id, participantId: 'alice', repository: workspace.repository, requestId: request.id },
    stateDirectory: path.join(home, 'reviews'),
    getDiff: sha => readCommitDiff(aliceRepo, sha),
    async review(input) {
      reviews += 1;
      assert.equal(input.commit, commit);
      assert.equal(input.decisions[0].revision, 2);
      assert.equal(input.reportedChecks[0].outcome, 'passed');
      assert.match(input.diff, /^\+.*reviewWithinHours/m);
      return 'Deterministic fixture review checked the commit, contract revision, diff, and reported test.';
    },
  };
  await assert.rejects(checkHandoff(options), { code: 'COMMIT_UNAVAILABLE' });
  assert.equal(reviews, 0);
  await git(aliceRepo, 'fetch', '--no-tags', bobRepo, 'refs/heads/' + branch);
  assert.equal(await git(aliceRepo, 'rev-parse', 'FETCH_HEAD'), commit);
  const reviewed = await checkHandoff(options);
  assert.equal(reviewed.status, 'reviewed');
  assert.deepEqual(await checkHandoff(options), reviewed);
  assert.equal(reviews, 1);

  const { events } = await alice.events();
  for (const operation of ['request.create', 'request.accept', 'request.complete']) {
    assert.equal(events.filter(event => event.requestId === request.id && event.operation === operation).length, 1);
  }
  assert.equal(store.revokeCredential(bobProfile.credentialId), true);
  await assert.rejects(bob.inbox(), { code: 'UNAUTHORIZED' });
  console.log('Invalidated Bob’s revoked profile on his next request.');
  console.log('Fixture tests passed after the contract change. The reviewer fetched the missing commit and reused its saved review.');
  console.log('PASS: request ' + request.id + ' completed at v' + request.version + '. Fixture commit ' + commit + '.');
  console.log('Review: deterministic fixture. Assistant sessions: none.');
} finally {
  try {
    await relay?.close();
  } finally {
    store?.close();
    const target = await fs.realpath(directory);
    if (path.dirname(target) !== parent || !path.basename(target).startsWith(prefix)) throw Error('Unsafe rehearsal cleanup path.');
    await fs.rm(target, { recursive: true, force: true, maxRetries: 2 });
    console.log('Removed the disposable fixture checkouts, profiles, and database.');
  }
}
