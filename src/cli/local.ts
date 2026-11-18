import fs from 'node:fs';
import path from 'node:path';
import type { Role, Workspace } from '../domain/types.ts';
import { SqliteStore } from '../storage/sqlite-store.ts';
import { homePath, readConfig, databasePath, profileName, loadProfile, listProfiles, LocalError, type Profile, type LocalConfig } from './profiles.ts';
export * from './profiles.ts';

const defaultWorkspace: Workspace = { id: 'local-demo', repository: 'local://agentbridge-demo', participants: ['alice', 'bob'] };
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
