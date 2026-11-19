import fs from 'node:fs';
import path from 'node:path';
import type { Role, Workspace } from '../domain/types.ts';
import { createBoard } from '../domain/board.ts';
import { SqliteStore } from '../storage/sqlite-store.ts';
import { homePath, readConfig, databasePath, profileName, loadProfile, listProfiles, LocalError, httpsOrigin, type Profile, type LocalConfig } from './profiles.ts';
export * from './profiles.ts';

const defaultWorkspace: Workspace = { id: 'local-demo', repository: 'local://agentbridge-demo', participants: ['alice', 'bob'] };
function writeProfile(store: SqliteStore, home: string, participant: string, role: Role, name: string, relayOrigin?: string): void {
  profileName(name);
  if (['agents', 'humans'].some(directory => fs.existsSync(path.join(home, directory, name + '.json')))) {
    throw new LocalError('PROFILE_EXISTS', 'A profile with that name already exists; use a new name when issuing another credential.');
  }
  const folder = path.join(home, role === 'human' ? 'humans' : 'agents');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const issued = store.issueCredential(participant, role);
  const profile: Profile = { version: 1, credentialId: issued.id, ...issued.principal, token: issued.token, ...(relayOrigin === undefined ? {} : { relayOrigin }) };
  try { fs.writeFileSync(path.join(folder, name + '.json'), JSON.stringify(profile, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch {
    store.revokeCredential(issued.id);
    throw new LocalError('PROFILE_WRITE_FAILED', 'Credential profile could not be written; its newly issued credential was revoked.');
  }
}
export function initializeLocal(home: string, port = 8787, options: { workspace?: Workspace; relayOrigin?: string } = {}): { initialized: boolean; home: string; profiles: ReturnType<typeof listProfiles> } {
  const root = homePath(home);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new LocalError('INVALID_PORT', 'Use a port from 1 through 65535.');
  const relayOrigin = options.relayOrigin === undefined ? undefined : httpsOrigin(options.relayOrigin);
  let workspace: Workspace;
  try { workspace = createBoard(options.workspace ?? defaultWorkspace).workspace; }
  catch { throw new LocalError('INVALID_WORKSPACE', 'Provide a repository and two distinct participant identifiers.'); }
  for (const participant of workspace.participants) profileName(participant + '-human');
  if (fs.existsSync(path.join(root, 'server.json'))) {
    const current = readConfig(root);
    if ((options.workspace && JSON.stringify(workspace) !== JSON.stringify(current.workspace)) ||
        (options.relayOrigin !== undefined && relayOrigin !== current.relayOrigin)) {
      throw new LocalError('WORKSPACE_CONFIG_CONFLICT', 'Use a new private directory to initialize a different workspace or relay origin.');
    }
    return { initialized: false, home: root, profiles: listProfiles(root) };
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  homePath(root); // Resolve again after creation to catch a symlinked parent into the checkout.
  const store = new SqliteStore(databasePath(root), workspace);
  try {
    for (const participant of workspace.participants) for (const role of ['agent', 'human'] as const) {
      const name = `${participant}-${role}`;
      if (['agents', 'humans'].some(folder => fs.existsSync(path.join(root, folder, name + '.json')))) {
        const profile = loadProfile(root, name);
        const principal = store.authenticate(profile.token);
        if (!principal || principal.participantId !== participant || principal.role !== role || profile.relayOrigin !== relayOrigin) {
          throw new LocalError('PROFILE_CONFLICT', 'An existing profile is invalid or revoked. Initialization will not replace it.');
        }
      } else writeProfile(store, root, participant, role, name, relayOrigin);
    }
    const config: LocalConfig = { version: 1, workspace, port, ...(relayOrigin === undefined ? {} : { relayOrigin }) };
    fs.writeFileSync(path.join(root, 'server.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } finally { store.close(); }
  return { initialized: true, home: root, profiles: listProfiles(root) };
}
export function issueProfile(home: string, participant: string, role: Role, name: string): void {
  const config = readConfig(home);
  const store = new SqliteStore(databasePath(home), config.workspace);
  try { writeProfile(store, homePath(home), participant, role, name, config.relayOrigin); } finally { store.close(); }
}
