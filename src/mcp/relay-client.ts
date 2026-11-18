import type { Profile } from '../cli/profiles.ts';

const allowedWrites = new Set(['request.create', 'request.reply', 'decision.propose', 'decision.agree', 'request.start', 'request.complete']);
export class AgentRelayError extends Error {
  readonly code: string;
  readonly retryKey?: string;
  constructor(code: string, message: string, retryKey?: string) {
    super(message); this.name = 'AgentRelayError'; this.code = code;
    if (retryKey !== undefined) this.retryKey = retryKey;
  }
}
export function localRelayURL(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new AgentRelayError('INVALID_URL', 'Use http://127.0.0.1:PORT.'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new AgentRelayError('INVALID_URL', 'The adapter may send credentials only to an IPv4 loopback relay.');
  }
  return url;
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/** HTTP only: this adapter never opens SQLite or calls local credential administration. */
export class AgentRelayClient {
  readonly #url: URL;
  readonly #profile: Profile;
  constructor(url: string, profile: Profile) {
    this.#url = localRelayURL(url);
    if (profile.role !== 'agent') throw new AgentRelayError('AGENT_PROFILE_REQUIRED', 'Select an agent profile; human profiles are not allowed.');
    this.#profile = { ...profile };
  }
  async #request(route: string, command?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const retryKey = typeof command?.retryKey === 'string' ? command.retryKey : undefined;
    const payload = command === undefined ? undefined : JSON.stringify(command);
    if (payload !== undefined && Buffer.byteLength(payload) > 64 * 1024) throw new AgentRelayError('BODY_TOO_LARGE', 'Command JSON exceeds the relay 64 KiB limit.', retryKey);
    try {
      const response = await fetch(new URL(route, this.#url), { method: command ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { authorization: 'Bearer ' + this.#profile.token, ...(command ? { 'content-type': 'application/json' } : {}) },
        ...(payload === undefined ? {} : { body: payload }) });
      const reader = response.body?.getReader();
      if (!reader) throw new AgentRelayError('INVALID_RESPONSE', 'The relay returned an empty response.', retryKey);
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > 1024 * 1024) { await reader.cancel(); throw new AgentRelayError('RESPONSE_TOO_LARGE', 'Relay response exceeds 1 MiB; narrow the request or event page.', retryKey); }
          chunks.push(Buffer.from(part.value));
        }
      } finally { reader.releaseLock(); }
      let data: unknown;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new AgentRelayError('INVALID_RESPONSE', 'The relay returned invalid JSON.', retryKey); }
      if (!record(data)) throw new AgentRelayError('INVALID_RESPONSE', 'Expected a JSON object from the relay.', retryKey);
      if (!response.ok) {
        const error = data.error;
        const code = record(error) && typeof error.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'RELAY_ERROR';
        // Error messages are deliberately local constants: never echo untrusted response text or credentials.
        const message = response.status === 401 ? 'The agent credential is invalid or revoked.' : response.status === 403 ? 'This agent is not permitted to perform that action.'
          : response.status === 409 ? 'Read the current request or decision. Retry unchanged input with the same key, or use a new key for a changed operation.'
            : response.status === 503 ? 'The relay is temporarily unavailable; retry the same command and key.' : 'The relay rejected the request; check the tool arguments.';
        throw new AgentRelayError(code, message, retryKey);
      }
      return data;
    } catch (error) {
      if (error instanceof AgentRelayError) throw error;
      throw new AgentRelayError('RELAY_UNAVAILABLE', 'Could not reach the local relay. For an uncertain write, retry exactly the same arguments and retry key.', retryKey);
    }
  }
  async identity(): Promise<Record<string, unknown>> {
    const data = await this.#request('/v1/identity');
    const principal = data.principal;
    if (!record(principal) || principal.role !== 'agent' || principal.workspaceId !== this.#profile.workspaceId
      || principal.participantId !== this.#profile.participantId) {
      throw new AgentRelayError('AGENT_IDENTITY_REQUIRED', 'The relay identity must match the selected workspace, participant, and agent role.');
    }
    return { principal: { workspaceId: this.#profile.workspaceId, participantId: this.#profile.participantId, role: 'agent' } };
  }
  async inbox(): Promise<Record<string, unknown>> { await this.identity(); return this.#request('/v1/inbox'); }
  async getRequest(id: string): Promise<Record<string, unknown>> { await this.identity(); return this.#request('/v1/requests/' + encodeURIComponent(id)); }
  async events(after = 0, limit = 100): Promise<Record<string, unknown>> { await this.identity(); return this.#request(`/v1/events?after=${after}&limit=${limit}`); }
  async submit(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (typeof command.type !== 'string' || !allowedWrites.has(command.type)) throw new AgentRelayError('AGENT_ACTION_REQUIRED', 'Only agent-scoped task actions are exposed by this adapter.');
    await this.identity();
    return this.#request('/v1/commands', command);
  }
}
