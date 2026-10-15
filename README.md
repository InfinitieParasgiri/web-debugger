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
Hold **`Ctrl + Shift`** (or **`Cmd + Shift`** on Mac) and press **`3`**, then **`0`**, then **`5`** sequentially anywhere in your app—even in production—to toggle the debugger drawer open or closed!
