import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DomainError } from '../domain/board.ts';
import { SqliteStore, StoreError } from '../storage/sqlite-store.ts';

export const MAX_BODY_BYTES = 64 * 1024;
class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
function reply(response: ServerResponse, status: number, value: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', ...(status === 401 ? { 'www-authenticate': 'Bearer' } : {}),
    ...(status === 503 ? { 'retry-after': '1' } : {}), ...(status >= 400 ? { connection: 'close' } : {}) });
  response.end(JSON.stringify(value) + '\n');
}
function errorResponse(response: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) { reply(response, error.status, { error: { code: error.code, message: error.message } }); return; }
  if (error instanceof DomainError) {
    const status = error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_INPUT' ? 400 : 409;
    reply(response, status, { error: { code: error.code, message: error.message } }); return;
  }
  if (error instanceof StoreError && ['STORAGE_BUSY', 'CLOSED'].includes(error.code)) {
    reply(response, 503, { error: { code: error.code, message: 'The relay is temporarily unavailable; retry the same command and retry key.' } }); return;
  }
  reply(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'The relay could not process this request.' } });
}
function bearer(request: IncomingMessage): string {
  const value = request.headers.authorization;
  if (!value || !/^Bearer ab_[A-Za-z0-9_-]{43}$/.test(value)) throw new HttpError(401, 'UNAUTHORIZED', 'A valid bearer credential is required.');
  return value.slice(7);
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
  }
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new HttpError(413, 'BODY_TOO_LARGE', 'JSON body exceeds 64 KiB.');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'JSON body exceeds 64 KiB.');
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new HttpError(400, 'INVALID_JSON', 'The body must contain valid JSON.'); }
}
function numberParameter(url: URL, name: string, fallback: number): number {
  const value = url.searchParams.get(name);
  if (value === null) return fallback;
  if (!/^\d{1,16}$/.test(value)) throw new HttpError(400, 'INVALID_INPUT', `Invalid ${name} parameter.`);
  return Number(value);
}

export interface RelayHandle { url: string; close(): Promise<void> }
/** The host is intentionally fixed: this proof of concept cannot bind a public interface. */
export async function startRelay(store: SqliteStore, port = 8787): Promise<RelayHandle> {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid local relay port.');
  let address = '';
  const server = createServer({ maxHeaderSize: 8_192 }, (request, response) => {
    void (async () => {
      if ((request.headers.host !== address && !(address.endsWith(':80') && request.headers.host === '127.0.0.1')) || request.headers.origin !== undefined) {
        throw new HttpError(403, 'LOCAL_CLIENT_REQUIRED', 'Use the local terminal client. Browser origins and other hosts are not supported.');
      }
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) throw new HttpError(400, 'INVALID_URL', 'Use a local relative request path.');
      const url = new URL(request.url, 'http://' + address);
      if (url.pathname === '/health' && request.method === 'GET' && !url.search) { reply(response, 200, { status: 'ok' }); return; }
      const token = bearer(request);
      const authenticate = () => {
        const principal = store.authenticate(token);
        if (!principal) throw new HttpError(401, 'UNAUTHORIZED', 'The credential is invalid or revoked.');
        return principal;
      };
      const principal = authenticate();
      const allowedQuery = url.pathname === '/v1/events' ? ['after', 'limit'] : [];
      for (const key of url.searchParams.keys()) if (!allowedQuery.includes(key) || url.searchParams.getAll(key).length !== 1) {
        throw new HttpError(400, 'INVALID_INPUT', 'Unexpected or duplicate query parameter.');
      }
      if (url.pathname === '/v1/commands' && request.method === 'POST') {
        const command = await body(request);
        // Recheck after reading: an operator may revoke a token while a slow body is arriving.
        const result = store.execute(authenticate(), command);
        reply(response, 200, result); return;
      }
      if (url.pathname === '/v1/inbox' && request.method === 'GET') { reply(response, 200, { requests: store.inbox(principal) }); return; }
      if (url.pathname === '/v1/identity' && request.method === 'GET') { reply(response, 200, { principal }); return; }
      if (url.pathname === '/v1/events' && request.method === 'GET') {
        reply(response, 200, { events: store.events(principal, numberParameter(url, 'after', 0), numberParameter(url, 'limit', 100)) }); return;
      }
      const match = /^\/v1\/requests\/([^/]+)$/.exec(url.pathname);
      if (match && request.method === 'GET') {
        let id: string;
        try { id = decodeURIComponent(match[1]!); } catch { throw new HttpError(400, 'INVALID_URL', 'Malformed request ID.'); }
        reply(response, 200, { request: store.getRequest(principal, id) }); return;
      }
      throw new HttpError(404, 'NOT_FOUND', 'Relay route not found.');
    })().catch(error => errorResponse(response, error));
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 32;
  server.on('upgrade', (_request, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const info = server.address();
  if (!info || typeof info === 'string') throw new Error('Local relay did not obtain a TCP address.');
  address = `127.0.0.1:${info.port}`;
  let closing: Promise<void> | undefined;
  return { url: 'http://' + address, close() {
    closing ??= new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => server.closeAllConnections(), 1_000).unref();
      server.close(error => { clearTimeout(timer); if (error) reject(error); else resolve(); });
      server.closeIdleConnections();
    });
    return closing;
  } };
}
