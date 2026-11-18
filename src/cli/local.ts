import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createBoard } from '../domain/board.ts';
import type { Role, Workspace } from '../domain/types.ts';
import { SqliteStore } from '../storage/sqlite-store.ts';

export class LocalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export interface LocalConfig { version: 1; workspace: Workspace; port: number }
export interface Profile {
  version: 1;
  credentialId: string;
  workspaceId: string;
  participantId: string;
  role: Role;
  token: string;
}
const repositoryRoot = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const defaultWorkspace: Workspace = { id: 'local-demo', repository: 'local://agentbridge-demo', participants: ['alice', 'bob'] };
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
  return { version: 1, workspace, port: value.port! };
}
export function databasePath(home: string): string { return path.join(homePath(home), 'state.db'); }
function profileName(value: string): string {
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
  return value as Profile;
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
function writeProfile(store: SqliteStore, home: string, participant: string, role: Role, name: string): void {
  profileName(name);
  if (['agents', 'humans'].some(directory => fs.existsSync(path.join(home, directory, name + '.json')))) {
    throw new LocalError('PROFILE_EXISTS', 'A profile with that name already exists; use a new name when issuing another credential.');
  }
  const folder = path.join(home, role === 'human' ? 'humans' : 'agents');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const issued = store.issueCredential(participant, role);
  const profile: Profile = { version: 1, credentialId: issued.id, ...issued.principal, token: issued.token };
  try { fs.writeFileSync(path.join(folder, name + '.json'), JSON.stringify(profile, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch {
    store.revokeCredential(issued.id);
    throw new LocalError('PROFILE_WRITE_FAILED', 'Credential profile could not be written; its newly issued credential was revoked.');
  }
}
export function initializeLocal(home: string, port = 8787): { initialized: boolean; home: string; profiles: ReturnType<typeof listProfiles> } {
  const root = homePath(home);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new LocalError('INVALID_PORT', 'Use a port from 1 through 65535.');
  if (fs.existsSync(path.join(root, 'server.json'))) {
    readConfig(root);
    return { initialized: false, home: root, profiles: listProfiles(root) };
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  homePath(root); // Resolve again after creation to catch a symlinked parent into the checkout.
  const store = new SqliteStore(databasePath(root), defaultWorkspace);
  try {
    for (const participant of defaultWorkspace.participants) for (const role of ['agent', 'human'] as const) {
      const name = `${participant}-${role}`;
      if (['agents', 'humans'].some(folder => fs.existsSync(path.join(root, folder, name + '.json')))) {
        const profile = loadProfile(root, name);
        const principal = store.authenticate(profile.token);
        if (!principal || principal.participantId !== participant || principal.role !== role) {
          throw new LocalError('PROFILE_CONFLICT', 'An existing profile is invalid or revoked. Initialization will not replace it.');
        }
      } else writeProfile(store, root, participant, role, name);
    }
    const config: LocalConfig = { version: 1, workspace: defaultWorkspace, port };
    fs.writeFileSync(path.join(root, 'server.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } finally { store.close(); }
  return { initialized: true, home: root, profiles: listProfiles(root) };
}
export function issueProfile(home: string, participant: string, role: Role, name: string): void {
  const config = readConfig(home);
  const store = new SqliteStore(databasePath(home), config.workspace);
  try { writeProfile(store, homePath(home), participant, role, name); } finally { store.close(); }
}
