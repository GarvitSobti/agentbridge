import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { SqliteStore } from '../storage/sqlite-store.ts';
import { createBrowserHandler } from './browser.ts';
import type { BetaHost } from './beta.ts';
import { HttpError, body, errorResponse, numberParameter, reply } from './http.ts';

export { MAX_BODY_BYTES } from './http.ts';

function bearer(request: IncomingMessage): string {
  const value = request.headers.authorization;
  if (!value || !/^Bearer ab_[A-Za-z0-9_-]{43}$/.test(value)) throw new HttpError(401, 'UNAUTHORIZED', 'A valid bearer credential is required.');
  return value.slice(7);
}
export interface RelayHandle { url: string; close(): Promise<void> }
/** The host is intentionally fixed: this proof of concept cannot bind a public interface. */
export async function startRelay(initialStore: SqliteStore | undefined, port = 8787, browserOrigin?: string, beta?: BetaHost): Promise<RelayHandle> {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid local relay port.');
  if (!initialStore && !beta) throw new TypeError('A workspace or beta host is required.');
  if (beta && beta.origin !== browserOrigin) throw new TypeError('Use the beta host’s registered HTTPS origin.');
  const currentStore = () => beta ? beta.store : initialStore;
  const browser = browserOrigin ? createBrowserHandler(currentStore, browserOrigin, beta) : undefined;
  let address = '';
  const server = createServer({ maxHeaderSize: 8_192 }, (request, response) => {
    void (async () => {
      if (request.headers.host !== address && !(address.endsWith(':80') && request.headers.host === '127.0.0.1')) {
        throw new HttpError(403, 'LOCAL_CLIENT_REQUIRED', 'Use the local terminal client. Browser origins and other hosts are not supported.');
      }
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) throw new HttpError(400, 'INVALID_URL', 'Use a local relative request path.');
      const url = new URL(request.url, 'http://' + address);
      if (browser && url.pathname.startsWith('/workspace/')) { await browser(request, response, url); return; }
      if (request.headers.origin !== undefined) {
        throw new HttpError(403, 'LOCAL_CLIENT_REQUIRED', 'Browser origins are not supported on this API.');
      }
      if (url.pathname === '/health' && request.method === 'GET' && !url.search) { reply(response, 200, { status: 'ok' }); return; }
      const store = currentStore();
      if (beta && url.pathname === '/v1/pair' && request.method === 'POST' && !url.search) {
        const data = await body(request) as { code?: unknown; tokenHash?: unknown } | null;
        const issued = store?.redeemPairCode(data?.code, data?.tokenHash);
        if (!issued || !store) throw new HttpError(401, 'PAIR_CODE_INVALID', 'Generate a current pairing code in the workspace inbox.');
        reply(response, 200, { ...issued, workspace: store.workspace, relayOrigin: beta.origin });
        return;
      }
      if (!store) throw new HttpError(401, 'UNAUTHORIZED', 'The workspace is awaiting setup.');
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
