#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const cwd = process.cwd();
const hasSrc = fs.existsSync(path.join(cwd, 'src'));
const baseDir = hasSrc ? path.join(cwd, 'src') : cwd;

// 1. Create instrumentation.ts
const instrumentationPath = path.join(baseDir, 'instrumentation.ts');
const instrumentationCode = `export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSSRDebugger } = await import('next-ssr-debugger/server');
    initSSRDebugger();
  }
}
`;

if (!fs.existsSync(instrumentationPath)) {
  fs.writeFileSync(instrumentationPath, instrumentationCode, 'utf8');
  console.log('✓ Created', path.relative(cwd, instrumentationPath));
} else {
  console.log('ℹ Skipped', path.relative(cwd, instrumentationPath), '(already exists)');
}

// 2. Create API route handler: app/api/__nextjs-debugger/route.ts
const routeDir = path.join(baseDir, 'app', 'api', '__nextjs-debugger');
const routePath = path.join(routeDir, 'route.ts');
const routeCode = `import { createDebuggerRouteHandler } from 'next-ssr-debugger/server';

export const { GET, DELETE } = createDebuggerRouteHandler();
`;

fs.mkdirSync(routeDir, { recursive: true });
fs.writeFileSync(routePath, routeCode, 'utf8');
console.log('✓ Created', path.relative(cwd, routePath));

console.log('\n🎉 Almost done! Add <ServerDebugger /> to your root app/layout.tsx:');
console.log('   import { ServerDebugger } from "next-ssr-debugger/client";');
