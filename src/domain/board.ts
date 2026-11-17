import type { BoardState, Command, CommandResult, DomainEvent, Environment, Principal, WorkRequest } from './types.ts';
import { authorize, canonical, copy, identifier, parseCommand, requireThat, validateWorkspace } from './validation.ts';

export { DomainError } from './validation.ts';
export type * from './types.ts';

export function createBoard(workspace: unknown): BoardState {
  return { schemaVersion: 1, workspace: validateWorkspace(workspace), requests: [], events: [], receipts: [] };
}

function findRequest(state: BoardState, id: string): WorkRequest {
  const request = state.requests.find(item => item.id === id);
  requireThat(request, 'NOT_FOUND', 'Request does not exist in this workspace.');
  return request;
}
function active(request: WorkRequest): void {
  requireThat(!['completed', 'declined', 'cancelled'].includes(request.status), 'INVALID_STATE', 'Terminal requests are read-only. Create a new request for further work.');
}
function requireAgreement(request: WorkRequest, state: BoardState): void {
  for (const decision of request.decisions) {
    const latest = decision.revisions.at(-1)!;
    requireThat(state.workspace.participants.every(id => latest.acknowledgments.some(ack => ack.participantId === id)),
      'DECISION_NOT_AGREED', 'Both participants must acknowledge each current decision revision before starting or completing work.');
  }
}
function policy(request: WorkRequest, actor: Principal, command: Command): void {
  const recipient = actor.participantId === request.recipientId;
  const human = actor.role === 'human';
  switch (command.type) {
    case 'request.accept': case 'request.decline':
      requireThat(human && recipient, 'FORBIDDEN', 'Only the addressed human may accept or decline work.'); break;
    case 'request.start': case 'request.complete':
      requireThat(!human && recipient, 'FORBIDDEN', 'Only the assigned participant\'s agent may start or report completion.'); break;
    case 'request.cancel':
      requireThat(human && (request.status !== 'pending' || actor.participantId === request.requesterId),
        'FORBIDDEN', 'A pending request may be cancelled only by the requesting human; after acceptance either human may cancel.'); break;
  }
}

/**
 * Pure transaction planner: never mutates the supplied state or emits external effects.
 * A future store must serialize/atomically persist state, events, and retry receipts.
 * `actor` and `environment` must come from trusted server code, not client task data.
 */
