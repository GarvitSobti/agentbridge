import test from 'node:test';
import assert from 'node:assert/strict';
import { healthSummary } from './producer.mjs';
import { makeReviewTask } from './consumer.mjs';

test('producer and consumer agree on the deadline for all supported scores', () => {
  for (let score = 0; score <= 100; score += 1) {
    const summary = healthSummary('fixture-client', score);
    const expectedSeverity = score < 30 ? 'high' : score < 70 ? 'medium' : 'low';
    const expectedHours = score < 30 ? 4 : score < 70 ? 48 : null;
    assert.deepEqual(summary, { clientId: 'fixture-client', severity: expectedSeverity, reviewWithinHours: expectedHours });
    const task = makeReviewTask(summary);
    const priority = expectedSeverity === 'high' ? 'urgent' : 'normal';
    assert.deepEqual(task, expectedHours === null ? null : { clientId: 'fixture-client', priority, reviewWithinHours: expectedHours });
  }
});

test('a legacy deadline field cannot satisfy the agreed contract', () => {
  assert.throws(() => makeReviewTask({ clientId: 'fixture-client', severity: 'high', followUpHours: 24 }), TypeError);
  assert.deepEqual(makeReviewTask({ clientId: 'fixture-client', severity: 'high', reviewWithinHours: 6 }),
    { clientId: 'fixture-client', priority: 'urgent', reviewWithinHours: 6 });
});

test('out-of-range and fractional scores are rejected', () => {
  for (const score of [-1, 101, 0.5, '10']) assert.throws(() => healthSummary('fixture-client', score), RangeError);
});
