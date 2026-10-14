import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createDebuggerHandlers, registerServerCapture, withDebugCapture } from '../src/server.js';
registerServerCapture();
const handlers = createDebuggerHandlers({ authorize: request => new Headers(request.headers).get('cookie')?.includes('testDeveloper=yes') === true });
const serverOrders = withDebugCapture(async () => {
  const response = await fetch('http://127.0.0.1:4315/api/example');
  console.info('server order loaded');
  return Response.json(await response.json());
});
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/web-debugger' || url.pathname === '/api/server-orders') {
    const input = new Request('http://127.0.0.1:4315' + request.url, { method: request.method, headers: request.headers });
    const output = url.pathname === '/api/server-orders' ? await serverOrders(input) : await handlers[request.method](input);
    response.writeHead(output.status, Object.fromEntries(output.headers)); response.end(await output.text()); return;
  }
  if (url.pathname === '/api/example') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: { orders: [{ id: 305, customer: 'Alice' }] }, token: 'private-value', html: '<img src=x onerror=alert(1)>' })); return;
  }
  if (url.pathname === '/news/example') {
    response.setHeader('content-type', 'text/x-component');
    response.end('2:"$Sreact.fragment"\n4:I["[project]/node_modules/next/layout-router.js",[],"default"]\n'); return;
  }
  if (url.pathname.startsWith('/src/') && /^\/src\/[a-z]+\.js$/.test(url.pathname)) {
    try { response.setHeader('content-type', 'text/javascript'); response.end(await readFile(new URL('..' + url.pathname, import.meta.url))); } catch { response.writeHead(404); response.end(); } return;
  }
  response.setHeader('content-type', 'text/html');
  response.setHeader('set-cookie', 'testDeveloper=yes; Path=/; HttpOnly; SameSite=Strict');
  response.end(`<!doctype html><html><body><h1>Next.js debugger test host</h1><button id="app-button">Application button</button><script type="module">import { initDebugger } from '/src/browser.js'; window.initDebugger = initDebugger; window.originalFetch = window.fetch; window.originalLog = console.log; window.debuggerController = initDebugger({mode:'static', authorize:()=>true});</script></body></html>`);
});
server.listen(4315, '127.0.0.1');
