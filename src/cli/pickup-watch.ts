import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { AgentRelayClient, AgentRelayError } from '../mcp/relay-client.ts';
import { configuredEndpoint, homePath, loadAgentProfile, LocalError, readConfig } from './profiles.ts';
import { editWithClaude, runApprovedPickup, verifyPickupRepo } from '../pickup/runner.ts';

const usage = 'npm run pickup:watch -- --home PATH --profile NAME --repo PATH [--once]';
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());

try {
  const { values } = parseArgs({ options: {
    home: { type: 'string' }, profile: { type: 'string' }, repo: { type: 'string' },
    once: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) console.log(usage);
  else {
    if (!values.home || !values.profile || !values.repo) throw new LocalError('INVALID_ARGUMENTS', usage);
    const home = homePath(values.home);
    const profile = loadAgentProfile(home, values.profile);
    const config = readConfig(home);
    const relay = new AgentRelayClient(configuredEndpoint(config, profile).href, profile);
    const stateDirectory = path.join(home, 'pickups');
    await verifyPickupRepo(values.repo, config.workspace.repository, stateDirectory);
    try {
      const version = execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 8_000, stdio: ['ignore', 'pipe', 'ignore'] });
      const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
      const major = Number(match?.[1]);
      const minor = Number(match?.[2]);
      const patch = Number(match?.[3]);
      if (!match || major < 2 || (major === 2 && (minor < 1 || (minor === 1 && patch < 248)))) throw new Error('Unsupported Claude Code');
    } catch {
      throw new LocalError('CLAUDE_UNAVAILABLE', 'Install and sign in to Claude Code 2.1.248 or later, and ensure claude is on PATH.');
    }

    console.error('Waiting for one prompt approved for ' + profile.participantId + '. Keep this local runner open.');
    const deadline = Date.now() + 30 * 60_000;
    while (!stop.signal.aborted) {
      try {
        const result = await runApprovedPickup({
          relay, repository: values.repo, expectedRepository: config.workspace.repository,
          stateDirectory, signal: stop.signal, edit: (prompt, checkout) => editWithClaude(prompt, checkout, stop.signal),
        });
        if (result.status !== 'waiting' || values.once || Date.now() >= deadline) {
          console.log(JSON.stringify(result, null, 2));
          if (result.status === 'needs_attention') process.exitCode = 1;
          break;
        }
      } catch (error) {
        if (!(error instanceof AgentRelayError) || error.code !== 'RELAY_UNAVAILABLE' || values.once || Date.now() >= deadline) throw error;
      }
      await setTimeout(2500, undefined, { signal: stop.signal });
    }
  }
} catch (error) {
  if (!stop.signal.aborted) {
    const known = error instanceof LocalError || error instanceof AgentRelayError;
    console.error(JSON.stringify({ code: known ? error.code : 'PICKUP_FAILED',
      message: known ? error.message : 'Check the selected Git checkout, assistant installation, and paired profile.' }));
    process.exitCode = 1;
  }
}
