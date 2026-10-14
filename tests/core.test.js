import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, sanitizeURL, sanitizeBody, readBody, requestDetails, captureRequestBody, toCurl, searchJSON } from '../src/core.js';
import { withDebugger } from '../src/next.js';

test('redacts credentials in nested data, headers, query strings and form bodies', () => {
  assert.equal(redact({ user: { accessToken: 'private', email: 'private' } }, ['email']).user.accessToken, '[REDACTED]');
  assert.equal(redact({ email: 'private' }, ['email']).email, '[REDACTED]');
  const url = new URL(sanitizeURL('https://user:password@example.com/api?token=private&q=hello'));
  assert.equal(url.searchParams.get('token'), '[REDACTED]');
  assert.equal(url.searchParams.get('q'), 'hello');
  assert.ok(!url.href.includes('password'));
  assert.ok(!sanitizeBody('password=private&name=hello').includes('private'));
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(redact(cyclic).self, '[Circular]');
  let accessed = false;
  const getter = Object.defineProperty({}, 'test', { enumerable: true, get() { accessed = true; throw new Error('getter'); } });
  assert.equal(redact(getter).test, '[Accessor]'); assert.equal(accessed, false);
});

test('response capture leaves original response readable and limits captured bodies', async () => {
  const original = new Response(JSON.stringify({ token: 'private', data: ['hello'] }), { headers: { 'content-type': 'application/json' } });
  const captured = await readBody(original);
  assert.ok(!captured.includes('private'));
  assert.equal((await original.json()).token, 'private');
  const big = new Response('a'.repeat(2000));
  assert.match(await readBody(big, 256), /Body truncated/);
  assert.equal((await big.text()).length, 2000);
  assert.equal(await readBody(new Response('data: hi', { headers: { 'content-type': 'text/event-stream' } })), '[Streaming or binary body omitted]');
});

test('cURL quotes shell metacharacters and preserves method, headers and JSON body', () => {
  const entry = requestDetails("https://example.com/api?q='$(touch /tmp/no)'", { method: 'POST', headers: { Authorization: 'Bearer private', 'content-type': 'application/json' }, body: JSON.stringify({ name: "O'Brien", token: 'private' }) });
  const curl = toCurl(entry);
  assert.ok(!curl.includes('private'));
  assert.match(curl, /--data-raw/); assert.match(curl, /curl -X 'POST'/);
  assert.ok(curl.includes("O'\\''Brien"));
  assert.equal(requestDetails('https://example.com', { body: 'hello' }).requestHeaders['content-type'], 'text/plain;charset=UTF-8');
  const form = new FormData(); form.append('name', 'Alice');
  assert.ok(!toCurl(requestDetails('https://example.com', { method: 'POST', body: form })).includes('--data-raw'));
});

test('textual Request capture preserves the original body for the application', async () => {
  const request = new Request('https://example.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Alice', token: 'private' }) });
  const entry = requestDetails(request);
  const captured = new Promise(resolve => captureRequestBody(entry, request, undefined, 65536, [], resolve));
  assert.equal((await request.json()).token, 'private');
  await captured;
  assert.ok(entry.requestBody.includes('Alice')); assert.ok(!entry.requestBody.includes('private'));
  assert.equal(entry.requestBodyReplayable, true);
});

test('response search returns exact JSON paths including arrays and escaped keys', () => {
  const matches = searchJSON(JSON.stringify({ data: { orders: [{ id: 305, customer: 'Alice' }], 'a.b': 'Alice' } }), 'alice');
  assert.deepEqual(matches.map(match => match.path), ['$["data"]["orders"][0]["customer"]', '$["data"]["a.b"]']);
  assert.equal(searchJSON('hello\nfind me', 'find')[0].path, 'Line 2');
});

test('Next helper preserves config and detects export without enabling SSR', async () => {
  const config = { output: 'export', env: { EXISTING: 'keep' }, images: { unoptimized: true } };
  const result = withDebugger(config);
  assert.equal(result.env.NEXT_PUBLIC_WEB_DEBUGGER_MODE, 'static');
  assert.equal(result.env.EXISTING, 'keep'); assert.equal(result.images, config.images);
  assert.equal(config.env.NEXT_PUBLIC_WEB_DEBUGGER_MODE, undefined);
  assert.equal((await withDebugger(async () => ({ output: 'standalone' }))()).env.NEXT_PUBLIC_WEB_DEBUGGER_MODE, 'server');
});
