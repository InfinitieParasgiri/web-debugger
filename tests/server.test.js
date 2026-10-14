import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createDebuggerHandlers, registerServerCapture, withDebugCapture, runWithDebugSession, instrumentAxios } from '../src/server.js';
import axios from 'axios';

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

test('Axios capture preserves Laravel-style JSON, failures, request data and existing interceptors', async () => {
  const received = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received.push({ url: req.url, method: req.method, body, authorization: req.headers.authorization });
      res.setHeader('content-type', 'application/json');
      res.statusCode = req.url.startsWith('/failed') ? 422 : 200;
      res.end(JSON.stringify({ success: res.statusCode === 200, message: 'Products fetched successfully', data: { products: [{ id: 790, title: 'Example product' }], token: 'response-secret' } }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = axios.create({ baseURL: `http://127.0.0.1:${server.address().port}` });
  const dispose = instrumentAxios(client); assert.equal(instrumentAxios(client), dispose);
  let originalResponse, originalError;
  client.interceptors.response.use(response => { originalResponse = response; return response; }, error => { originalError = error; throw error; });
  const endpoint = 'https://example.com/api/debugger';
  const handlers = createDebuggerHandlers({ authorize: request => new Headers(request.headers).get('x-developer') === 'yes' });
  const started = await handlers.POST(new Request(endpoint, { method: 'POST', headers: { origin: 'https://example.com', 'x-developer': 'yes' } }));
  const cookie = started.headers.get('set-cookie').split(';')[0];
  const request = new Request(endpoint, { headers: { cookie, 'x-developer': 'yes' } });
  try {
    const response = await runWithDebugSession(request, () => client.post('/products', { name: 'Alice', password: 'request-secret' }, { params: { page: 1, token: 'query-secret' }, headers: { Authorization: 'Bearer header-secret' } }));
    assert.equal(response, originalResponse); assert.equal(response.data.data.token, 'response-secret');
    assert.equal(received[0].authorization, 'Bearer header-secret');
    assert.equal(JSON.parse(received[0].body).password, 'request-secret');
    assert.ok(received[0].url.includes('token=query-secret'));
    await assert.rejects(runWithDebugSession(request, () => client.get('/failed')), error => error === originalError && error.response.status === 422);
    await client.get('/products'); // Outside the SSR capture scope.
    const result = await (await handlers.GET(request)).json();
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0].transport, 'axios'); assert.equal(result.entries[0].source, 'Server');
    assert.equal(result.entries[0].status, 200); assert.equal(result.entries[1].status, 422);
    assert.ok(result.entries[0].responseBody.includes('Example product'));
    assert.ok(!JSON.stringify(result).includes('-secret'));
    dispose();
    await runWithDebugSession(request, () => client.get('/products'));
    assert.equal((await (await handlers.GET(request)).json()).entries.length, 2);
    await handlers.DELETE(new Request(endpoint, { method: 'DELETE', headers: { cookie, origin: 'https://example.com', 'x-developer': 'yes' } }));
  } finally { dispose(); await new Promise(resolve => server.close(resolve)); }
});
