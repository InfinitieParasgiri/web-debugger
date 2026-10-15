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
        <ServerDebugger password={process.env.WEB_DEBUGGER_PASSWORD ?? ''} />
      </body>
    </html>
  );
}
```

## ⌨️ Production Shortcut
Use **Ctrl + Alt + `*` → `*`** on Windows, Mac, and other operating systems—even in production—to open the debugger drawer. Hold **Ctrl + Alt** and press the asterisk key **twice**, within 1.5 seconds between presses.

- **Number row:** Hold **Ctrl + Alt** and press the **8/* key twice**. **Shift is not required.**
- **Numpad:** Hold **Ctrl + Alt** and press the **multiply (`*`) key twice**.
- On Mac, **Alt means Option**; use **Control**, rather than Command.

The debugger starts completely hidden, without a floating button. Keep Ctrl and Alt held throughout both presses. Once open, repeating the shortcut keeps it open. Clicking or tapping outside the panel, or using its minimize button, minimizes it to a floating launcher without closing it or forgetting the tab's unlock. The shortcut or launcher reopens it. Close hides it completely. Visibility is remembered in the current browser tab, including across reloads; closing the browser tab ends the session. It only polls for logs while open.

Use **Enter** or **↓** in the details search to jump to the next match, and **Shift+Enter** or **↑** for the previous match. Search matches literal text in the selected response, payload, headers, or cURL tab.

The shortcut controls visibility only. For production use, protect the debugger API route with your application's existing authorization before exposing captured request and response data.

## Optional debugger password

Set the optional environment variable in your Next.js project:

```dotenv
WEB_DEBUGGER_PASSWORD=""
```

An empty or missing value skips the password prompt. A non-empty value enables the once-per-tab UI prompt. Pass the value from your **server** root layout (not a file with `'use client'`), as shown in Step 4:

```tsx
<ServerDebugger password={process.env.WEB_DEBUGGER_PASSWORD ?? ''} />
```

The package does not read your app's environment variable automatically; the server layout supplies it through the `password` prop. Restart or rebuild the Next.js app after changing its environment configuration. You can also omit `password` or pass an empty string to open directly with the shortcut. When a password is provided, enter it once per browser tab. Minimizing, closing, reopening, or reloading in that tab preserves the unlock. Closing the tab ends the session. If you already have a separate client-side password prompt, adapt that wrapper to use this prop so it does not prompt twice. Preserve any server-side authentication.

Only an unlock marker and panel visibility are stored in `sessionStorage`, never the password or captured logs. If browser storage is blocked, unlocking lasts while the component remains mounted. This is a client-side convenience gate: the password is available in client code, so it does not replace server-side authorization on the debugger API route.

The Network view includes status and method filters, request metadata, copy controls, and collapsible detail sections. The existing response, payload, headers, and cURL views remain available. Body sizes describe the serialized captured data, not compressed network transfer sizes. Polling pauses while minimized, hidden, or awaiting a password.
