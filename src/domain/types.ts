export type Role = 'human' | 'agent';
export type RequestStatus = 'pending' | 'accepted' | 'in_progress' | 'completed' | 'declined' | 'cancelled';

/** Constructed by a trusted authentication adapter, never copied from a task payload. */
export interface Principal {
  workspaceId: string;
  participantId: string;
  role: Role;
}

export interface Workspace {
  id: string;
  name?: string;
  repository: string;
  participants: [string, string];
}

export interface CodeReference { path: string; commit?: string }
export interface CheckClaim {
  command: string;
  outcome: 'passed' | 'failed' | 'not_run';
  details?: string;
}
export interface Completion {
  repository: string;
  branch: string;
  commit: string;
  summary: string;
  checks: CheckClaim[];
  references: CodeReference[];
  reporter: Principal;
  reportedAt: string;
  verification: 'self_reported';
}
export interface DecisionRevision {
  revision: number;
  text: string;
  references: CodeReference[];
  contentHash: string;
  proposedBy: Principal;
  proposedAt: string;
  acknowledgments: { participantId: string; role: Role; at: string }[];
}
export interface Decision { id: string; revisions: DecisionRevision[] }
export interface Message { id: string; author: Principal; body: string; at: string }
export interface WorkRequest {
  id: string;
  workspaceId: string;
  requesterId: string;
  recipientId: string;
  title: string;
  body: string;
  references: CodeReference[];
  status: RequestStatus;
  version: number;
  decisions: Decision[];
  messages: Message[];
  completion?: Completion;
  pickup?: {
    prompt: string;
    promptHash: string;
    approvedVersion: number;
    runId?: string;
    failure?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface Retry { retryKey: string }
interface ExistingRequest extends Retry { requestId: string; expectedVersion: number }
export type Command =
  | (Retry & { type: 'request.create'; recipientId: string; title: string; body: string; references: CodeReference[] })
  | (ExistingRequest & { type: 'request.accept' | 'request.decline' | 'request.start' | 'request.cancel' })
  | (ExistingRequest & { type: 'request.approve_pickup' | 'request.claim_pickup'; promptHash: string })
  | (ExistingRequest & { type: 'request.fail_pickup'; pickupRunId: string; reason: string })
  | (ExistingRequest & { type: 'request.reply'; body: string })
  | (ExistingRequest & { type: 'decision.propose'; decisionId?: string; text: string; references: CodeReference[] })
  | (ExistingRequest & { type: 'decision.agree'; decisionId: string; revision: number; contentHash: string })
  | (ExistingRequest & { type: 'request.complete'; branch: string; commit: string; summary: string; checks: CheckClaim[]; references: CodeReference[]; pickupRunId?: string });

export interface DomainEvent {
  cursor: number;
  requestId: string;
  operation: Command['type'];
  actor: Principal;
  at: string;
  beforeVersion: number | null;
  afterVersion: number;
}
export interface CommandResult { request: WorkRequest; event: DomainEvent; replayed: boolean }
export interface RetryReceipt {
  participantId: string;
  role: Role;
  operation: Command['type'];
  retryKey: string;
  payloadHash: string;
  result: Omit<CommandResult, 'replayed'>;
}

/** JSON-serializable reference state. It is not a database or a durable store. */
export interface BoardState {
  schemaVersion: 1;
  workspace: Workspace;
  requests: WorkRequest[];
  events: DomainEvent[];
  receipts: RetryReceipt[];
}

/** Server-owned dependencies; callers cannot supply these through a command. */
export interface Environment {
  id(): string;
  now(): string;
  sha256(value: string): string;
}
