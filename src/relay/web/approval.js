const key = 'agentbridge.pending-approval';

export function readApproval() {
  try {
    const value = JSON.parse(sessionStorage.getItem(key));
    const command = value?.command;
    const identifier = /^[A-Za-z0-9_-]{1,96}$/;
    if (typeof value?.workspaceId === 'string' && typeof value.participant === 'string'
      && typeof command?.requestId === 'string' && identifier.test(command.requestId)
      && (['request.accept', 'request.decline'].includes(command.type)
        || (command.type === 'request.approve_pickup' && /^[a-f0-9]{64}$/.test(command.promptHash)))
      && Number.isSafeInteger(command.expectedVersion) && command.expectedVersion > 0
      && typeof command.retryKey === 'string' && /^[a-f0-9-]{36}$/.test(command.retryKey)) return value;
  } catch {
    // A tab without session storage can still recover while it stays open.
  }
  return undefined;
}

export function saveApproval(attempt) {
  try {
    if (attempt) sessionStorage.setItem(key, JSON.stringify(attempt));
    else sessionStorage.removeItem(key);
  } catch {
    // The in-memory attempt still protects a retry in this tab.
  }
}

export function approvalState(attempt, { workspace, participant, request, pickupPreview }) {
  if (workspace.id !== attempt.workspaceId || participant !== attempt.participant) return 'other-member';
  if (request?.id !== attempt.command.requestId) return 'other-request';
  if (attempt.command.type === 'request.approve_pickup') {
    if (request.pickup?.promptHash === attempt.command.promptHash && request.pickup.approvedVersion === attempt.command.expectedVersion + 1) {
      return 'resolved';
    }
    if (!['pending', 'accepted'].includes(request.status)) return 'resolved';
    return request.version === attempt.command.expectedVersion && pickupPreview?.ready
      && pickupPreview.promptHash === attempt.command.promptHash ? 'retry' : 'changed';
  }
  if (request.status !== 'pending') return 'resolved';
  return request.version === attempt.command.expectedVersion ? 'retry' : 'changed';
}
