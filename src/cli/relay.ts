import { parseArgs } from 'node:util';
import { SqliteStore } from '../storage/sqlite-store.ts';
import { startRelay } from '../relay/server.ts';
import { BetaHost, initializeBeta } from '../relay/beta.ts';
import { homePath, readConfig, databasePath, initializeLocal, issueProfile, LocalError } from './local.ts';

try {
  let parsed;
  try { parsed = parseArgs({ allowPositionals: true, options: { home: { type: 'string' }, port: { type: 'string' },
    origin: { type: 'string' }, workspace: { type: 'string' }, repository: { type: 'string' }, participants: { type: 'string' },
    participant: { type: 'string' }, role: { type: 'string' }, profile: { type: 'string' }, id: { type: 'string' }, help: { type: 'boolean' } } }); }
  catch { throw new LocalError('INVALID_ARGUMENTS', 'Invalid relay arguments. Use --help.'); }
  const { values, positionals } = parsed;
  const action = positionals[0];
  if (values.help) {
    console.log('relay init [--home PATH] [--port 8787]\nrelay init --home PATH --origin https://relay.example --workspace ID --repository REPO --participants ALICE,BOB\nrelay start [--home PATH] [--port PORT]\nrelay credential issue --participant bob --role agent --profile bob-agent-v2\nrelay credential revoke --id CREDENTIAL_ID\nrelay invite issue --participant bob [--home PATH]\nrelay invite revoke --id INVITE_ID [--home PATH]\nrelay beta-init --home PATH --origin https://relay.example [--port PORT]\nrelay beta-start --home PATH');
  } else {
    const home = homePath(values.home);
    const numericPort = values.port === undefined ? undefined : /^\d{1,5}$/.test(values.port) ? Number(values.port) : NaN;
    if (action !== 'init' && action !== 'beta-init' && [values.origin, values.workspace, values.repository, values.participants].some(value => value !== undefined)) {
      throw new LocalError('INVALID_ARGUMENTS', 'Workspace and origin options are only available during initialization.');
    }
    if (action === 'beta-init' && positionals.length === 1) {
      if (!values.home || !values.origin || values.workspace || values.repository || values.participants) {
        throw new LocalError('INVALID_ARGUMENTS', 'Use beta-init with an explicit private --home and HTTPS --origin.');
      }
      console.log(JSON.stringify(initializeBeta(home, values.origin, numericPort)));
    } else if (action === 'beta-start' && positionals.length === 1) {
      if (!values.home || values.port !== undefined) throw new LocalError('INVALID_ARGUMENTS', 'Use beta-start with the registered private --home.');
      const beta = new BetaHost(home);
      let relay;
      try { relay = await startRelay(undefined, beta.port, beta.origin, beta); }
      catch { beta.close(); throw new LocalError('START_FAILED', 'Could not start the beta relay. Check its port and private directory.'); }
      console.log(JSON.stringify({ listening: relay.url, workspaceCreated: Boolean(beta.store) }));
      const shutdown = () => { void relay.close().finally(() => beta.close()); };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    } else if (action === 'init' && positionals.length === 1) {
      const { origin, workspace, repository, participants } = values;
      if ([origin, workspace, repository, participants].some(value => value !== undefined)) {
        const people = participants?.split(',') ?? [];
        if (!origin || !workspace || !repository || people.length !== 2 || !people[0] || !people[1]) {
          throw new LocalError('INVALID_ARGUMENTS', 'Hosted initialization requires --origin, --workspace, --repository and --participants ALICE,BOB.');
        }
        console.log(JSON.stringify(initializeLocal(home, numericPort, {
          relayOrigin: origin, workspace: { id: workspace, repository, participants: [people[0], people[1]] },
        }), null, 2));
      } else console.log(JSON.stringify(initializeLocal(home, numericPort), null, 2));
    }
    else if (action === 'start' && positionals.length === 1) {
      const config = readConfig(home);
      const store = new SqliteStore(databasePath(home), config.workspace);
      let relay;
      try { relay = await startRelay(store, numericPort ?? config.port, config.relayOrigin); }
      catch { store.close(); throw new LocalError('START_FAILED', 'Could not start the local relay. Check the configured port and database.'); }
      console.log(JSON.stringify({ listening: relay.url, workspaceId: config.workspace.id }));
      const shutdown = () => { void relay.close().finally(() => store.close()); };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    } else if (action === 'invite' && positionals.length === 2) {
      const config = readConfig(home);
      if (!config.relayOrigin) throw new LocalError('HTTPS_REQUIRED', 'Initialize a hosted workspace before issuing browser invites.');
      const store = new SqliteStore(databasePath(home), config.workspace);
      try {
        if (positionals[1] === 'issue' && values.participant) {
          const { id, token, expiresAt } = store.issueBrowserInvite(values.participant);
          const url = new URL('/workspace/', config.relayOrigin);
          url.hash = 'invite=' + token;
          console.log(JSON.stringify({ id, url: url.href, expiresAt: new Date(expiresAt).toISOString() }));
        } else if (positionals[1] === 'revoke' && values.id) {
          console.log(JSON.stringify({ revoked: store.revokeBrowserAccess(values.id) }));
        } else throw new LocalError('INVALID_ARGUMENTS', 'Use invite issue --participant NAME or invite revoke --id ID.');
      } finally { store.close(); }
    } else if (action === 'credential' && positionals[1] === 'issue' && positionals.length === 2) {
      if (!values.participant || !values.profile || (values.role !== 'human' && values.role !== 'agent')) throw new LocalError('INVALID_ARGUMENTS', 'Provide --participant, --role human|agent, and a new --profile name.');
      issueProfile(home, values.participant, values.role, values.profile);
      console.log(JSON.stringify({ issued: true, profile: values.profile }));
    } else if (action === 'credential' && positionals[1] === 'revoke' && positionals.length === 2 && values.id) {
      const config = readConfig(home);
      const store = new SqliteStore(databasePath(home), config.workspace);
      try { console.log(JSON.stringify({ revoked: store.revokeCredential(values.id) })); } finally { store.close(); }
    } else throw new LocalError('INVALID_ARGUMENTS', 'Unknown relay command. Use --help.');
  }
} catch (error) {
  console.error(JSON.stringify({ error: { code: error instanceof LocalError ? error.code : 'LOCAL_ERROR',
    message: error instanceof LocalError ? error.message : 'Local relay operation failed. Check configuration and database access.' } }));
  process.exitCode = 1;
}
