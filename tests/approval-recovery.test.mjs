import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalState, readApproval, saveApproval } from '../src/relay/web/approval.js';

const attempt = {
  workspaceId: 'pilot', participant: 'bob',
  command: { type: 'request.accept', requestId: 'r1', expectedVersion: 3, retryKey: '9dd59c57-4ce7-44b1-89fb-b1ca19a282f7' },
};
const snapshot = (request, membership = {}) => ({ workspace: { id: 'pilot' }, participant: 'bob', request, ...membership });

test('approval recovery offers an exact retry only for the same participant, request and pending version', () => {
  const pending = { id: 'r1', status: 'pending', version: 3 };
  assert.equal(approvalState(attempt, snapshot(pending)), 'retry');
  assert.equal(approvalState(attempt, snapshot({ ...pending, version: 4 })), 'changed');
  assert.equal(approvalState(attempt, snapshot({ ...pending, id: 'r2' })), 'other-request');
  assert.equal(approvalState(attempt, snapshot(pending, { participant: 'alice' })), 'other-member');
  assert.equal(approvalState(attempt, snapshot(pending, { workspace: { id: 'other' } })), 'other-member');

  for (const status of ['accepted', 'in_progress', 'completed', 'declined', 'cancelled']) {
    assert.equal(approvalState(attempt, snapshot({ ...pending, status, version: 4 })), 'resolved');
  }
});

test('one tab retains the same decision key across reload and ignores malformed attempts', t => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, 'sessionStorage', saved);
    else delete globalThis.sessionStorage;
  });
  assert.equal(readApproval(), undefined);
  saveApproval(attempt);
  assert.deepEqual(readApproval(), attempt);
  saveApproval({ ...attempt, command: { ...attempt.command, expectedVersion: 0 } });
  assert.equal(readApproval(), undefined);
  saveApproval(attempt);
  saveApproval(undefined);
  assert.equal(values.size, 0);
  storage.getItem = () => { throw new Error('Storage disabled'); };
  assert.equal(readApproval(), undefined);
});
