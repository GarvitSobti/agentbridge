import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { homePath, loadProfile, loadAgentProfile } from '../src/cli/local.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbridge-cli-test-'));
  const home = path.join(directory, 'private');
  let server;
  let url;
  const run = (entry, args) => new Promise(resolve => execFile(process.execPath, [path.join(root, entry), '--home', home, ...args],
    { cwd: root, timeout: 8_000, env: { ...process.env, AGENTBRIDGE_HOME: home } }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code ?? 1 : 0, stdout, stderr, data: stdout.trim() ? JSON.parse(stdout) : undefined });
    }));
  async function stop() {
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const exited = once(server, 'exit');
    server.kill();
    const timer = setTimeout(() => server.kill('SIGKILL'), 2_000).unref();
    await exited; clearTimeout(timer);
  }
  t.after(async () => {
    await stop();
    const absolute = fs.realpathSync(directory);
    if (path.dirname(absolute) !== fs.realpathSync(os.tmpdir()) || !path.basename(absolute).startsWith('agentbridge-cli-test-')) throw Error('Unsafe test cleanup');
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  const initial = await run('src/cli/relay.ts', ['init']);
  assert.equal(initial.code, 0, initial.stderr);
  async function start() {
    server = spawn(process.execPath, [path.join(root, 'src/cli/relay.ts'), 'start', '--home', home, '--port', '0'],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    url = await new Promise((resolve, reject) => {
      let output = '';
      server.once('error', reject);
      server.once('exit', () => reject(Error('Relay process exited before listening')));
      server.stdout.on('data', bytes => {
        output += bytes;
        if (output.includes('\n')) { try { resolve(JSON.parse(output.split('\n')[0]).listening); } catch (error) { reject(error); } }
      });
    });
  }
  return { home, initial, run, start, stop,
    client(profile, ...args) { return run('src/cli/bridge.ts', ['--url', url, '--profile', profile, ...args]); } };
}

test('initialization creates private separate profiles, is idempotent, and never prints tokens', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  assert.equal(f.initial.data.initialized, true);
  assert.equal(f.initial.data.profiles.length, 4);
  const first = loadProfile(f.home, 'bob-agent');
  assert.ok(!f.initial.stdout.includes(first.token));
  assert.ok(!f.initial.stderr.includes(first.token));
  assert.equal(fs.existsSync(path.join(f.home, 'agents', 'bob-agent.json')), true);
  assert.equal(fs.existsSync(path.join(f.home, 'humans', 'bob-human.json')), true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(f.home, 'humans', 'bob-human.json')).mode & 0o077, 0);
  const second = await f.run('src/cli/relay.ts', ['init']);
  assert.equal(second.data.initialized, false);
  assert.equal(loadProfile(f.home, 'bob-agent').credentialId, first.credentialId);
  assert.throws(() => loadAgentProfile(f.home, 'bob-human'), error => error.code === 'AGENT_PROFILE_REQUIRED');
  assert.throws(() => homePath(root), error => error.code === 'PRIVATE_HOME_REQUIRED');
  assert.throws(() => loadProfile(f.home, '../bob-human'), error => error.code === 'INVALID_PROFILE');
});

test('real relay process and separate CLI processes exchange, approve, and start a task', { timeout: 25_000 }, async t => {
  const f = await fixture(t); await f.start();
  const created = await f.client('alice-agent', 'request', '--to', 'bob', '--title', 'Expose severity', '--body', 'Task creation needs severity.', '--retry', 'cli-create');
  assert.equal(created.code, 0, created.stderr);
  const id = created.data.request.id;
  const inbox = await f.client('bob-agent', 'inbox');
  assert.equal(inbox.data.requests[0].id, id);
  const denied = await f.client('bob-agent', 'accept', '--id', id, '--version', '1');
  assert.equal(denied.code, 1);
  assert.ok(denied.stderr.includes('FORBIDDEN'));
  const reply = await f.client('bob-agent', 'reply', '--id', id, '--version', '1', '--body', 'Severity will be a string enum.');
  assert.equal(reply.data.request.version, 2);
  const accepted = await f.client('bob-human', 'accept', '--id', id, '--version', '2');
  assert.equal(accepted.data.request.status, 'accepted');
  const started = await f.client('bob-agent', 'start', '--id', id, '--version', '3');
  assert.equal(started.data.request.status, 'in_progress');
  const replay = await f.client('alice-agent', 'request', '--to', 'bob', '--title', 'Expose severity', '--body', 'Task creation needs severity.', '--retry', 'cli-create');
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.request.status, 'pending');
  const current = await f.client('alice-agent', 'get', '--id', id);
  assert.equal(current.data.request.status, 'in_progress');
  await f.stop(); await f.start();
  const restored = await f.client('bob-agent', 'get', '--id', id);
  assert.equal(restored.data.request.status, 'in_progress');
  assert.equal((await f.client('bob-agent', 'events', '--after', '1')).data.events.length, 3);
});

test('client refuses nonlocal URLs and operator revocation persists across setup and restart', { timeout: 25_000 }, async t => {
  const f = await fixture(t); await f.start();
  const profile = loadProfile(f.home, 'alice-agent');
  const invalid = await f.run('src/cli/bridge.ts', ['--profile', 'alice-agent', '--url', 'https://example.com', 'inbox']);
  assert.equal(invalid.code, 1);
  assert.ok(invalid.stderr.includes('INVALID_URL'));
  assert.ok(!invalid.stderr.includes(profile.token));
  const revoked = await f.run('src/cli/relay.ts', ['credential', 'revoke', '--id', profile.credentialId]);
  assert.equal(revoked.data.revoked, true);
  assert.equal((await f.client('alice-agent', 'inbox')).code, 1);
  await f.run('src/cli/relay.ts', ['init']);
  await f.stop(); await f.start();
  const denied = await f.client('alice-agent', 'inbox');
  assert.ok(denied.stderr.includes('UNAUTHORIZED'));
  const issued = await f.run('src/cli/relay.ts', ['credential', 'issue', '--participant', 'alice', '--role', 'agent', '--profile', 'alice-agent-v2']);
  assert.equal(issued.data.issued, true);
  assert.equal((await f.client('alice-agent-v2', 'whoami')).data.principal.role, 'agent');
  const profiles = await f.run('src/cli/bridge.ts', ['profiles']);
  assert.ok(profiles.data.profiles.every(p => !('token' in p)));
  assert.ok(!profiles.stdout.includes(loadProfile(f.home, 'alice-agent-v2').token));
});

test('raw JSON commands are validated by the relay and profile metadata cannot change token identity', { timeout: 20_000 }, async t => {
  const f = await fixture(t); await f.start();
  const filename = path.join(f.home, 'task.json');
  fs.writeFileSync(filename, JSON.stringify({ type: 'request.create', recipientId: 'bob', title: 'Generic request', body: 'Used by future adapters', role: 'human' }));
  const rejected = await f.client('alice-agent', 'command', '--file', filename);
  assert.equal(rejected.code, 1); assert.ok(rejected.stderr.includes('INVALID_INPUT'));
  const profilePath = path.join(f.home, 'agents', 'bob-agent.json');
  const profile = JSON.parse(fs.readFileSync(profilePath));
  profile.role = 'human'; fs.writeFileSync(profilePath, JSON.stringify(profile));
  const actual = await f.client('bob-agent', 'whoami');
  assert.equal(actual.data.principal.role, 'agent');
});
