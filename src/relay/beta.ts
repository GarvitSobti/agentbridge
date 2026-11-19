import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createBoard } from '../domain/board.ts';
import { databasePath, homePath, httpsOrigin, LocalError, readConfig, type LocalConfig } from '../cli/profiles.ts';
import { SqliteStore } from '../storage/sqlite-store.ts';
import { HttpError } from './http.ts';

interface BetaConfig { origin: string; port: number }
const privateFile = { mode: 0o600, flag: 'wx' } as const;

function readBeta(home: string): BetaConfig {
  try {
    const { origin, port } = JSON.parse(fs.readFileSync(path.join(home, 'beta.json'), 'utf8')) as BetaConfig;
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
    return { origin: httpsOrigin(origin), port };
  } catch {
    throw new LocalError('BETA_CONFIG_REQUIRED', 'Initialize this private directory with npm run beta:init.');
  }
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function initializeBeta(directory: string, origin: string, port?: number) {
  const home = homePath(directory);
  const canonical = httpsOrigin(origin);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  homePath(home);
  if (fs.existsSync(path.join(home, 'server.json'))) throw new LocalError('BETA_HOME_CONFLICT', 'Use a private directory dedicated to this beta deployment.');
  if (fs.existsSync(path.join(home, 'workspace'))) {
    throw new LocalError('WORKSPACE_EXISTS', 'The workspace is already active. Use the existing operator invite command to restore access.');
  }
  const configFile = path.join(home, 'beta.json');
  if (fs.existsSync(configFile)) {
    const saved = readBeta(home);
    if (saved.origin !== canonical || (port !== undefined && saved.port !== port)) {
      throw new LocalError('BETA_CONFIG_CONFLICT', 'Use the origin and port already registered for this beta directory.');
    }
  } else {
    const listenPort = port ?? 8787;
    if (!Number.isSafeInteger(listenPort) || listenPort < 1 || listenPort > 65535) throw new LocalError('INVALID_PORT', 'Use a port from 1 through 65535.');
    fs.writeFileSync(configFile, JSON.stringify({ origin: canonical, port: listenPort }), privateFile);
  }
  const token = 'abo_' + randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + 60 * 60_000;
  const pending = path.join(home, 'owner-' + randomUUID() + '.tmp');
  fs.writeFileSync(pending, JSON.stringify({ hash: hash(token).toString('hex'), expiresAt }), privateFile);
  try { fs.renameSync(pending, path.join(home, 'owner.json')); }
  finally { fs.rmSync(pending, { force: true }); }
  const url = new URL('/workspace/', canonical);
  url.hash = 'owner=' + token;
  return { url: url.href, expiresAt: new Date(expiresAt).toISOString() };
}

function validRepository(value: unknown): string {
  if (typeof value === 'string' && value.length <= 2048) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && url.pathname !== '/' && !url.username && !url.password && !url.search && !url.hash) return url.href;
    } catch { /* Use the same error for invalid repository URLs. */ }
  }
  throw new HttpError(400, 'INVALID_REPOSITORY', 'Enter an HTTPS Git repository URL without credentials.');
}

export class BetaHost {
  readonly home: string;
  readonly origin: string;
  readonly port: number;
  #store: SqliteStore | undefined;

  constructor(directory: string) {
    this.home = homePath(directory);
    ({ origin: this.origin, port: this.port } = readBeta(this.home));
    const workspace = path.join(this.home, 'workspace');
    if (fs.existsSync(workspace)) this.#store = this.#openWorkspace(workspace);
  }

  get store() { return this.#store; }

  #openWorkspace(directory: string): SqliteStore {
    const config = readConfig(directory);
    if (config.relayOrigin !== this.origin || config.port !== this.port) {
      throw new LocalError('BETA_CONFIG_CONFLICT', 'The saved workspace is registered to another relay.');
    }
    return new SqliteStore(databasePath(directory), config.workspace);
  }

  #checkOwner(token: unknown): void {
    if (typeof token === 'string' && /^abo_[A-Za-z0-9_-]{43}$/.test(token)) {
      try {
        const grant = JSON.parse(fs.readFileSync(path.join(this.home, 'owner.json'), 'utf8'));
        if (/^[a-f0-9]{64}$/.test(grant.hash) && Number.isSafeInteger(grant.expiresAt)
            && grant.expiresAt > Date.now() && timingSafeEqual(hash(token), Buffer.from(grant.hash, 'hex'))) return;
      } catch { /* A missing grant has the same outcome as an expired grant. */ }
    }
    throw new HttpError(401, 'OWNER_INVITE_INVALID', 'This owner link is invalid or expired. Ask the operator for a new link.');
  }

  create(input: Record<string, unknown>): string {
    if (this.#store) throw new HttpError(409, 'WORKSPACE_EXISTS', 'This pilot workspace already exists. Open a current workspace invite.');
    this.#checkOwner(input.invite);
    const handle = /^[a-z][a-z0-9-]{0,39}$/;
    if (typeof input.owner !== 'string' || typeof input.teammate !== 'string' || !handle.test(input.owner) || !handle.test(input.teammate)
        || input.owner === input.teammate || typeof input.name !== 'string' || input.name.trim().length === 0 || input.name.length > 80) {
      throw new HttpError(400, 'INVALID_WORKSPACE', 'Enter a workspace name and two distinct lowercase usernames.');
    }
    const workspace = createBoard({
      id: randomUUID(), name: input.name, repository: validRepository(input.repository), participants: [input.owner, input.teammate],
    }).workspace;
    const config: LocalConfig = { version: 1, workspace, port: this.port, relayOrigin: this.origin };
    const destination = path.join(this.home, 'workspace');
    const staging = fs.mkdtempSync(path.join(this.home, 'pending-workspace-'));
    try {
      const prepared = new SqliteStore(databasePath(staging), workspace);
      let session: string | null;
      try {
        const invite = prepared.issueBrowserInvite(input.owner);
        session = prepared.redeemBrowserInvite(invite.token);
      } finally { prepared.close(); }
      if (!session) throw new Error('Could not create the owner session');
      fs.writeFileSync(path.join(staging, 'server.json'), JSON.stringify(config), privateFile);
      fs.renameSync(staging, destination);
      this.#store = this.#openWorkspace(destination);
      return session;
    } finally {
      if (fs.existsSync(staging)) {
        const target = fs.realpathSync(staging);
        if (path.dirname(target) !== fs.realpathSync(this.home) || !path.basename(target).startsWith('pending-workspace-')) {
          throw new Error('Unexpected workspace staging directory');
        }
        fs.rmSync(target, { recursive: true, force: true });
      }
    }
  }

  close(): void { this.#store?.close(); }
}
