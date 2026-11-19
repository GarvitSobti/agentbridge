import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod/v4';
import { AgentRelayClient } from '../mcp/relay-client.ts';
import { LocalError } from '../cli/profiles.ts';

const fullCommit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
const latestDecision = z.object({ revision: z.number().int(), contentHash: z.string(), text: z.string() });
const requestShape = z.object({
  id: z.string(),
  workspaceId: z.string(),
  requesterId: z.string(),
  recipientId: z.string(),
  version: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  status: z.enum(['pending', 'accepted', 'in_progress', 'completed', 'cancelled', 'declined']),
  decisions: z.array(z.object({ id: z.string(), revisions: z.array(latestDecision).min(1) })),
  completion: z.object({
    commit: fullCommit,
    repository: z.string(),
    checks: z.array(z.object({ command: z.string(), outcome: z.enum(['passed', 'failed', 'not_run']) })),
    reporter: z.object({ participantId: z.string(), workspaceId: z.string(), role: z.literal('agent') }),
  }).optional(),
});

export interface ReviewInput {
  requestId: string;
  commit: string;
  title: string;
  request: string;
  decisions: Array<z.infer<typeof latestDecision> & { id: string }>;
  reportedChecks: Array<{ command: string; outcome: string }>;
  diff: string;
}
const reviewRecord = z.object({
  requestId: z.string(),
  version: z.number(),
  commit: fullCommit,
  status: z.enum(['started', 'reviewed', 'failed']),
  result: z.string().optional(),
});
type ReviewRecord = z.infer<typeof reviewRecord>;
interface Options {
  relay: Pick<AgentRelayClient, 'getRequest'>;
  expected: { workspaceId: string; repository: string; participantId: string; requestId: string };
  stateDirectory: string;
  getDiff: (commit: string) => Promise<string>;
  review: (input: ReviewInput) => Promise<string>;
}
export type HandoffResult = ReviewRecord | { requestId: string; status: 'waiting' | 'cancelled' | 'declined' };

function isFileError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function readRecord(filename: string): Promise<ReviewRecord | null> {
  let text: string;
  try {
    text = await readFile(filename, 'utf8');
  } catch (error) {
    if (isFileError(error, 'ENOENT')) return null;
    throw new LocalError('REVIEW_STATE_UNAVAILABLE', 'Could not read the local review record.');
  }
  try {
    return reviewRecord.parse(JSON.parse(text));
  } catch {
    throw new LocalError('REVIEW_STATE_UNAVAILABLE', 'The local review record is incomplete or invalid. Inspect it before retrying.');
  }
}

/** Check one explicitly selected outgoing request. Reserve its only automatic attempt before launching a reviewer. */
export async function checkHandoff(options: Options): Promise<HandoffResult> {
  const { relay, expected, stateDirectory, getDiff, review } = options;
  const response = await relay.getRequest(expected.requestId);
  const parsed = requestShape.safeParse(response.request);
  if (!parsed.success) throw new LocalError('INVALID_REVIEW_REQUEST', 'The relay returned an invalid request.');
  const request = parsed.data;
  if (request.id !== expected.requestId || request.workspaceId !== expected.workspaceId || request.requesterId !== expected.participantId) {
    throw new LocalError('REVIEW_NOT_OWNED', 'Select a request you opened with this agent profile.');
  }
  if (request.status === 'cancelled' || request.status === 'declined') return { requestId: request.id, status: request.status };
  if (request.status !== 'completed') return { requestId: request.id, status: 'waiting' };

  const completion = request.completion;
  if (!completion || completion.repository !== expected.repository ||
      completion.reporter.participantId !== request.recipientId || completion.reporter.workspaceId !== request.workspaceId) {
    throw new LocalError('INVALID_REVIEW_REQUEST', 'The completion does not match the selected repository and recipient.');
  }
  const commit = completion.commit.toLowerCase();
  const key = createHash('sha256').update(JSON.stringify([expected.workspaceId, expected.repository, expected.participantId, request.id])).digest('hex');
  const filename = path.join(stateDirectory, key + '.json');
  const previous = await readRecord(filename);
  if (previous) {
    if (previous.requestId !== request.id || previous.commit !== commit || previous.version !== request.version) {
      throw new LocalError('REVIEW_STATE_CONFLICT', 'The relay completion differs from the local review record.');
    }
    return previous;
  }

  // A missing local commit leaves the review eligible after the owner makes it available.
  const diff = await getDiff(commit);
  if (!diff.trim()) throw new LocalError('REVIEW_DIFF_EMPTY', 'The completion commit has no textual diff to review.');
  const input: ReviewInput = {
    requestId: request.id,
    commit,
    title: request.title,
    request: request.body,
    decisions: request.decisions.map(decision => ({ id: decision.id, ...decision.revisions.at(-1)! })),
    reportedChecks: completion.checks,
    diff,
  };
  if (Buffer.byteLength(JSON.stringify(input)) > 96 * 1024) {
    throw new LocalError('REVIEW_INPUT_TOO_LARGE', 'The review context exceeds 96 KiB. Review the commit manually.');
  }

  // Refresh authenticated task state after collecting the diff and before reserving the review.
  const confirm = requestShape.safeParse((await relay.getRequest(request.id)).request);
  if (!confirm.success || confirm.data.id !== request.id || confirm.data.workspaceId !== request.workspaceId ||
      confirm.data.requesterId !== request.requesterId || confirm.data.status !== 'completed' ||
      confirm.data.version !== request.version || confirm.data.completion?.commit.toLowerCase() !== commit ||
      confirm.data.completion.repository !== expected.repository) {
    throw new LocalError('REVIEW_STATE_CONFLICT', 'The completion changed while preparing the review.');
  }

  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const record: ReviewRecord = { requestId: request.id, commit, version: request.version, status: 'started' };
  try {
    const file = await open(filename, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(record) + '\n');
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (error) {
    if (isFileError(error, 'EEXIST')) return record;
    throw error;
  }

  try {
    const result = await review(input);
    if (!result.trim() || Buffer.byteLength(result) > 32 * 1024) throw Error('Invalid review output');
    record.status = 'reviewed';
    record.result = result;
  } catch {
    record.status = 'failed';
    record.result = 'The Codex review did not return a usable result. Check Codex availability and sign-in, then review this commit manually.';
  }

  // Preserve the original reservation even if the final result cannot be saved.
  const temporary = filename + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temporary, filename);
  return record;
}
