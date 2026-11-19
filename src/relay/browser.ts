import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BROWSER_SESSION_SECONDS, type SqliteStore } from '../storage/sqlite-store.ts';
import { HttpError, body, reply } from './http.ts';
import type { BetaHost } from './beta.ts';

const COOKIE = '__Host-agentbridge';
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function sessionCookie(value: string, seconds: number): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
}

function getSession(request: IncomingMessage): string | undefined {
  const matches = request.headers.cookie?.split(';').map(cookie => cookie.trim()).filter(cookie => cookie.startsWith(COOKIE + '='));
  return matches?.length === 1 ? matches[0]?.slice(COOKIE.length + 1) : undefined;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_INPUT', 'Send a JSON object.');
  }
  return value as Record<string, unknown>;
}

export function createBrowserHandler(currentStore: () => SqliteStore | undefined, origin: string, beta?: BetaHost) {
  const publicUrl = new URL(origin);
  if (publicUrl.protocol !== 'https:' || publicUrl.origin !== origin) {
    throw new Error('The browser inbox requires a canonical HTTPS origin.');
  }
  const assets = new Map([
    ['/workspace/', ['text/html; charset=utf-8', readFileSync(new URL('./web/index.html', import.meta.url))] as const],
    ['/workspace/app.js', ['text/javascript; charset=utf-8', readFileSync(new URL('./web/app.js', import.meta.url))] as const],
    ['/workspace/approval.js', ['text/javascript; charset=utf-8', readFileSync(new URL('./web/approval.js', import.meta.url))] as const],
    ['/workspace/onboarding.js', ['text/javascript; charset=utf-8', readFileSync(new URL('./web/onboarding.js', import.meta.url))] as const],
    ['/workspace/app.css', ['text/css; charset=utf-8', readFileSync(new URL('./web/app.css', import.meta.url))] as const],
  ]);

  return async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> => {
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', POLICY);
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if ((request.headers.origin !== undefined && request.headers.origin !== origin)
        || (request.method === 'POST' && request.headers.origin !== origin)) {
      throw new HttpError(403, 'ORIGIN_REQUIRED', 'Open the configured HTTPS workspace to continue.');
    }

    const asset = assets.get(url.pathname);
    if (request.method === 'GET' && asset && !url.search) {
      response.writeHead(200, { 'content-type': asset[0], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(asset[1]);
      return;
    }

    if (beta && url.pathname === '/workspace/api/create' && request.method === 'POST' && !url.search) {
      const token = beta.create(object(await body(request)));
      reply(response, 201, { created: true }, { 'set-cookie': sessionCookie(token, BROWSER_SESSION_SECONDS) });
      return;
    }

    const store = currentStore();
    if (!store) throw new HttpError(401, 'SESSION_REQUIRED', 'Open a current workspace invite to sign in.');
    const session = getSession(request);
    const requireSession = () => {
      const actor = store.authenticateBrowser(session);
      if (!actor) throw new HttpError(401, 'SESSION_REQUIRED', 'Open a current workspace invite to sign in.');
      return actor;
    };
    if (url.pathname === '/workspace/api/inbox' && request.method === 'GET') {
      const requestId = url.searchParams.get('request');
      if ([...url.searchParams].length > (requestId === null ? 0 : 1) || (requestId !== null && !/^[A-Za-z0-9_-]{1,96}$/.test(requestId))) {
        throw new HttpError(400, 'INVALID_INPUT', 'Select a valid request.');
      }
      const actor = requireSession();
      const inbox = store.browserWorkspace(actor, requestId ?? undefined);
      reply(response, 200, beta ? { ...inbox, setup: store.betaSetup(actor) } : inbox);
      return;
    }
    if (request.method === 'POST' && !url.search) {
      if (url.pathname === '/workspace/api/sign-in') {
        const input = object(await body(request));
        const token = store.redeemBrowserInvite(input.invite);
        if (!token) throw new HttpError(401, 'INVITE_INVALID', 'This invite has expired or already been used. Ask the operator for a new one.');
        reply(response, 200, { signedIn: true }, { 'set-cookie': sessionCookie(token, BROWSER_SESSION_SECONDS) });
        return;
      }
      if (url.pathname === '/workspace/api/sign-out') {
        store.endBrowserSession(session);
        reply(response, 200, { signedOut: true }, { 'set-cookie': sessionCookie('', 0) });
        return;
      }
      if (beta && url.pathname === '/workspace/api/invite') {
        requireSession();
        await body(request);
        const setup = store.betaSetup(requireSession());
        if (!setup.canInvite) throw new HttpError(403, 'FORBIDDEN', 'Only the workspace owner can invite the teammate.');
        const invite = store.issueBrowserInvite(setup.teammate, true);
        const link = new URL('/workspace/', origin);
        link.hash = 'invite=' + invite.token;
        reply(response, 201, { url: link.href, expiresAt: new Date(invite.expiresAt).toISOString() });
        return;
      }
      if (beta && url.pathname === '/workspace/api/pair-code') {
        requireSession();
        await body(request);
        const pair = store.issuePairCode(requireSession());
        reply(response, 201, { code: pair.code, expiresAt: new Date(pair.expiresAt).toISOString() });
        return;
      }
      if (url.pathname === '/workspace/api/decision') {
        requireSession();
        const input = object(await body(request));
        if (input.type !== 'request.accept' && input.type !== 'request.decline' && input.type !== 'request.approve_pickup') {
          throw new HttpError(400, 'INVALID_INPUT', 'Choose accept or decline.');
        }
        reply(response, 200, store.execute(requireSession(), input));
        return;
      }
    }
    throw new HttpError(404, 'NOT_FOUND', 'Workspace route not found.');
  };
}
