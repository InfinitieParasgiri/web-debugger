// next-ssr-debugger/src/server.ts
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import https from 'https';
import zlib from 'zlib';
import type { ApiLog, SSRDebuggerConfig } from './types';

// Shared temp file so all Next.js workers/routes share the exact same logs
const CACHE_FILE = path.join(os.tmpdir(), '__nextjs_ssr_debug_logs__.json');

function readLogs(): ApiLog[] {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8') || '[]');
    }
  } catch {}
  return [];
}

function saveLog(newLog: ApiLog, maxLogs = 100) {
  try {
    const logs = readLogs();
    // Deduplicate if both fetch and http interceptors fire for the exact same request
    const isDuplicate = logs.some(
      (l) => l.url === newLog.url && l.method === newLog.method && Math.abs(l.timestamp - newLog.timestamp) < 50
    );
    if (isDuplicate) return;

    logs.unshift(newLog);
    if (logs.length > maxLogs) logs.length = maxLogs;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(logs), 'utf-8');
  } catch {}
}

function clearLogs() {
  try {
    fs.writeFileSync(CACHE_FILE, '[]', 'utf-8');
  } catch {}
}

function decompressBuffer(buffer: Buffer, encoding?: string): string {
  try {
    if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.gunzipSync(buffer).toString('utf-8');
    if (encoding === 'deflate') return zlib.inflateSync(buffer).toString('utf-8');
    if (encoding === 'br') return zlib.brotliDecompressSync(buffer).toString('utf-8');
  } catch {}
  return buffer.toString('utf-8');
}

const globalState = globalThis as unknown as {
  __NEXT_SSR_UNIVERSAL_PATCHED__?: boolean;
};

