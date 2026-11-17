import { createHash, randomUUID } from 'node:crypto';
import { createBoard, execute } from '../src/domain/board.ts';

// Synthetic, single-process demonstration. No agents, authentication, or network are running.
const workspaceId = 'synthetic-crm';
const actor = (participantId, role) => ({ workspaceId, participantId, role });
const environment = { id: randomUUID, now: () => new Date().toISOString(),
  sha256: value => createHash('sha256').update(value).digest('hex') };
let state = createBoard({ id: workspaceId, repository: 'https://example.com/synthetic-crm.git', participants: ['alice', 'bob'] });
let current;
function send(principal, command) {
  const outcome = execute(state, principal, { retryKey: randomUUID(), ...command }, environment);
  state = outcome.state;
  current = outcome.result.request;
  console.log(`${outcome.result.event.cursor}. ${principal.participantId}/${principal.role}: ${command.type} -> ${current.status} (v${current.version})`);
}
function change(principal, type, fields = {}) {
  send(principal, { type, requestId: current.id, expectedVersion: current.version, ...fields });
}
send(actor('alice', 'agent'), { type: 'request.create', recipientId: 'bob', title: 'Expose health severity', body: 'Task creation needs a stable severity field.' });
change(actor('bob', 'agent'), 'request.reply', { body: 'I can expose low, medium, or high.' });
change(actor('alice', 'agent'), 'decision.propose', { text: 'The health response contains severity: low | medium | high.' });
const decision = current.decisions[0];
for (const participant of ['alice', 'bob']) change(actor(participant, 'agent'), 'decision.agree', {
  decisionId: decision.id, revision: 1, contentHash: decision.revisions[0].contentHash,
});
change(actor('bob', 'human'), 'request.accept');
change(actor('bob', 'agent'), 'request.start');
change(actor('bob', 'agent'), 'request.complete', { branch: 'feat/health-severity', commit: 'a'.repeat(40),
  summary: 'Synthetic completion report; no code was edited and no Git object was verified.',
  checks: [{ command: 'consumer integration test', outcome: 'not_run', details: 'This demo exercises domain rules only.' }] });
console.log(`Completion evidence: ${current.completion.verification}. The commit above is a placeholder fixture ID.`);
