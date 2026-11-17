import { DatabaseSync } from 'node:sqlite';
import { createBoard, execute, readEvents, readInbox, readRequest, DomainError } from '../domain/board.ts';
import { authorize } from '../domain/validation.ts';
import type { BoardState, CommandResult, DomainEvent, Environment, RetryReceipt, WorkRequest, Workspace } from '../domain/types.ts';
import { nodeEnvironment } from '../runtime.ts';
import { APPLICATION_ID, MIGRATIONS } from './migrations.ts';

export type StoreErrorCode = 'STORAGE_BUSY' | 'SCHEMA_TOO_NEW' | 'FOREIGN_DATABASE' | 'WORKSPACE_MISMATCH'
  | 'CORRUPT_STATE' | 'CLOSED' | 'STORAGE_FAILURE' | 'STATE_CONFLICT';
export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'StoreError';
    this.code = code;
  }
}
function storageError(error: unknown): Error {
  if (error instanceof DomainError || error instanceof StoreError) return error;
  const sqliteCode = error !== null && typeof error === 'object' && 'errcode' in error ? error.errcode : undefined;
  if (typeof sqliteCode === 'number' && [5, 6].includes(sqliteCode & 255)) {
    return new StoreError('STORAGE_BUSY', 'The database is busy. Retry the same command and key after the writer finishes.', error);
  }
  return new StoreError('STORAGE_FAILURE', 'SQLite operation failed; no successful command result is being returned.', error);
}
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new StoreError('CORRUPT_STATE', message);
}
function decode<T>(value: unknown): T {
  ensure(typeof value === 'string', 'Stored JSON must be text.');
  try { return JSON.parse(value) as T; }
  catch (error) { throw new StoreError('CORRUPT_STATE', 'Stored JSON could not be decoded.', error); }
}

export interface StoreOptions {
  busyTimeoutMs?: number;
  environment?: Environment;
}

/** Local-file persistence adapter. Principals are trusted in-process identities, not credentials. */
export class SqliteStore {
  readonly #db: DatabaseSync;
  readonly #workspace: Workspace;
  readonly #environment: Environment;
  #closed = false;