export function initSSRDebugger(config?: SSRDebuggerConfig) {
  if (process.env.NODE_ENV !== 'development') return;
  if (globalState.__NEXT_SSR_UNIVERSAL_PATCHED__) return;

  const maxLogs = config?.maxLogs ?? 100;
  const endpoint = config?.endpoint ?? '/api/__nextjs-debugger';
  const ignorePatterns = [
    endpoint,
    '/_next/',
    '__nextjs',
    ...(config?.ignoreUrls ?? []),
  ];

  const shouldIgnore = (url: string) => !url || ignorePatterns.some((p) => url.includes(p));

  // Helper to wrap ANY fetch function (even when Next.js replaces globalThis.fetch per request!)
  const wrapFetch = (targetFetch: typeof fetch): typeof fetch => {
    if ((targetFetch as any).__isWrappedByDebugger) return targetFetch;

    const wrapped = async function (input: RequestInfo | URL, init?: RequestInit) {
      const startTime = performance.now();
      const urlString =
        typeof input === 'string'
          ? input
          : input instanceof URL
          ? input.toString()
          : input?.url || String(input);

      if (shouldIgnore(urlString)) {
        return targetFetch(input, init);
      }

      let queryParams: Record<string, string> = {};
      let pathname = urlString;
      try {
        const parsedUrl = new URL(urlString, 'http://localhost');
        queryParams = Object.fromEntries(parsedUrl.searchParams.entries());
        pathname = parsedUrl.pathname;
      } catch {}

      const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

      const requestHeaders: Record<string, string> = {};
      try {
        const h = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        h.forEach((v, k) => (requestHeaders[k] = v));
      } catch {}

      let requestBody: any = null;
      if (init?.body && typeof init.body === 'string') {
        try {
          requestBody = JSON.parse(init.body);
        } catch {
          requestBody = init.body;
        }
      }

      try {
        const response = await targetFetch(input, init);
        const durationMs = Math.round(performance.now() - startTime);

        const responseHeaders: Record<string, string> = {};
        try {
          response.headers.forEach((v, k) => (responseHeaders[k] = v));
        } catch {}

        const cloned = response.clone();
        let responseBody: any = null;
        try {
          const text = await cloned.text();
          try {
            responseBody = JSON.parse(text);
          } catch {
            responseBody = text.slice(0, 5000);
          }
        } catch {}

        saveLog(
          {
            id: Math.random().toString(36).substring(2, 10) + Date.now().toString(36),
            url: urlString,
            pathname,
            method,
            queryParams,
            requestHeaders,
            requestBody,
            status: response.status,
            statusText: response.statusText || '',
            responseHeaders,
            responseBody,
            durationMs,
            timestamp: Date.now(),
            isError: response.status >= 400,
          },
          maxLogs
        );

        return response;
      } catch (err: any) {
        saveLog(
          {
            id: Math.random().toString(36).substring(2, 10) + Date.now().toString(36),
            url: urlString,
            pathname,
            method,
            queryParams,
            requestHeaders,
            requestBody,
            status: 0,
            statusText: 'FETCH_ERROR',
            responseHeaders: {},
            responseBody: { error: err?.message || 'Request failed' },
            durationMs: Math.round(performance.now() - startTime),
            timestamp: Date.now(),
            isError: true,
          },
          maxLogs
        );
        throw err;
      }
    };

    // Preserve any static properties Next.js attaches to fetch
    Object.assign(wrapped, targetFetch);
    (wrapped as any).__isWrappedByDebugger = true;
    return wrapped as typeof fetch;
  };

  // 1. Lock globalThis.fetch with a Getter/Setter so Next.js cannot overwrite our wrapper
  let currentFetch = wrapFetch(globalThis.fetch);
  try {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      enumerable: true,
      get() {
        return currentFetch;
      },
      set(newFetch) {
        currentFetch = wrapFetch(newFetch);
      },
    });
  } catch {
    globalThis.fetch = currentFetch;
  }

  // 2. Patch Node.js http & https (Catches Axios, Got, Superagent, Node native requests)
  const patchNodeHttp = (mod: typeof http | typeof https, defaultProtocol: string) => {
    const origRequest = mod.request;
    const origGet = mod.get;

    mod.request = function (this: any, ...args: any[]) {
      const startTime = performance.now();
      let urlString = '';
      let options: any = {};

      if (typeof args[0] === 'string' || args[0] instanceof URL) {
        urlString = args[0].toString();
        options = typeof args[1] === 'object' && args[1] !== null ? args[1] : {};
      } else if (typeof args[0] === 'object' && args[0] !== null) {
        options = args[0];
        const protocol = options.protocol || defaultProtocol;
        const host = options.hostname || options.host || 'localhost';
        const pathStr = options.path || options.pathname || '/';
        urlString = options.href || `${protocol}//${host}${pathStr}`;
      }

      const req = origRequest.apply(this, args as any);
      if (shouldIgnore(urlString)) return req;

      const reqChunks: Buffer[] = [];
      const origWrite = req.write;
      const origEnd = req.end;

      req.write = function (chunk: any, ...rest: any[]) {
        if (chunk) reqChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return origWrite.apply(this, [chunk, ...rest] as any);
      };

      req.end = function (chunk: any, ...rest: any[]) {
        if (chunk && typeof chunk !== 'function') {
          reqChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        return origEnd.apply(this, [chunk, ...rest] as any);
      };

      req.on('response', (res) => {
        const resChunks: Buffer[] = [];
        res.on('data', (chunk) => resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const durationMs = Math.round(performance.now() - startTime);

          let requestBody: any = null;
          if (reqChunks.length > 0) {
            const rawReq = Buffer.concat(reqChunks).toString('utf-8');
            try { requestBody = JSON.parse(rawReq); } catch { requestBody = rawReq; }
          }

          let responseBody: any = null;
          if (resChunks.length > 0) {
            const fullBuffer = Buffer.concat(resChunks);
            const decoded = decompressBuffer(fullBuffer, res.headers['content-encoding']);
            try { responseBody = JSON.parse(decoded); } catch { responseBody = decoded.slice(0, 5000); }
          }

          let queryParams: Record<string, string> = {};
          let pathname = urlString;
          try {
            const parsed = new URL(urlString, 'http://localhost');
            queryParams = Object.fromEntries(parsed.searchParams.entries());
            pathname = parsed.pathname;
          } catch {}

          saveLog(
            {
              id: Math.random().toString(36).substring(2, 10) + Date.now().toString(36),
              url: urlString,
              pathname,
              method: (req.method || options.method || 'GET').toUpperCase(),
              queryParams,
              requestHeaders: (req.getHeaders ? req.getHeaders() : {}) as Record<string, string>,
              requestBody,
              status: res.statusCode || 200,
              statusText: res.statusMessage || '',
              responseHeaders: (res.headers || {}) as Record<string, string>,
              responseBody,
              durationMs,
              timestamp: Date.now(),
              isError: (res.statusCode || 200) >= 400,
            },
            maxLogs
          );
        });
      });

      return req;
    } as any;

    mod.get = function (this: any, ...args: any[]) {
      const req = mod.request.apply(this, args as any);
      req.end();
      return req;
    } as any;
  };

  patchNodeHttp(http, 'http:');
  patchNodeHttp(https, 'https:');

  globalState.__NEXT_SSR_UNIVERSAL_PATCHED__ = true;
  console.log('✓ [next-ssr-debugger] Universal interceptor active (Fetch + Next Cache + Axios/HTTP)');
}

export function createDebuggerRouteHandler() {
  initSSRDebugger();
  return {
    GET: async () => {
      if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Disabled in production' }, { status: 403 });
      }
      return NextResponse.json(readLogs());
    },
    DELETE: async () => {
      clearLogs();
      return NextResponse.json({ cleared: true });
    },
  };
}

export type { ApiLog, SSRDebuggerConfig };