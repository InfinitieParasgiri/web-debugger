import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { requestDetails, captureRequestBody, readBody, safeText, sanitizeHeaders } from './core.js';

const symbol = Symbol.for('next-web-debugger.server.v1');
const shared = globalThis[symbol] ??= { context: new AsyncLocalStorage(), sessions: new Map(), installed: false };
const cookieName = '__web_debugger_session';
function prune() { for (const [id, session] of shared.sessions) if (session.expires <= Date.now()) shared.sessions.delete(id); }
function sessionFor(request) {
  prune();
  const cookie = new Headers(request.headers).get('cookie') || '';
  const id = cookie.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  return shared.sessions.get(id);
}
const attempt = fn => { try { fn(); } catch { /* Observability must not affect application behavior. */ } };
function append(session, name, entry) {
  entry.revision = ++session.cursor;
  session[name].push(entry);
  if (session[name].length > session.maxEntries) session[name].shift();
}
function update(session, entry) { entry.revision = ++session.cursor; }
function active(session) { return session && session.expires > Date.now() && shared.sessions.get(session.id) === session; }

/** Call once from the Node.js branch of instrumentation.ts. Captures only opted-in request contexts. */
export function registerServerCapture() {
  if (shared.installed) return;
  shared.installed = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    const session = shared.context.getStore();
    if (!active(session)) return Reflect.apply(originalFetch, this, arguments);
    let entry;
    attempt(() => {
      entry = { id: randomUUID(), source: 'Server', transport: 'fetch', ...requestDetails(input, init, undefined, session.redactKeys), status: 'Pending', startedAt: Date.now(), responseBody: '' };
      append(session, 'entries', entry);
      captureRequestBody(entry, input, init, session.maxBodyBytes, session.redactKeys, () => { if (active(session)) update(session, entry); });
    });
    let result;
    try { result = Reflect.apply(originalFetch, this, arguments); }
    catch (error) { if (entry) { entry.status = 'Failed'; entry.responseBody = safeText(error, session.redactKeys); update(session, entry); } throw error; }
    if (entry) void result.then(response => {
      if (!active(session)) return;
      entry.status = response.status; entry.duration = Date.now() - entry.startedAt;
      entry.responseHeaders = sanitizeHeaders(response.headers, session.redactKeys); update(session, entry);
      void readBody(response, session.maxBodyBytes, session.redactKeys).then(body => {
        if (active(session)) { entry.responseBody = body; update(session, entry); }
      }, () => { if (active(session)) { entry.responseBody = '[Body unavailable]'; update(session, entry); } });
    }, error => {
      if (!active(session)) return;
      entry.status = 'Failed'; entry.duration = Date.now() - entry.startedAt; entry.responseBody = safeText(error, session.redactKeys); update(session, entry);
    }).catch(() => {});
    return result;
  };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level];
    console[level] = function (...args) {
      const result = Reflect.apply(original, this, args);
      const session = shared.context.getStore();
      if (active(session)) attempt(() => append(session, 'logs', { id: randomUUID(), source: 'Server', level, time: Date.now(), text: args.map(arg => safeText(arg, session.redactKeys, session.maxBodyBytes)).join(' ').slice(0, session.maxBodyBytes) }));
      return result;
    };
  }
}

/** Wrap a route handler to associate outgoing fetch and console calls with the developer's session. */
export function withDebugCapture(handler) {
  return function (request, ...args) { return runWithDebugSession(request, () => handler.call(this, request, ...args)); };
}

/** Also usable around SSR data loading. request must provide standard Headers-compatible headers. */
export async function runWithDebugSession(request, callback) {
  const session = sessionFor(request);
  let allowed = false;
  if (session) { try { allowed = await session.authorize(request) === true; } catch { /* Fail closed for capture, preserve the application callback. */ } }
  return shared.context.run(allowed ? session : undefined, callback);
}

/** Protected same-origin session endpoint. No server data is exposed without authorize returning true. */
export function createDebuggerHandlers(options) {
  if (typeof options?.authorize !== 'function') throw new Error('A developer authorization callback is required.');
  const json = (value, status = 200, cookie) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'Vary': 'Cookie', ...(cookie ? { 'Set-Cookie': cookie } : {}) }
  });
  const authorize = async request => { try { return await options.authorize(request) === true; } catch { return false; } };
  const sameOrigin = request => request.headers.get('origin') === new URL(request.url).origin && !['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site'));
  const cookie = (request, id, seconds) => `${cookieName}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
  return {
    async POST(request) {
      if (!sameOrigin(request) || !await authorize(request)) return json({ error: 'Forbidden' }, 403);
      prune();
      const existing = sessionFor(request); if (existing) shared.sessions.delete(existing.id);
      if (shared.sessions.size >= 20) return json({ error: 'Too many active debugging sessions' }, 429);
      const ttl = Math.min(60, Math.max(1, options.durationMinutes || 15)) * 60;
      const id = randomUUID();
      shared.sessions.set(id, { id, expires: Date.now() + ttl * 1000, cursor: 0, entries: [], logs: [], authorize: options.authorize,
        maxEntries: Math.min(1000, Math.max(1, options.maxEntries || 200)), maxBodyBytes: Math.min(262144, Math.max(256, options.maxBodyBytes || 65536)), redactKeys: options.redactKeys || [] });
      return json({ enabled: true, expiresAt: Date.now() + ttl * 1000 }, 200, cookie(request, id, ttl));
    },
    async GET(request) {
      if (!await authorize(request)) return json({ error: 'Forbidden' }, 403);
      const session = sessionFor(request);
      if (!session) return json({ error: 'No active session on this server instance' }, 404);
      const cursor = Number(new URL(request.url).searchParams.get('after') || 0);
      return json({ cursor: session.cursor, entries: session.entries.filter(entry => entry.revision > cursor), logs: session.logs.filter(entry => entry.revision > cursor) });
    },
    async DELETE(request) {
      if (!sameOrigin(request) || !await authorize(request)) return json({ error: 'Forbidden' }, 403);
      const session = sessionFor(request); if (session) shared.sessions.delete(session.id);
      return json({ enabled: false }, 200, cookie(request, '', 0));
    }
  };
}
