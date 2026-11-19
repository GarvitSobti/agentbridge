import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { homePath, loadAgentProfile, LocalError, readConfig } from './profiles.ts';
import { AgentRelayClient, AgentRelayError } from '../mcp/relay-client.ts';
import { checkHandoff } from '../review/handoff.ts';
import { readCommitDiff, runCodexReview } from '../review/codex.ts';

const usage = 'npm run review:watch -- --profile NAME --request ID --repo PATH [--home PATH] [--once]';
try {
  const { values } = parseArgs({ options: {
    profile: { type: 'string' }, request: { type: 'string' }, repo: { type: 'string' },
    home: { type: 'string' }, once: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log(usage);
  } else {
    const { profile, request, repo } = values;
    if (!profile || !repo || !request || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(request)) {
      throw new LocalError('INVALID_ARGUMENTS', usage);
    }
    const home = homePath(values.home);
    const config = readConfig(home);
    const identity = loadAgentProfile(home, profile);
    const repository = await realpath(repo);
    const relay = new AgentRelayClient(`http://127.0.0.1:${config.port}`, identity);
    const deadline = performance.now() + 30 * 60_000;
    console.error('Watching one outgoing request. Codex receives its task, agreed revisions, reported check outcomes, and local commit diff.');
    let last: 'waiting' | 'offline' | undefined;
    for (;;) {
      try {
        const result = await checkHandoff({
          relay,
          expected: { workspaceId: config.workspace.id, repository: config.workspace.repository, participantId: identity.participantId, requestId: request },
          stateDirectory: path.join(home, 'reviews'),
          getDiff: commit => readCommitDiff(repository, commit),
          review: runCodexReview,
        });
        if (result.status !== 'waiting' || values.once || performance.now() >= deadline) {
          console.log(JSON.stringify(result, null, 2));
          if (result.status === 'failed' || result.status === 'started') process.exitCode = 1;
          break;
        }
        if (last !== 'waiting') console.error('Waiting for completion.');
        last = 'waiting';
      } catch (error) {
        if (!(error instanceof AgentRelayError) || error.code !== 'RELAY_UNAVAILABLE' || values.once || performance.now() >= deadline) throw error;
        if (last !== 'offline') console.error('Relay unavailable. Waiting for it to return.');
        last = 'offline';
      }
      await setTimeout(2_000);
    }
  }
} catch (error) {
  const known = error instanceof AgentRelayError || error instanceof LocalError;
  console.error(JSON.stringify({
    code: known ? error.code : 'REVIEW_WATCH_FAILED',
    message: known ? error.message : 'Review watcher could not continue. Check its arguments, local paths, and review record.',
  }));
  process.exitCode = 1;
}
