import { parseArgs } from 'node:util';
import { SqliteStore } from '../storage/sqlite-store.ts';
import { startRelay } from '../relay/server.ts';
import { homePath, readConfig, databasePath, initializeLocal, issueProfile, LocalError } from './local.ts';

try {
  let parsed;
  try { parsed = parseArgs({ allowPositionals: true, options: { home: { type: 'string' }, port: { type: 'string' },
    participant: { type: 'string' }, role: { type: 'string' }, profile: { type: 'string' }, id: { type: 'string' }, help: { type: 'boolean' } } }); }
  catch { throw new LocalError('INVALID_ARGUMENTS', 'Invalid relay arguments. Use --help.'); }
  const { values, positionals } = parsed;
  const action = positionals[0];
  if (values.help) {
    console.log('relay init [--home PATH] [--port 8787]\nrelay start [--home PATH] [--port PORT]\nrelay credential issue --participant bob --role agent --profile bob-agent-v2\nrelay credential revoke --id CREDENTIAL_ID');
  } else {
    const home = homePath(values.home);
    const numericPort = values.port === undefined ? undefined : /^\d{1,5}$/.test(values.port) ? Number(values.port) : NaN;
    if (action === 'init' && positionals.length === 1) console.log(JSON.stringify(initializeLocal(home, numericPort), null, 2));
    else if (action === 'start' && positionals.length === 1) {
      const config = readConfig(home);
      const store = new SqliteStore(databasePath(home), config.workspace);
      let relay;
      try { relay = await startRelay(store, numericPort ?? config.port); }
      catch { store.close(); throw new LocalError('START_FAILED', 'Could not start the local relay. Check the configured port and database.'); }
      console.log(JSON.stringify({ listening: relay.url, workspaceId: config.workspace.id }));
      const shutdown = () => { void relay.close().finally(() => store.close()); };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
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
