import type { CheckClaim, CodeReference, Command, Principal, Workspace } from './types.ts';

export type ErrorCode = 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_STATE'
  | 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'STALE_DECISION' | 'DECISION_NOT_AGREED';

export class DomainError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
export function requireThat(condition: unknown, code: ErrorCode, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}
function object(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', `${label} must be an object.`);
  requireThat(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
    'INVALID_INPUT', `${label} must be a plain object.`);
  const result = value as Record<string, unknown>;
  requireThat(Object.keys(result).every(key => allowed.includes(key)), 'INVALID_INPUT', `${label} contains an unknown field.`);
  return result;
}
export function text(value: unknown, label: string, limit = 8_000): string {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !value.includes('\0'),
    'INVALID_INPUT', `${label} must be nonempty text of at most ${limit} characters without NUL bytes.`);
  return value;
}
export function identifier(value: unknown, label: string): string {
  const result = text(value, label, 96);
  requireThat(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result), 'INVALID_INPUT', `${label} has an invalid format.`);
  return result;
}
export function positiveInteger(value: unknown, label: string): number {
  requireThat(typeof value === 'number' && Number.isSafeInteger(value) && value > 0, 'INVALID_INPUT', `${label} must be a positive safe integer.`);
  return value;
}
function commit(value: unknown): string {
  const result = text(value, 'commit', 64);
  requireThat(/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(result), 'INVALID_INPUT', 'Commit references must be full Git object IDs.');
  return result.toLowerCase();
}
function references(value: unknown): CodeReference[] {
  if (value === undefined) return [];
  requireThat(Array.isArray(value) && value.length <= 20, 'INVALID_INPUT', 'At most 20 code references are allowed.');
  return value.map(item => {
    const ref = object(item, ['path', 'commit'], 'reference');
    const path = text(ref.path, 'reference path', 512);
    requireThat(!/[\\:\x00-\x1f\x7f]/.test(path) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..'),
      'INVALID_INPUT', 'Reference paths must be portable repository-relative paths.');
    return ref.commit === undefined ? { path } : { path, commit: commit(ref.commit) };
  });
}
function checks(value: unknown): CheckClaim[] {
  requireThat(Array.isArray(value) && value.length > 0 && value.length <= 20, 'INVALID_INPUT', 'Report 1 to 20 checks, including an explicit not_run result when appropriate.');
  return value.map(item => {
    const check = object(item, ['command', 'outcome', 'details'], 'check');
    const command = text(check.command, 'check command', 1_000);
    requireThat(check.outcome === 'passed' || check.outcome === 'failed' || check.outcome === 'not_run', 'INVALID_INPUT', 'Unknown check outcome.');
    const outcome = check.outcome;
    if (outcome === 'not_run') requireThat(check.details !== undefined, 'INVALID_INPUT', 'Explain why a check was not run.');
    return check.details === undefined ? { command, outcome } : { command, outcome, details: text(check.details, 'check details', 2_000) };
  });
}

export function validateWorkspace(value: unknown): Workspace {
  const config = object(value, ['id', 'name', 'repository', 'participants'], 'workspace');
  requireThat(Array.isArray(config.participants) && config.participants.length === 2, 'INVALID_INPUT', 'A workspace needs exactly two participants.');
  const first = identifier(config.participants[0], 'participant');
  const second = identifier(config.participants[1], 'participant');
  requireThat(first !== second, 'INVALID_INPUT', 'Workspace participants must be distinct.');
  return {
    id: identifier(config.id, 'workspace ID'),
    repository: text(config.repository, 'repository', 2_048),
    participants: [first, second],
    ...(config.name === undefined ? {} : { name: text(config.name, 'workspace name', 80) }),
  };
}

export function authorize(workspace: Workspace, value: unknown): Principal {
  const actor = object(value, ['workspaceId', 'participantId', 'role'], 'principal');
  requireThat(actor.workspaceId === workspace.id && typeof actor.participantId === 'string'
    && workspace.participants.includes(actor.participantId) && (actor.role === 'human' || actor.role === 'agent'),
  'FORBIDDEN', 'Principal is not authorized for this workspace.');
  return { workspaceId: workspace.id, participantId: actor.participantId, role: actor.role };
}

export function parseCommand(value: unknown): Command {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'A command must be an object.');
  const kind = (value as Record<string, unknown>).type;
  const common = ['type', 'retryKey', 'requestId', 'expectedVersion'];
  const extra: Record<string, string[]> = {
    'request.create': ['recipientId', 'title', 'body', 'references'],
    'request.accept': [], 'request.decline': [], 'request.start': [], 'request.cancel': [],
    'request.reply': ['body'], 'decision.propose': ['decisionId', 'text', 'references'],
    'decision.agree': ['decisionId', 'revision', 'contentHash'],
    'request.complete': ['branch', 'commit', 'summary', 'checks', 'references'],
  };
  requireThat(typeof kind === 'string' && Object.hasOwn(extra, kind), 'INVALID_INPUT', 'Unknown command type.');
  const command = object(value, kind === 'request.create' ? ['type', 'retryKey', ...extra[kind]!] : [...common, ...extra[kind]!], 'command');
  const retryKey = identifier(command.retryKey, 'retry key');
  if (kind === 'request.create') return { type: kind, retryKey, recipientId: identifier(command.recipientId, 'recipient'),
    title: text(command.title, 'title', 160), body: text(command.body, 'body'), references: references(command.references) };
  const base = { retryKey, requestId: identifier(command.requestId, 'request ID'), expectedVersion: positiveInteger(command.expectedVersion, 'expected version') };
  switch (kind) {
    case 'request.accept': case 'request.decline': case 'request.start': case 'request.cancel': return { type: kind, ...base };
    case 'request.reply': return { type: kind, ...base, body: text(command.body, 'body') };
    case 'decision.propose': return { type: kind, ...base, text: text(command.text, 'decision text'), references: references(command.references),
      ...(command.decisionId === undefined ? {} : { decisionId: identifier(command.decisionId, 'decision ID') }) };
    case 'decision.agree': {
      const contentHash = text(command.contentHash, 'content hash', 64);
      requireThat(/^[a-f\d]{64}$/.test(contentHash), 'INVALID_INPUT', 'A decision content hash must be a lowercase SHA-256 digest.');
      return { type: kind, ...base, decisionId: identifier(command.decisionId, 'decision ID'), revision: positiveInteger(command.revision, 'revision'), contentHash };
    }
    case 'request.complete': {
      const branch = text(command.branch, 'branch', 200);
      requireThat(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) && !branch.includes('..')
        && branch.split('/').every(part => part !== '' && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock')),
      'INVALID_INPUT', 'Branch must be a valid named Git branch.');
      return { type: kind, ...base, branch, commit: commit(command.commit), summary: text(command.summary, 'summary'),
        checks: checks(command.checks), references: references(command.references) };
    }
    default: throw new DomainError('INVALID_INPUT', 'Unknown command type.');
  }
}

/** Deterministic for JSON values; object key order is irrelevant, array order is meaningful. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value) as string;
}
export function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
