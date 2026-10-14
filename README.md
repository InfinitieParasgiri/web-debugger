# next-web-debugger

A reusable, dependency-free browser debugger with an optional React wrapper and Node.js server integration for Next.js. Hold **Ctrl** and type **3 → 0 → 5** within two seconds between keys. A round button appears; click it to open the network and console panel. Repeat the shortcut or press Escape to minimize. **Stop** ends capture and removes the panel. Sessions expire after 15 minutes by default.

Features: fetch and XMLHttpRequest capture, URL/method/status/source search, request parameters/headers/body, response headers/body, JSON/text search with paths and highlights, shell-quoted cURL copying, console logs/warnings/errors and unhandled browser errors, pause/resume, clear, and responsive layout. No telemetry or external service is used.

## Install from GitHub

Push this repository to your GitHub account, then run in your Next.js project:

```sh
npm install github:YOUR_ACCOUNT/YOUR_REPOSITORY#v0.1.0
```

Create a `v0.1.0` tag in GitHub first, or replace the tag with a commit SHA. No build step is needed: the package ships JavaScript and TypeScript declarations. The package name used in imports is `next-web-debugger`, regardless of your repository name. Node.js 20+ is required for server capture. React 18+ is an optional peer dependency for the React wrapper.

## Next.js setup

Wrap your existing config without changing its rendering settings:

```js
// next.config.mjs
import { withDebugger } from 'next-web-debugger/next';

export default withDebugger({
  // Keep your existing settings here.
  // output: 'export', // Only if your project already uses static export.
});
```

`withDebugger` adds build metadata: `static` for `output: 'export'`, otherwise `server`. A server deployment can still contain static pages; this label describes the deployment, not each route. Without metadata or an explicit `mode`, the panel shows `Unknown deployment`.

For development, mount once in the App Router root layout:

```tsx
// app/layout.tsx
import { WebDebugger } from 'next-web-debugger/react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}<WebDebugger /></body></html>;
}
```

For Pages Router, mount `<WebDebugger />` in `pages/_app.tsx` beside your existing page component. The wrapper enables unauthenticated activation only when `NODE_ENV` is `development`. Production requires authorization or the protected server endpoint below.

## Production: browser capture

Create a client component and connect it to your **existing developer access check**:

```tsx
// app/debugger-provider.tsx
'use client';
import { WebDebugger } from 'next-web-debugger/react';

async function authorizeDebugger() {
  const response = await fetch('/api/developer-access', {
    credentials: 'same-origin', cache: 'no-store',
  });
  if (!response.ok) return false;
  const access = await response.json();
  return access.canDebug === true;
}

export default function DebuggerProvider() {
  return <WebDebugger authorize={authorizeDebugger} />;
}
```

Mount `<DebuggerProvider />` once in your layout. `/api/developer-access` is an example contract you implement using your existing authentication. A static export needs an external authentication service or another real developer authorization callback because it cannot host a dynamic Next.js API endpoint. Do not use `authorize={() => true}` or `development={true}` in production. The shortcut is a UI entry point, not an access credential. A browser-only callback controls the UI; it is not a security boundary against users modifying their own JavaScript.

## Production: optional server capture

This version supports a **single persistent Node.js process**. Sessions and records are in process memory. Serverless/multi-instance/Edge deployment requires a different session store and is not supported by this version. Build-time capture is also not included.

1. Register in your existing instrumentation file (preserve any existing registration):

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerServerCapture } = await import('next-web-debugger/server');
    registerServerCapture();
  }
}
```

2. Add a protected session endpoint using your existing server-side authentication:

```ts
// app/api/web-debugger/route.ts
import { createDebuggerHandlers } from 'next-web-debugger/server';
import { isDeveloperRequest } from '@/lib/auth'; // Your existing authentication.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const { GET, POST, DELETE } = createDebuggerHandlers({
  authorize: isDeveloperRequest,
  durationMinutes: 15,
  redactKeys: ['email', 'phone'],
});
```

The callback must return exactly `true` only for an authenticated developer. It receives an object with `headers`; keep it compatible with both `Request` and `{ headers: HeadersInit }` if you use the SSR example below. The endpoint rechecks authorization on every call. POST/DELETE require the same-origin `Origin` header. Its session cookie is HttpOnly, SameSite=Strict, and Secure on HTTPS.

3. Mount `<WebDebugger serverEndpoint="/api/web-debugger" />`. The endpoint authorizes activation; browser capture starts only after it succeeds. Keep the server and browser duration/redaction settings consistent.

4. Wrap the server handlers whose outgoing calls you want to inspect:

```ts
import { withDebugCapture } from 'next-web-debugger/server';

export const GET = withDebugCapture(async (request: Request) => {
  // Preserve your existing handler logic here.
  const response = await fetch(process.env.BACKEND_URL + '/orders');
  return Response.json(await response.json());
});
```

For SSR data loading, wrap the existing function body in `runWithDebugSession`. For example, in Pages Router:

```ts
import { runWithDebugSession } from 'next-web-debugger/server';

export async function getServerSideProps(context) {
  return runWithDebugSession(
    { headers: { cookie: context.req.headers.cookie ?? '' } },
    async () => {
      // Your existing data-loading logic and props return.
      return { props: {} };
    },
  );
}
```

Pass any other headers your authorization callback needs. In an App Router Server Component, `await headers()` from `next/headers` can supply the headers; wrap the relevant data-loading callback with `runWithDebugSession({ headers: await headers() }, callback)`. Using `headers()` can affect static rendering, so add this only to routes that already require request-time rendering. Server capture covers outgoing native `fetch` and console calls inside the wrapped context. It does not automatically capture all SSR rendering, incoming request bodies, Axios/Node HTTP clients, or build-time calls. Other visitors' requests run outside the developer's session and are not recorded.

## Options and limits

`WebDebugger` and `initDebugger` accept `mode`, `authorize`, `development`, `serverEndpoint`, `durationMinutes` (1–60), `maxEntries` (default 200, maximum 1000 per network/console list), `maxBodyBytes` (default 64 KiB, maximum 256 KiB), and `redactKeys`. Keep callbacks and arrays stable between React renders. Mount once per app. `initDebugger` returns `enable()`, `disable()`, and `destroy()` for non-React integrations.

Capture starts after activation. Earlier requests/logs are not recoverable. Reloading resets browser capture; activate again and repeat an action to inspect it. The server session cookie remains valid until Stop or expiry. Cross-origin response details remain subject to browser CORS rules.

Sensitive keys such as authorization, cookies, passwords, tokens, and API keys are masked, along with custom `redactKeys`. Redaction is best effort, especially for unstructured text, secrets embedded in URLs/paths, and truncated bodies. cURL exports contain masked placeholders and omit browser-generated headers/cookies; replace them using your own credentials before replay. String request bodies and textual `Request` bodies are captured; binary/file bodies are omitted. FormData is a descriptive preview, not a replayable multipart payload. Streaming/binary responses are omitted; large responses are truncated, and body capture has a three-second timeout. Pausing suppresses browser recording and server display polling, while server recording continues until Stop/expiry.

## Development

```sh
npm install
npm test
npm run check
npx playwright install chromium
npm run test:browser
npm pack --dry-run
```

Tests verify response preservation, masking, cURL quoting, search paths, server authorization/session isolation, and desktop/mobile browser interactions. No live production API is used.

Next.js references: [static exports](https://nextjs.org/docs/app/guides/static-exports), [server instrumentation](https://nextjs.org/docs/app/guides/instrumentation).
