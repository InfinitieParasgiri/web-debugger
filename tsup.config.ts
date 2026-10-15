import { defineConfig } from 'tsup';

export default defineConfig([
  // 1. Server Bundle (Node.js runtime for instrumentation.ts & API routes)
  {
    entry: { server: 'src/server.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    external: ['next', 'react'],
  },
  // 2. Client Bundle (Browser React Devtools UI with "use client" directive)
  {
    entry: { client: 'src/client.tsx' },
    format: ['cjs', 'esm'],
    dts: true,
    clean: false,
    external: ['react', 'react-dom', 'next'],
    esbuildOptions(options) {
      options.banner = {
        js: '"use client";',
      };
    },
  },
]);
