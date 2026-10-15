# ⚡ web-debugger

A lightweight server-side network & API debugger for Next.js (App Router, RSC, Fetch, & Axios).

## 🚀 Setup Guide (3 Simple Steps)

### Step 1: Install
```bash
npm install git+https://github.com/InfinitieParasgiri/web-debugger.git#main
```

### Step 2: Create `src/instrumentation.ts` (or in root folder)
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSSRDebugger } = await import('web-debugger/server');
    initSSRDebugger();
  }
}
```
*(Next.js 13/14 users: enable `experimental: { instrumentationHook: true }` in `next.config.js`)*

### Step 3: Create API Route Handler (`src/app/api/__nextjs-debugger/route.ts`)
```typescript
import { createDebuggerRouteHandler } from 'web-debugger/server';

export const { GET, POST, DELETE } = createDebuggerRouteHandler();
```

### Step 4: Add to Root Layout (`src/app/layout.tsx`)
```tsx
import { ServerDebugger } from 'web-debugger/client';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServerDebugger />
      </body>
    </html>
  );
}
```

## ⌨️ Production Shortcut
Use the shortcut for your platform anywhere in your app—even in production—to toggle the debugger drawer open or closed:

- **Windows:** Hold **`Ctrl + Shift`** and press **`3`**, then **`5`**. The zero is omitted to avoid Windows shortcut conflicts.
- **Mac and other platforms:** Hold **`Ctrl + Shift`** (or **`Cmd + Shift`** on Mac) and press **`3`**, then **`0`**, then **`5`**.

The debugger starts completely hidden, without a floating button. Hold the modifiers while pressing the digits in order (within 1.5 seconds between digits). The same shortcut minimizes it to a floating launcher; click the launcher to reopen it. The minimize button does the same, while the close button hides it completely. Visibility is remembered in the current browser tab, including across reloads. It only polls for logs while open.

Use **Enter** or **↓** in the details search to jump to the next match, and **Shift+Enter** or **↑** for the previous match. Search matches literal text in the selected response, payload, headers, or cURL tab.

The shortcut controls visibility only. For production use, protect the debugger API route with your application's existing authorization before exposing captured request and response data.

## Optional debugger password

Pass your configured password from your Next.js client wrapper:

```tsx
<ServerDebugger password={debuggerPassword} />
```

Omit `password` or pass an empty string to open directly with the platform shortcut. When a password is provided, enter it once per browser tab. Minimizing, closing, reopening, or reloading in that tab preserves the unlock. Closing the tab ends the session. If you already have a separate client-side password prompt, adapt that wrapper to use this prop so it does not prompt twice. Preserve any server-side authentication.

Only an unlock marker and panel visibility are stored in `sessionStorage`, never the password or captured logs. If browser storage is blocked, unlocking lasts while the component remains mounted. This is a client-side convenience gate: the password is available in client code, so it does not replace server-side authorization on the debugger API route.

The Network view includes status and method filters, request metadata, copy controls, and collapsible detail sections. The existing response, payload, headers, and cURL views remain available. Body sizes describe the serialized captured data, not compressed network transfer sizes. Polling pauses while minimized, hidden, or awaiting a password.
