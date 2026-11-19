import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { homePath, readConfig, loadAgentProfile, configuredEndpoint, LocalError } from '../cli/profiles.ts';
import { AgentRelayClient, AgentRelayError } from './relay-client.ts';
import { createAgentServer } from './server.ts';

try {
  let parsed;
  try { parsed = parseArgs({ options: { profile: { type: 'string' }, home: { type: 'string' }, url: { type: 'string' } } }); }
  catch { throw new LocalError('INVALID_ARGUMENTS', 'Provide --profile NAME and optional --home PATH / --url http://127.0.0.1:PORT.'); }
  const { values } = parsed;
  if (!values.profile) throw new LocalError('AGENT_PROFILE_REQUIRED', 'Select an explicit agent --profile.');
  const home = homePath(values.home);
  const config = readConfig(home);
  const profile = loadAgentProfile(home, values.profile);
  const relay = new AgentRelayClient(configuredEndpoint(config, profile, values.url).href, profile);
  const server = await createAgentServer(relay);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const shutdown = () => { void server.close(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  // stdout belongs exclusively to the MCP SDK. Never print arguments, profiles, tokens, or raw causes.
  console.error(JSON.stringify({ error: { code: error instanceof AgentRelayError || error instanceof LocalError ? error.code : 'ADAPTER_START_FAILED',
    message: error instanceof AgentRelayError || error instanceof LocalError ? error.message : 'Could not start the Agent Bridge MCP adapter.' } }));
  process.exitCode = 1;
}
