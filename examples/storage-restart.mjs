import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SqliteStore } from '../src/storage/sqlite-store.ts';

// Local synthetic storage demonstration: no network, credentials, or agents are involved.
const directory = path.resolve('.agent-bridge');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const filename = path.join(directory, 'storage-demo.db');
const workspace = { id: 'storage-demo', repository: 'https://example.com/synthetic-crm.git', participants: ['alice', 'bob'] };
const actor = (participantId, role = 'agent') => ({ workspaceId: workspace.id, participantId, role });
const command = { type: 'request.create', retryKey: randomUUID(), recipientId: 'bob',
  title: 'Expose health severity', body: 'Synthetic task creation needs a severity field.' };
let store = new SqliteStore(filename, workspace);
try {
  const created = store.execute(actor('alice'), command);
  let request = created.request;
  console.log(`Created pending request ${request.id}.`);
  request = store.execute(actor('bob', 'human'), { type: 'request.accept', requestId: request.id,
    expectedVersion: request.version, retryKey: randomUUID() }).request;
  store.close();
  console.log('Closed the connection. Reopening the same database file...');
  store = new SqliteStore(filename, workspace);
  const replay = store.execute(actor('alice'), command);
  if (!replay.replayed || replay.request.id !== request.id) throw Error('Retry was not preserved.');
  const restored = store.getRequest(actor('bob'), request.id);
  if (restored.status !== 'accepted') throw Error('The current request state was not restored.');
  console.log(`Original create command replayed safely: ${replay.replayed}.`);
  console.log(`Current saved state: ${restored.status} (v${restored.version}); original retry result: ${replay.request.status}.`);
  const events = store.events(actor('bob'), created.event.cursor);
  if (events.length !== 1 || events[0].requestId !== request.id || events[0].operation !== 'request.accept') {
    throw Error('Event catch-up did not resume at the saved workspace cursor.');
  }
  console.log(`Inbox catch-up: ${events.length} event after the saved cursor.`);
  console.log(`Synthetic data remains in ${filename}; this directory is ignored by Git.`);
} finally { store.close(); }
