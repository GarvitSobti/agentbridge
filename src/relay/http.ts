import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http';
import { DomainError } from '../domain/board.ts';
import { StoreError } from '../storage/sqlite-store.ts';

export const MAX_BODY_BYTES = 64 * 1024;
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function reply(response: ServerResponse, status: number, value: unknown, headers: OutgoingHttpHeaders = {}): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', ...(status === 401 ? { 'www-authenticate': 'Bearer' } : {}),
    ...(status === 503 ? { 'retry-after': '1' } : {}), ...(status >= 400 ? { connection: 'close' } : {}), ...headers });
  response.end(JSON.stringify(value) + '\n');
}
export function errorResponse(response: ServerResponse, error: unknown): void {
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
export async function body(request: IncomingMessage): Promise<unknown> {
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
export function numberParameter(url: URL, name: string, fallback: number): number {
  const value = url.searchParams.get(name);
  if (value === null) return fallback;
  if (!/^\d{1,16}$/.test(value)) throw new HttpError(400, 'INVALID_INPUT', `Invalid ${name} parameter.`);
  return Number(value);
}
