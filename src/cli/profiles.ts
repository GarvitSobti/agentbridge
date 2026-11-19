import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createBoard } from '../domain/board.ts';
import type { Role, Workspace } from '../domain/types.ts';

export class LocalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export interface LocalConfig { version: 1; workspace: Workspace; port: number; relayOrigin?: string }
export interface Profile {
  version: 1;
  credentialId: string;
  workspaceId: string;
  participantId: string;
  role: Role;
  token: string;
  relayOrigin?: string;
}
function baseURL(value: string): URL {
  if (typeof value !== 'string') throw new LocalError('INVALID_URL', 'Provide a relay origin.');
  try {
    const url = new URL(value);
    if (url.hostname && url.href === url.origin + '/') return url;
  } catch { /* Fall through to the redacted error. */ }
  throw new LocalError('INVALID_URL', 'Use a relay origin without credentials, a path, a query, or a fragment.');
}
export function httpsOrigin(value: string): string {
  const url = baseURL(value);
  if (url.protocol !== 'https:') throw new LocalError('INVALID_URL', 'A remote relay requires HTTPS.');
  return url.origin;
}
export function relayEndpoint(value: string, pinnedOrigin?: string): URL {
  const url = baseURL(value);
  if (pinnedOrigin !== undefined && url.origin === httpsOrigin(pinnedOrigin)) return url;
  if (pinnedOrigin === undefined && url.protocol === 'http:' && url.hostname === '127.0.0.1') return url;
  throw new LocalError('INVALID_URL', 'Use the profile\'s registered HTTPS relay or, for a local profile, http://127.0.0.1:PORT.');
}
export function configuredEndpoint(config: LocalConfig, profile: Profile, override?: string): URL {
  if (config.workspace.id !== profile.workspaceId || config.relayOrigin !== profile.relayOrigin) {
    throw new LocalError('PROFILE_CONFIG_MISMATCH', 'The selected profile does not match this workspace and relay configuration.');
  }
  return relayEndpoint(override ?? config.relayOrigin ?? `http://127.0.0.1:${config.port}`, profile.relayOrigin);
}
const repositoryRoot = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
export function homePath(value = process.env.AGENTBRIDGE_HOME ?? path.join(os.homedir(), '.agentbridge', 'local-demo')): string {
  const absolute = path.resolve(value);
  const check = fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute;
  const relative = path.relative(repositoryRoot, check);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new LocalError('PRIVATE_HOME_REQUIRED', 'Keep relay data and credentials outside the repository checkout.');
  }
  if (fs.existsSync(absolute)) {
    const info = fs.statSync(absolute);
    if (!info.isDirectory() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) {
      throw new LocalError('PRIVATE_HOME_REQUIRED', 'Use an owner-only relay directory (mode 700 on Unix).');
    }
  }
  return absolute;
}
function readJSON(filename: string): unknown {
  try {
    const info = fs.lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8_192) throw Error('Invalid local file');
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw Error('Local file must be owner-only');
    return JSON.parse(fs.readFileSync(filename, 'utf8')) as unknown;
  } catch { throw new LocalError('INVALID_LOCAL_FILE', 'Local configuration is missing, invalid, or not private. Run relay:init or check owner-only file permissions.'); }
}
export function readConfig(home: string): LocalConfig {
  const value = readJSON(path.join(homePath(home), 'server.json')) as Partial<LocalConfig> | null;
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.port) || value.port! < 1 || value.port! > 65535) {
    throw new LocalError('INVALID_CONFIG', 'The local relay configuration is invalid.');
  }
  let workspace: Workspace;
  try { workspace = createBoard(value.workspace).workspace; }
  catch { throw new LocalError('INVALID_CONFIG', 'The local workspace configuration is invalid.'); }
  const relayOrigin = value.relayOrigin === undefined ? undefined : httpsOrigin(value.relayOrigin);
  return { version: 1, workspace, port: value.port!, ...(relayOrigin === undefined ? {} : { relayOrigin }) };
}
export function databasePath(home: string): string { return path.join(homePath(home), 'state.db'); }
export function profileName(value: string): string {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(value)) throw new LocalError('INVALID_PROFILE', 'Use a lowercase profile name containing letters, digits, or hyphens.');
  return value;
}
export function loadProfile(home: string, name: string): Profile {
  const root = homePath(home);
  const matches = ['agents', 'humans'].map(folder => path.join(root, folder, profileName(name) + '.json')).filter(filename => fs.existsSync(filename));
  if (matches.length !== 1) throw new LocalError('INVALID_PROFILE', 'Profile is missing or ambiguous. Run bridge profiles to inspect local profiles.');
  const value = readJSON(matches[0]!) as Partial<Profile> | null;
  if (!value || value.version !== 1 || typeof value.credentialId !== 'string' || typeof value.workspaceId !== 'string'
    || typeof value.participantId !== 'string' || (value.role !== 'human' && value.role !== 'agent')
    || typeof value.token !== 'string' || !/^ab_[A-Za-z0-9_-]{43}$/.test(value.token)) {
    throw new LocalError('INVALID_PROFILE', 'The selected credential profile is invalid.');
  }
  if (value.relayOrigin === undefined) return value as Profile;
  return { ...value as Profile, relayOrigin: httpsOrigin(value.relayOrigin) };
}
export function loadAgentProfile(home: string, name: string): Profile {
  const profile = loadProfile(home, name);
  if (profile.role !== 'agent') throw new LocalError('AGENT_PROFILE_REQUIRED', 'Assistant adapters may load only an agent profile.');
  return profile;
}
export function listProfiles(home: string): Array<Omit<Profile, 'token' | 'version'> & { name: string }> {
  const root = homePath(home);
  const result = [];
  for (const directory of ['agents', 'humans']) {
    const folder = path.join(root, directory);
    if (!fs.existsSync(folder)) continue;
    for (const filename of fs.readdirSync(folder).filter(name => name.endsWith('.json')).sort()) {
      const name = filename.slice(0, -5);
      const { token: _token, version: _version, ...metadata } = loadProfile(root, name);
      result.push({ name, ...metadata });
    }
  }
  return result;
}
