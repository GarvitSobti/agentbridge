export function healthSummary(clientId, score) {
  if (typeof clientId !== 'string' || !clientId.trim()) throw new TypeError('A client ID is required.');
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new RangeError('Score must be an integer from 0 to 100.');
  const severity = score < 30 ? 'high' : score < 70 ? 'medium' : 'low';
  const hours = { high: 4, medium: 48, low: null };
  return { clientId, severity, reviewWithinHours: hours[severity] };
}
