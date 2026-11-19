import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import * as z from 'zod/v4';
import { AgentRelayClient, AgentRelayError } from '../mcp/relay-client.ts';
import { LocalError } from '../cli/profiles.ts';

const run = promisify(execFile);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const requestSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  status: z.string(),
  references: z.array(z.object({ path: z.string() })),
  pickup: z.object({
    prompt: z.string().min(1).max(24_000), promptHash: z.string().regex(/^[a-f0-9]{64}$/),
    approvedVersion: z.number().int().positive(), runId: z.string().optional(), failure: z.string().optional(),
  }).optional(),
});

interface Options {
  relay: Pick<AgentRelayClient, 'inbox' | 'getRequest' | 'submit'>;
  repository: string;
  expectedRepository: string;
  stateDirectory: string;
  edit: (prompt: string, checkout: string) => Promise<string>;
  signal?: AbortSignal;
}

function repositoryId(value: string): string | null {
  try {
    const ssh = /^[^@/:]+@([^/:]+):(.+)$/.exec(value);
    const url = new URL(ssh ? 'ssh://' + ssh[1] + '/' + ssh[2] : value);
    if (!['https:', 'ssh:'].includes(url.protocol) || url.search || url.hash || url.password) return null;
    const pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
    return pathname ? url.host + pathname : null;
  } catch { return null; }
}

const gitRun = (cwd: string, hooks: string, ...args: string[]) =>
  run('git', ['--no-replace-objects', '--literal-pathspecs', '-c', 'core.hooksPath=' + hooks, '-c', 'core.fsmonitor=false', ...args], {
    cwd, windowsHide: true, timeout: 15_000, maxBuffer: 256 * 1024,
  }).then(result => result.stdout);

async function checkFiles(checkout: string, files: string[]): Promise<void> {
  for (const file of files) {
    const filename = path.join(checkout, file);
    const stat = await fs.lstat(filename).catch(() => null);
    const resolved = stat?.isFile() ? await fs.realpath(filename) : null;
    const relative = resolved === null ? '..' : path.relative(checkout, resolved);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new LocalError('PICKUP_FILES_INVALID', 'The approved file list must refer to existing regular files in the selected worktree.');
    }
  }
}

export async function verifyPickupRepo(repository: string, expectedRepository: string, stateDirectory: string) {
  const repo = await fs.realpath(repository);
  const hooks = path.join(stateDirectory, 'disabled-hooks');
  const expected = repositoryId(expectedRepository);
  const actual = repositoryId((await gitRun(repo, hooks, 'remote', 'get-url', 'origin')).trim());
  if (!expected || actual !== expected) throw new LocalError('PICKUP_REPO_MISMATCH', 'Select a Git checkout with origin matching the relay workspace repository.');
  return repo;
}

