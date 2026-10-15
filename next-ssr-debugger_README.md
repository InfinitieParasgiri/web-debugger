# ⚡ next-ssr-debugger

A lightweight, zero-production-overhead **Server-Side Network & API Debugger** for Next.js (App Router & React Server Components).

When Next.js fetches data on the server (`async` Server Components, SSR, Server Actions, Route Handlers), those requests happen inside Node.js and **never appear in Chrome's browser Network tab**. `next-ssr-debugger` intercepts server-side `fetch` calls and renders an interactive DevTools drawer right in your browser.

---

## ✨ Features

- **Full Server API Visibility**: See every `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` call made by Next.js on the server.
- **Inspect Sent Parameters**: View exact URL query parameters (`?page=1&filter=active`), JSON request bodies, and headers sent to your backend.
- **API Endpoint Search Bar**: Filter captured requests by URL, HTTP method, status code, or parameter values.
- **Deep Response Search & Highlight**: Search inside large nested JSON responses with live yellow keyword highlighting and match counters.
- **One-Click Copy JSON & cURL**: Export any server request as a `cURL` command or copy formatted JSON payloads immediately.
- **Safe for Production**: Automatically disabled when `NODE_ENV !== 'development'`. Uses `response.clone()` so Next.js Server Component streams are never interrupted.

---

## 📦 Part 1: How to Publish This Package to GitHub

1. Extract this zip folder (`next-ssr-debugger`).
2. Install dependencies and test the build locally:
   ```bash
   cd next-ssr-debugger
   npm install
   npm run build
   ```
3. Push to a new GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "feat: initial release of next-ssr-debugger"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/next-ssr-debugger.git
   git push -u origin main
   ```

---

## 🚀 Part 2: How to Install & Use in Any Next.js Project

### Step 1: Install from GitHub (or NPM)

In your Next.js project terminal, run:

```bash
npm install git+https://github.com/YOUR_USERNAME/next-ssr-debugger.git
```

### Step 2: Auto-Generate Server Files (CLI) or Manual Setup

You can automatically generate `instrumentation.ts` and the bridge API route using the built-in CLI:

```bash
npx next-ssr-debugger
```

#### Or set up the 3 files manually:

#### 1. Create `src/instrumentation.ts` (or root `instrumentation.ts` if not using `src/`)
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSSRDebugger } = await import('next-ssr-debugger/server');
    initSSRDebugger({
      maxLogs: 100, // Optional: max requests stored in memory
      ignoreUrls: ['https://analytics.example.com'], // Optional: ignore specific URLs
    });
  }
}
```
*(Note: If you are using Next.js 13 or 14, enable `experimental: { instrumentationHook: true }` inside `next.config.js`. In Next.js 15+, `instrumentation.ts` works out of the box.)*

#### 2. Create Bridge API Route `src/app/api/__nextjs-debugger/route.ts`
```typescript
import { createDebuggerRouteHandler } from 'next-ssr-debugger/server';

export const { GET, DELETE } = createDebuggerRouteHandler();
```

#### 3. Add `<ServerDebugger />` to `src/app/layout.tsx`
```tsx
import { ServerDebugger } from 'next-ssr-debugger/client';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServerDebugger position="bottom-right" />
      </body>
    </html>
  );
}
```

---

## 🛠️ How to Use the Debugger UI

1. Run your Next.js app in development mode (`npm run dev`).
2. Click the floating **`SSR Network (N)`** pill in the bottom-right corner of your browser.
3. **Filter APIs**: Use the first search input (`Filter API URL or sent params...`) or the HTTP method dropdown (`ALL`, `GET`, `POST`, etc.) to locate a specific backend call.
4. **Inspect Sent Params**: Click an API call on the left and switch to the **`Sent Params & Payload`** tab to verify query strings and JSON bodies sent to your backend.
5. **Search Inside Response**: Type any key or value into the second search bar (`Search inside Response / Payload JSON...`) to highlight matches and see the total match count.

---

## ⚙️ Props & Configuration

### `initSSRDebugger(config)` (Server)
| Option | Type | Default | Description |
|---|---|---|---|
| `maxLogs` | `number` | `100` | Maximum number of recent SSR requests kept in memory. |
| `ignoreUrls` | `string[]` | `[]` | Array of URL substrings to exclude from capture. |
| `endpoint` | `string` | `'/api/__nextjs-debugger'` | Internal bridge API route path. |

### `<ServerDebugger />` (Client)
| Prop | Type | Default | Description |
|---|---|---|---|
| `endpoint` | `string` | `'/api/__nextjs-debugger'` | Internal bridge API route path. |
| `pollInterval` | `number` | `1500` | Refresh interval in milliseconds while the drawer is open. |
| `position` | `'bottom-right' \| 'bottom-left'` | `'bottom-right'` | Screen corner for the floating toggle button. |
