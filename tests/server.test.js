import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createDebuggerHandlers, registerServerCapture, withDebugCapture, runWithDebugSession } from '../src/server.js';

test('server authorization, CSRF, session isolation and unchanged application responses', async () => {
  const server = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ message: 'original', token: 'private' })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const origin = 'https://example.com';
  const handlers = createDebuggerHandlers({ authorize: request => new Headers(request.headers).get('x-developer') === 'yes' });
  const request = (method, cookie = '', developer = 'yes', requestOrigin = origin, suffix = '') => new Request(origin + '/api/debugger' + suffix, { method, headers: { Origin: requestOrigin, 'x-developer': developer, Cookie: cookie } });
  try {
    registerServerCapture(); registerServerCapture();
    assert.equal((await handlers.POST(request('POST', '', 'no'))).status, 403);
    assert.equal((await handlers.POST(request('POST', '', 'yes', 'https://attacker.com'))).status, 403);
    const first = await handlers.POST(request('POST'));
    const cookieA = first.headers.get('set-cookie').split(';')[0];
    assert.match(first.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.match(first.headers.get('set-cookie'), /Secure/);
    const second = await handlers.POST(request('POST'));
    const cookieB = second.headers.get('set-cookie').split(';')[0];
    const app = withDebugCapture(async () => { const result = await fetch(api, { headers: { Authorization: 'Bearer private' } }); console.info({ message: 'scoped log', password: 'private' }); return result.json(); });
    assert.equal((await app(request('GET', cookieA))).token, 'private');
    await fetch(api); console.info('outside session');
    await runWithDebugSession(request('GET', cookieB), () => console.info('session B'));
    let captured;
    for (let i = 0; i < 30; i++) {
      captured = await (await handlers.GET(request('GET', cookieA))).json();
      if (captured.entries[0]?.responseBody) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(captured.entries.length, 1);
    assert.equal(captured.entries[0].status, 200);
    assert.ok(captured.entries[0].responseBody.includes('original'));
    assert.ok(!JSON.stringify(captured).includes('private'));
    assert.equal(captured.logs.length, 1);
    const b = await (await handlers.GET(request('GET', cookieB))).json();
    assert.equal(b.entries.length, 0); assert.equal(b.logs.length, 1); assert.ok(b.logs[0].text.includes('session B'));
    assert.equal((await handlers.GET(request('GET', cookieA, 'no'))).status, 403);
    const delta = await (await handlers.GET(request('GET', cookieA, 'yes', origin, '?after=' + captured.cursor))).json();
    assert.equal(delta.entries.length, 0); assert.equal(delta.logs.length, 0);
    await handlers.DELETE(request('DELETE', cookieA));
    assert.equal((await handlers.GET(request('GET', cookieA))).status, 404);
    assert.equal((await app(request('GET', cookieA))).message, 'original');
    await handlers.DELETE(request('DELETE', cookieB));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