export async function runApprovedPickup(options: Options) {
  const { relay, stateDirectory, signal } = options;
  const inbox = z.array(requestSchema).parse((await relay.inbox()).requests);
  const candidate = inbox.find(request => request.status === 'accepted' && request.pickup?.approvedVersion === request.version && !request.pickup.runId);
  if (!candidate?.pickup) return { status: 'waiting' as const };
  const { id, version, pickup } = candidate;
  if (hash(pickup.prompt) !== pickup.promptHash) throw new LocalError('PICKUP_PROMPT_INVALID', 'The approved prompt did not match its digest.');
  const files = [...new Set(candidate.references.map(reference => reference.path))];
  if (!files.length || files.some(file => !file.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)))) {
    throw new LocalError('PICKUP_FILES_INVALID', 'The approved file list is invalid.');
  }
  const repo = await verifyPickupRepo(options.repository, options.expectedRepository, stateDirectory);
  const hooks = path.join(stateDirectory, 'disabled-hooks');
  const base = (await gitRun(repo, hooks, 'rev-parse', '--verify', 'HEAD^{commit}')).trim();
  await gitRun(repo, hooks, 'ls-files', '--error-unmatch', '--', ...files);
  await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  signal?.throwIfAborted();

  const runId = randomUUID();
  const claim = { type: 'request.claim_pickup', requestId: id, expectedVersion: version, promptHash: pickup.promptHash, retryKey: runId };
  try {
    await relay.submit(claim);
  } catch (error) {
    // A lost response may hide a successful claim. Only this process knows its run ID.
    if (!(error instanceof AgentRelayError) || !['RELAY_UNAVAILABLE', 'VERSION_CONFLICT', 'INVALID_STATE'].includes(error.code)) throw error;
  }

  const readCurrent = async () => requestSchema.parse((await relay.getRequest(id)).request);
  const current = await readCurrent();
  if (current.status !== 'in_progress' || current.pickup?.runId !== runId) return { status: 'waiting' as const };
  const branch = 'agentbridge/pickup-' + hash(id).slice(0, 12) + '-v' + version;
  const checkout = path.join(stateDirectory, runId);
  function verifyCurrent(request: z.infer<typeof requestSchema>) {
    if (request.status !== 'in_progress' || request.pickup?.runId !== runId || request.version !== version + 1 || request.pickup.failure
        || request.pickup.promptHash !== pickup.promptHash || request.pickup.prompt !== pickup.prompt) {
      throw new LocalError('PICKUP_CHANGED', 'The request changed after approval. The generated work needs human review.');
    }
  }

  try {
    verifyCurrent(current);
    await gitRun(repo, hooks, 'worktree', 'add', '-b', branch, checkout, base);
    await checkFiles(await fs.realpath(checkout), files);
    verifyCurrent(await readCurrent());
    signal?.throwIfAborted();
    await options.edit(pickup.prompt, checkout);
    signal?.throwIfAborted();
    await checkFiles(await fs.realpath(checkout), files);
    const changed = (await gitRun(checkout, hooks, 'diff', '--name-only', '-z', 'HEAD')).split('\0').filter(Boolean);
    const untracked = await gitRun(checkout, hooks, 'ls-files', '--others', '-z');
    if (!changed.length || untracked || changed.some(file => !files.includes(file))) {
      throw new LocalError('PICKUP_EDITS_INVALID', 'The worktree contains no approved changes or has edits outside the approved file list.');
    }
    await gitRun(checkout, hooks, 'diff', '--check', 'HEAD');
    verifyCurrent(await readCurrent());
    await gitRun(checkout, hooks, 'add', '--', ...changed);
    await gitRun(checkout, hooks, 'commit', '-m', 'Implement approved Agent Bridge pickup ' + id);
    const commit = (await gitRun(checkout, hooks, 'rev-parse', 'HEAD')).trim();

    const completed = {
      type: 'request.complete', requestId: id, expectedVersion: version + 1, retryKey: randomUUID(), pickupRunId: runId,
      branch, commit, summary: 'Claude Code edited ' + changed.length + ' approved file' + (changed.length === 1 ? '.' : 's.'),
      checks: [{ command: 'git diff --check HEAD', outcome: 'passed' },
        { command: 'Contract checks', outcome: 'not_run', details: 'The pickup runner uses file tools. Run the contract checks during integration.' }],
      references: changed.map(file => ({ path: file, commit })),
    };
    try { await relay.submit(completed); }
    catch (error) {
      if (!(error instanceof AgentRelayError) || error.code !== 'RELAY_UNAVAILABLE') throw error;
      await relay.submit(completed);
    }
    return { status: 'completed' as const, requestId: id, branch, commit, checkout };
  } catch (error) {
    const reason = error instanceof LocalError ? error.message : 'The local pickup could not finish. Inspect the scratch worktree and runner output.';
    try {
      const latest = await readCurrent();
      if (latest.status === 'in_progress' && latest.pickup?.runId === runId && !latest.pickup.failure) {
        await relay.submit({ type: 'request.fail_pickup', requestId: id, expectedVersion: latest.version, retryKey: randomUUID(), pickupRunId: runId, reason });
      }
    } catch { /* Keep the worktree and rely on the durable claim if the relay is unavailable. */ }
    return { status: 'needs_attention' as const, requestId: id, reason, checkout };
  }
}

export async function editWithClaude(prompt: string, checkout: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('claude', [
      '-p', '--restricted', '--safe-mode', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--tools', 'Read,Glob,Grep,Edit', '--disallowedTools', 'mcp__*', '--permission-mode', 'acceptEdits',
      '--max-turns', '16', '--no-session-persistence',
    ], { cwd: checkout, windowsHide: true, timeout: 180_000, maxBuffer: 128 * 1024, ...(signal ? { signal } : {}) },
    (error, stdout) => {
      if (error) reject(new LocalError('CLAUDE_PICKUP_FAILED', 'Claude Code did not finish. Check its version, sign-in, and local permissions.'));
      else resolve(stdout);
    });
    child.stdin?.on('error', error => reject(error));
    child.stdin?.end(prompt);
  });
}