  constructor(filename: string, workspace: unknown, options: StoreOptions = {}) {
    this.#workspace = createBoard(workspace).workspace;
    const timeout = options.busyTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 30_000) throw new RangeError('busyTimeoutMs must be between 0 and 30000.');
    if (typeof filename !== 'string' || filename.trim() === '' || filename.includes('\0')) throw new TypeError('A database filename is required.');
    this.#environment = options.environment ?? nodeEnvironment;
    try { this.#db = new DatabaseSync(filename, { timeout }); }
    catch (error) { throw storageError(error); }
    try {
      this.#db.exec('PRAGMA foreign_keys = ON');
      this.#migrate();
      this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      this.#transaction('IMMEDIATE', () => {
        const row = this.#db.prepare('SELECT config_json FROM workspaces WHERE id = ?').get(this.#workspace.id);
        if (!row) {
          this.#db.prepare('INSERT INTO workspaces (id, config_json, state_schema_version, revision) VALUES (?, ?, 1, 0)')
            .run(this.#workspace.id, JSON.stringify(this.#workspace));
        } else {
          const existing = decode<Workspace>(row.config_json);
          ensure(existing !== null && typeof existing === 'object' && Array.isArray(existing.participants), 'Workspace configuration is malformed.');
          if (existing.id !== this.#workspace.id || existing.repository !== this.#workspace.repository
            || existing.participants.length !== 2 || !this.#workspace.participants.every(id => existing.participants.includes(id))) {
            throw new StoreError('WORKSPACE_MISMATCH', 'This workspace ID is already bound to another repository or participant pair.');
          }
        }
      });
    } catch (error) {
      this.#db.close();
      this.#closed = true;
      throw storageError(error);
    }
  }

  #open(): void {
    if (this.#closed) throw new StoreError('CLOSED', 'This store connection is closed.');
  }
  #transaction<T>(mode: 'DEFERRED' | 'IMMEDIATE', operation: () => T): T {
    this.#open();
    let began = false;
    try {
      this.#db.exec(`BEGIN ${mode}`);
      began = true;
      const result = operation();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      if (began) {
        try { this.#db.exec('ROLLBACK'); }
        catch { this.#db.close(); this.#closed = true; }
      }
      throw storageError(error);
    }
  }
  #migrate(): void {
    this.#transaction('IMMEDIATE', () => {
      const applicationId = this.#db.prepare('PRAGMA application_id').get()!.application_id;
      const version = this.#db.prepare('PRAGMA user_version').get()!.user_version;
      ensure(typeof applicationId === 'number' && typeof version === 'number', 'Invalid schema metadata.');
      if (applicationId !== 0 && applicationId !== APPLICATION_ID) throw new StoreError('FOREIGN_DATABASE', 'The file belongs to another application.');
      if (applicationId === 0) {
        const tables = this.#db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
        if (version !== 0 || tables.length !== 0) throw new StoreError('FOREIGN_DATABASE', 'Refusing to initialize a nonempty unrecognized database.');
      }
      if (version > MIGRATIONS.at(-1)!.version) throw new StoreError('SCHEMA_TOO_NEW', 'Database schema is newer than this application supports.');
      for (const migration of MIGRATIONS) if (migration.version > version) {
        this.#db.exec(migration.sql);
        this.#db.exec(`PRAGMA user_version = ${migration.version}`);
      }
      if (applicationId === 0) this.#db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
    });
  }
  #load(): { state: BoardState; revision: number } {
    const id = this.#workspace.id;
    const workspace = this.#db.prepare('SELECT config_json, state_schema_version, revision FROM workspaces WHERE id = ?').get(id);
    ensure(workspace && workspace.state_schema_version === 1 && typeof workspace.revision === 'number'
      && Number.isSafeInteger(workspace.revision) && workspace.revision >= 0, 'Workspace state metadata is missing or unsupported.');
    const requests = this.#db.prepare('SELECT id, version, data_json FROM requests WHERE workspace_id = ? ORDER BY created_cursor').all(id)
      .map(row => {
        const request = decode<WorkRequest>(row.data_json);
        ensure(request && typeof request === 'object' && request.id === row.id && request.workspaceId === id
          && request.version === row.version && Array.isArray(request.decisions) && Array.isArray(request.messages), 'Stored request envelope is inconsistent.');
        return request;
      });
    const events = this.#db.prepare('SELECT cursor, event_json FROM events WHERE workspace_id = ? ORDER BY cursor').all(id)
      .map((row, index) => {
        const event = decode<DomainEvent>(row.event_json);
        ensure(event && typeof event === 'object' && event.cursor === row.cursor && event.cursor === index + 1, 'Stored event sequence is inconsistent.');
        return event;
      });
    const receipts = this.#db.prepare('SELECT participant_id, role, operation, retry_key, payload_hash, result_json, event_cursor FROM retry_receipts WHERE workspace_id = ? ORDER BY event_cursor').all(id)
      .map(row => {
        const result = decode<RetryReceipt['result']>(row.result_json);
        ensure(result && typeof result === 'object' && result.event && result.request && result.event.cursor === row.event_cursor,
          'Stored retry receipt is inconsistent.');
        return { participantId: row.participant_id, role: row.role, operation: row.operation,
          retryKey: row.retry_key, payloadHash: row.payload_hash, result } as RetryReceipt;
      });
    ensure(events.length === workspace.revision && receipts.length === events.length, 'State, event, and receipt counts disagree.');
    return { state: { schemaVersion: 1, workspace: decode<Workspace>(workspace.config_json), requests, events, receipts }, revision: workspace.revision };
  }

  execute(principal: unknown, command: unknown): CommandResult {
    this.#open();
    const actor = authorize(this.#workspace, principal);
    return this.#transaction('IMMEDIATE', () => {
      const previous = this.#load();
      const outcome = execute(previous.state, actor, command, this.#environment);
      if (outcome.result.replayed) return outcome.result;
      const { request, event } = outcome.result;
      if (event.beforeVersion === null) {
        this.#db.prepare('INSERT INTO requests (workspace_id, id, version, created_cursor, data_json) VALUES (?, ?, ?, ?, ?)')
          .run(this.#workspace.id, request.id, request.version, event.cursor, JSON.stringify(request));
      } else {
        const update = this.#db.prepare('UPDATE requests SET version = ?, data_json = ? WHERE workspace_id = ? AND id = ? AND version = ?')
          .run(request.version, JSON.stringify(request), this.#workspace.id, request.id, event.beforeVersion);
        if (Number(update.changes) !== 1) throw new StoreError('STATE_CONFLICT', 'Request changed while saving.');
      }
      this.#db.prepare('INSERT INTO events (workspace_id, cursor, request_id, event_json) VALUES (?, ?, ?, ?)')
        .run(this.#workspace.id, event.cursor, request.id, JSON.stringify(event));
      const receipt = outcome.state.receipts.at(-1)!;
      this.#db.prepare('INSERT INTO retry_receipts (workspace_id, participant_id, role, operation, retry_key, payload_hash, event_cursor, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(this.#workspace.id, receipt.participantId, receipt.role, receipt.operation, receipt.retryKey,
          receipt.payloadHash, event.cursor, JSON.stringify(receipt.result));
      const update = this.#db.prepare('UPDATE workspaces SET revision = revision + 1 WHERE id = ? AND revision = ?')
        .run(this.#workspace.id, previous.revision);
      if (Number(update.changes) !== 1) throw new StoreError('STATE_CONFLICT', 'Workspace changed while saving.');
      return outcome.result;
    });
  }
  getRequest(principal: unknown, requestId: string): WorkRequest {
    this.#open();
    const actor = authorize(this.#workspace, principal);
    return this.#transaction('DEFERRED', () => readRequest(this.#load().state, actor, requestId));
  }
  inbox(principal: unknown): WorkRequest[] {
    this.#open();
    const actor = authorize(this.#workspace, principal);
    return this.#transaction('DEFERRED', () => readInbox(this.#load().state, actor));
  }
  events(principal: unknown, after = 0, limit = 100): DomainEvent[] {
    this.#open();
    const actor = authorize(this.#workspace, principal);
    return this.#transaction('DEFERRED', () => readEvents(this.#load().state, actor, after, limit));
  }
  close(): void {
    if (this.#closed) return;
    this.#db.close();
    this.#closed = true;
  }
}
