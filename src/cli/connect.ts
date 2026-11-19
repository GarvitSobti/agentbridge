import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';
import { createBoard } from '../domain/board.ts';
import { homePath, httpsOrigin, LocalError, type LocalConfig, type Profile } from './profiles.ts';
import { AgentRelayClient } from '../mcp/relay-client.ts';

const run = promisify(execFile);
const resultSchema = z.object({
  id: z.uuid(),
  principal: z.object({ workspaceId: z.string(), participantId: z.string(), role: z.literal('agent') }),
  workspace: z.unknown(),
  relayOrigin: z.string(),
});

async function exchange(origin: string, code: string, tokenHash: string) {
  const send = () => fetch(new URL('/v1/pair', origin), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8_000),
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, tokenHash }),
  });
  // Repeat the same code and hash once when the response may have been lost.
  const response = await send().catch(() => send()).catch(() => {
    throw new LocalError('RELAY_UNAVAILABLE', 'Could not reach the registered relay. Check the URL and generate a new code if needed.');
  });
  if (response.status === 401) throw new LocalError('PAIR_CODE_INVALID', 'Generate a new pairing code in the workspace inbox.');
  if (!response.ok) throw new LocalError('PAIR_FAILED', 'The relay could not pair this agent.');
  const result = resultSchema.safeParse(await response.json().catch(() => null));
  if (!result.success || result.data.relayOrigin !== origin) throw new LocalError('PAIR_RESPONSE_INVALID', 'The relay returned invalid pairing details.');
  return result.data;
}

function quote(value: string): string {
  return "'" + value.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''") + "'";
}

try {
  const { values } = parseArgs({ options: {
    origin: { type: 'string' }, client: { type: 'string' }, home: { type: 'string' }, 'profile-only': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('npm run connect -- --origin HTTPS_ORIGIN --client codex|claude [--home PATH] [--profile-only]');
  } else {
    if (!values.origin || (values.client !== 'codex' && values.client !== 'claude')) {
      throw new LocalError('INVALID_ARGUMENTS', 'Choose the HTTPS origin and --client codex or claude.');
    }
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
      throw new LocalError('TLS_REQUIRED', 'Enable TLS certificate verification before pairing.');
    }
    const origin = httpsOrigin(values.origin);
    const base = homePath(values.home ?? path.join(os.homedir(), '.agentbridge'));
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    homePath(base);

    const input = createInterface({ input: process.stdin, output: process.stderr });
    let code: string;
    try { code = (await input.question('Paste the code from Agent Bridge: ')).trim(); }
    finally { input.close(); }
    if (!/^abp_[A-Za-z0-9_-]{43}$/.test(code)) throw new LocalError('PAIR_CODE_INVALID', 'Copy the whole pairing code from the inbox.');

    const token = 'ab_' + randomBytes(32).toString('base64url');
    const paired = await exchange(origin, code, createHash('sha256').update(token).digest('hex'));
    const workspace = createBoard(paired.workspace).workspace;
    const principal = paired.principal;
    if (workspace.id !== principal.workspaceId || !workspace.participants.includes(principal.participantId)) {
      throw new LocalError('PAIR_RESPONSE_INVALID', 'The returned agent does not match the workspace.');
    }
    const profile: Profile = { version: 1, credentialId: paired.id, ...principal, token, relayOrigin: origin };
    await new AgentRelayClient(origin, profile).identity();

    const home = fs.mkdtempSync(path.join(base, 'paired-'));
    const agents = path.join(home, 'agents');
    const name = 'paired-agent';
    const config: LocalConfig = { version: 1, workspace, port: 8787, relayOrigin: origin };
    fs.mkdirSync(agents, { mode: 0o700 });
    fs.writeFileSync(path.join(home, 'server.json'), JSON.stringify(config), { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(agents, name + '.json'), JSON.stringify(profile), { mode: 0o600, flag: 'wx' });

    const adapter = fileURLToPath(new URL('../mcp/stdio.ts', import.meta.url));
    const serverName = 'agentbridge-' + paired.id.slice(0, 8);
    const assistant = values.client;
    const launcher = assistant === 'codex' ? ['mcp', 'add', serverName] : ['mcp', 'add', '--transport', 'stdio', '--scope', 'user', serverName];
    const args = [...launcher, '--', process.execPath, adapter, '--home', home, '--profile', name];
    let registered = false;
    if (!values['profile-only']) {
      try {
        await run(assistant, args, { timeout: 15_000, windowsHide: true });
        registered = true;
      } catch { /* The paired profile remains usable with the printed registration command. */ }
    }
    const registrationCommand = assistant + ' ' + args.map(quote).join(' ');
    if (!registered && !values['profile-only']) console.error('To finish assistant setup, run this command:\n' + registrationCommand);
    console.log(JSON.stringify({
      paired: true, principal, relayOrigin: origin, home, profile: name, registered, serverName,
      ...(!registered ? { registrationCommand } : {}),
    }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ error: {
    code: error instanceof LocalError ? error.code : 'CONNECT_FAILED',
    message: error instanceof LocalError ? error.message : 'Agent setup failed. Check Node, your private directory and the relay, then generate a new code.',
  } }));
  process.exitCode = 1;
}