export function execute(state: BoardState, principal: unknown, input: unknown, environment: Environment): { state: BoardState; result: CommandResult } {
  const actor = authorize(state.workspace, principal);
  const command = parseCommand(input);
  const payloadHash = environment.sha256(canonical(command));
  requireThat(/^[a-f\d]{64}$/.test(payloadHash), 'INVALID_INPUT', 'Server hash provider must return a SHA-256 digest.');
  const receipt = state.receipts.find(item => item.participantId === actor.participantId && item.role === actor.role
    && item.operation === command.type && item.retryKey === command.retryKey);
  if (receipt) {
    requireThat(receipt.payloadHash === payloadHash, 'IDEMPOTENCY_CONFLICT', 'The retry key was already used with a different payload.');
    return { state, result: { ...copy(receipt.result), replayed: true } };
  }

  const next = copy(state);
  let request: WorkRequest;
  let beforeVersion: number | null = null;
  // Server dependencies are consulted only after input/identity validation and retry lookup.
  const at = environment.now();
  requireThat(typeof at === 'string' && Number.isFinite(Date.parse(at)), 'INVALID_INPUT', 'Server clock returned an invalid timestamp.');
  const newId = (): string => identifier(environment.id(), 'server-generated ID');
  if (command.type === 'request.create') {
    requireThat(next.workspace.participants.includes(command.recipientId) && command.recipientId !== actor.participantId,
      'INVALID_INPUT', 'A request must name the other workspace participant.');
    const id = newId();
    requireThat(!next.requests.some(item => item.id === id), 'INVALID_INPUT', 'Server-generated request ID already exists.');
    request = { id, workspaceId: next.workspace.id, requesterId: actor.participantId, recipientId: command.recipientId,
      title: command.title, body: command.body, references: command.references, status: 'pending', version: 1,
      decisions: [], messages: [], createdAt: at, updatedAt: at };
    next.requests.push(request);
  } else {
    request = findRequest(next, command.requestId);
    policy(request, actor, command);
    requireThat(request.version === command.expectedVersion, 'VERSION_CONFLICT', 'Request changed; read its current version before retrying with a new key.');
    active(request);
    beforeVersion = request.version;
    switch (command.type) {
      case 'request.accept': case 'request.decline':
        requireThat(request.status === 'pending', 'INVALID_STATE', 'Only pending requests may be accepted or declined.');
        request.status = command.type === 'request.accept' ? 'accepted' : 'declined'; break;
      case 'request.start':
        requireThat(request.status === 'accepted', 'INVALID_STATE', 'Work must be accepted by the addressed human before it can start.');
        requireAgreement(request, next);
        request.status = 'in_progress'; break;
      case 'request.cancel': request.status = 'cancelled'; break;
      case 'request.reply': request.messages.push({ id: newId(), author: actor, body: command.body, at }); break;
      case 'decision.propose': {
        let decision = command.decisionId === undefined ? undefined : request.decisions.find(item => item.id === command.decisionId);
        requireThat(command.decisionId === undefined || decision, 'NOT_FOUND', 'Decision does not exist on this request.');
        if (!decision) {
          const id = newId();
          requireThat(!request.decisions.some(item => item.id === id), 'INVALID_INPUT', 'Server-generated decision ID already exists.');
          decision = { id, revisions: [] };
          request.decisions.push(decision);
        }
        const contentHash = environment.sha256(canonical({ text: command.text, references: command.references }));
        requireThat(/^[a-f\d]{64}$/.test(contentHash), 'INVALID_INPUT', 'Server hash provider must return a SHA-256 digest.');
        decision.revisions.push({ revision: decision.revisions.length + 1, text: command.text, references: command.references,
          contentHash, proposedBy: actor, proposedAt: at, acknowledgments: [] });
        break;
      }
      case 'decision.agree': {
        const decision = request.decisions.find(item => item.id === command.decisionId);
        requireThat(decision, 'NOT_FOUND', 'Decision does not exist on this request.');
        const latest = decision.revisions.at(-1)!;
        requireThat(latest.revision === command.revision && latest.contentHash === command.contentHash,
          'STALE_DECISION', 'Read and acknowledge the current decision revision and content hash.');
        requireThat(!latest.acknowledgments.some(ack => ack.participantId === actor.participantId), 'INVALID_STATE', 'Participant already acknowledged this revision.');
        latest.acknowledgments.push({ participantId: actor.participantId, role: actor.role, at }); break;
      }
      case 'request.complete':
        requireThat(request.status === 'in_progress', 'INVALID_STATE', 'Only work in progress can be reported completed.');
        requireAgreement(request, next);
        request.completion = { repository: next.workspace.repository, branch: command.branch, commit: command.commit,
          summary: command.summary, checks: command.checks, references: command.references,
          reporter: actor, reportedAt: at, verification: 'self_reported' };
        request.status = 'completed'; break;
    }
    request.version++;
    request.updatedAt = at;
  }
  const event: DomainEvent = { cursor: next.events.length + 1, requestId: request.id, operation: command.type,
    actor, at, beforeVersion, afterVersion: request.version };
  next.events.push(event);
  const result = { request: copy(request), event: copy(event) };
  next.receipts.push({ participantId: actor.participantId, role: actor.role, operation: command.type,
    retryKey: command.retryKey, payloadHash, result: copy(result) });
  return { state: next, result: { ...result, replayed: false } };
}

export function readRequest(state: BoardState, principal: unknown, requestId: string): WorkRequest {
  authorize(state.workspace, principal);
  return copy(findRequest(state, identifier(requestId, 'request ID')));
}
export function readInbox(state: BoardState, principal: unknown): WorkRequest[] {
  const actor = authorize(state.workspace, principal);
  return copy(state.requests.filter(request => request.recipientId === actor.participantId
    && ['pending', 'accepted', 'in_progress'].includes(request.status)));
}
export function readEvents(state: BoardState, principal: unknown, after = 0, limit = 100): DomainEvent[] {
  authorize(state.workspace, principal);
  requireThat(Number.isSafeInteger(after) && after >= 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= 100,
    'INVALID_INPUT', 'Use a nonnegative cursor and a page size between 1 and 100.');
  return copy(state.events.filter(event => event.cursor > after).slice(0, limit));
}
