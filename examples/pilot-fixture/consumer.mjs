export function makeReviewTask({ clientId, severity, reviewWithinHours }) {
  if (severity === 'low') return null;
  if (severity !== 'high' && severity !== 'medium') throw new TypeError('Unknown severity.');
  if (!Number.isInteger(reviewWithinHours) || reviewWithinHours <= 0) throw new TypeError('A review deadline is required.');
  return { clientId, priority: severity === 'high' ? 'urgent' : 'normal', reviewWithinHours };
}
