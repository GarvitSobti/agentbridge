import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homePath, readConfig, loadProfile, listProfiles, configuredEndpoint, LocalError, type Profile } from './profiles.ts';

async function diagnose(response: Response, profile: Profile, name: string, url: URL): Promise<void> {
  if (response.status === 401) {
    throw new LocalError('UNAUTHORIZED', 'The relay rejected this credential. Ask the operator for a current profile for this workspace.');
  }
  if (!response.ok) {
    throw new LocalError('RELAY_UNHEALTHY', 'The configured URL did not return an identity. Check that the relay and HTTPS proxy are running.');
  }
  const data = await response.json().catch(() => null) as { principal?: Partial<Profile> } | null;
  const actor = data?.principal;
  if (actor?.workspaceId !== profile.workspaceId || actor.participantId !== profile.participantId || actor.role !== profile.role) {
    throw new LocalError('PROFILE_IDENTITY_MISMATCH', 'The selected profile identity did not match the relay. Use the original profile supplied by the operator.');
  }
  console.log(JSON.stringify({
    ready: true,
    profile: name,
    relayOrigin: url.origin,
    principal: { workspaceId: actor.workspaceId, participantId: actor.participantId, role: actor.role },
  }, null, 2));
}

let retryKey: string | undefined;
try {
  let parsed;
  try { parsed = parseArgs({ allowPositionals: true, options: { home: { type: 'string' }, profile: { type: 'string' }, url: { type: 'string' },
    to: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, id: { type: 'string' }, version: { type: 'string' },
    after: { type: 'string' }, limit: { type: 'string' }, retry: { type: 'string' }, file: { type: 'string' }, help: { type: 'boolean' } } }); }
  catch { throw new LocalError('INVALID_ARGUMENTS', 'Invalid client arguments. Use --help.'); }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log('bridge --profile NAME request --to bob --title TITLE --body TEXT [--retry KEY]\nbridge --profile NAME whoami\nbridge --profile NAME doctor\nbridge --profile NAME inbox\nbridge --profile NAME get --id REQUEST_ID\nbridge --profile NAME reply --id ID --version N --body TEXT\nbridge --profile NAME accept|decline|start|cancel --id ID --version N\nbridge --profile NAME events [--after N] [--limit N]\nbridge --profile NAME command --file COMMAND.json\nbridge profiles\nOptions: --home PATH, --url http://127.0.0.1:PORT');
  } else {
    if (positionals.length !== 1) throw new LocalError('INVALID_ARGUMENTS', 'Choose one client command. Use --help.');
    const action = positionals[0];
    const home = homePath(values.home);
    if (action === 'profiles') console.log(JSON.stringify({ profiles: listProfiles(home) }, null, 2));
    else {
      if (!values.profile) throw new LocalError('PROFILE_REQUIRED', 'Choose an explicit --profile; credentials are never selected automatically.');
      const config = readConfig(home);
      const profile = loadProfile(home, values.profile);
      const url = configuredEndpoint(config, profile, values.url);
      const integer = (value: string | undefined, label: string, minimum = 1): number => {
        if (value === undefined || !/^\d{1,16}$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) {
          throw new LocalError('INVALID_ARGUMENTS', `Provide a valid --${label}.`);
        }
        return Number(value);
      };
      let route: string;
      let command: Record<string, unknown> | undefined;
      if (action === 'inbox') route = '/v1/inbox';
      else if (action === 'whoami' || action === 'doctor') route = '/v1/identity';
      else if (action === 'get' && values.id) route = '/v1/requests/' + encodeURIComponent(values.id);
      else if (action === 'events') route = `/v1/events?after=${integer(values.after ?? '0', 'after', 0)}&limit=${integer(values.limit ?? '100', 'limit')}`;
      else if (action === 'request') {
        route = '/v1/commands';
        command = { type: 'request.create', recipientId: values.to, title: values.title, body: values.body };
      } else if (['reply', 'accept', 'decline', 'start', 'cancel'].includes(action ?? '')) {
        if (!values.id) throw new LocalError('INVALID_ARGUMENTS', 'Provide --id and the current --version after inspecting the request.');
        route = '/v1/commands';
        command = { type: 'request.' + action, requestId: values.id, expectedVersion: integer(values.version, 'version'),
          ...(action === 'reply' ? { body: values.body } : {}) };
      } else if (action === 'command' && values.file) {
        route = '/v1/commands';
        try {
          if (!fs.statSync(values.file).isFile() || fs.statSync(values.file).size > 64 * 1024) throw Error('Invalid file');
          const value: unknown = JSON.parse(fs.readFileSync(values.file, 'utf8'));
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid command');
          command = value as Record<string, unknown>;
        } catch { throw new LocalError('INVALID_COMMAND_FILE', 'Provide a JSON command object no larger than 64 KiB.'); }
      } else throw new LocalError('INVALID_ARGUMENTS', 'Unknown or incomplete client command. Use --help.');
      if (command) {
        const fileKey = command.retryKey;
        if (fileKey !== undefined && typeof fileKey !== 'string') throw new LocalError('INVALID_ARGUMENTS', 'The command retryKey must be text.');
        retryKey = values.retry ?? (fileKey as string | undefined) ?? randomUUID();
        command.retryKey = retryKey;
      }
      let response: Response;
      try {
        response = await fetch(new URL(route, url), { method: command ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
          headers: { authorization: 'Bearer ' + profile.token, ...(command ? { 'content-type': 'application/json' } : {}) },
          ...(command ? { body: JSON.stringify(command) } : {}) });
      } catch {
        const message = action === 'doctor'
          ? 'Could not reach the configured relay. Check the local relay or confirm the registered HTTPS URL with the operator.'
          : 'Could not reach the relay. For an uncertain write, retry the same command with the reported retryKey.';
        throw new LocalError('NETWORK_ERROR', message);
      }
      if (action === 'doctor') await diagnose(response, profile, values.profile, url);
      else {
        const data: unknown = await response.json();
        if (!response.ok) {
          console.error(JSON.stringify({ ...(data as object), ...(retryKey ? { retryKey } : {}) }, null, 2));
          process.exitCode = 1;
        } else console.log(JSON.stringify({ ...(data as object), ...(retryKey ? { retryKey } : {}) }, null, 2));
      }
    }
  }
} catch (error) {
  console.error(JSON.stringify({ error: { code: error instanceof LocalError ? error.code : 'LOCAL_ERROR',
    message: error instanceof LocalError ? error.message : 'Client operation failed; check the local relay and profile configuration.' },
    ...(retryKey ? { retryKey } : {}) }));
  process.exitCode = 1;
}
