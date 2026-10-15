import { NextResponse } from 'next/server';
import type { ApiLog, SSRDebuggerConfig } from './types';

const globalForDebugger = globalThis as unknown as {
  __NEXT_SSR_DEBUG_LOGS__: ApiLog[];
  __NEXT_SSR_FETCH_PATCHED__: boolean;
};

globalForDebugger.__NEXT_SSR_DEBUG_LOGS__ = globalForDebugger.__NEXT_SSR_DEBUG_LOGS__ || [];

export function initSSRDebugger(config?: SSRDebuggerConfig) {
  if (process.env.NODE_ENV !== 'development') return;
  if (globalForDebugger.__NEXT_SSR_FETCH_PATCHED__) return;

  const maxLogs = config?.maxLogs ?? 100;
  const endpoint = config?.endpoint ?? '/api/__nextjs-debugger';
  const ignorePatterns = [
    endpoint,
    '/_next/',
    '__nextjs_original-stack-frame',
    ...(config?.ignoreUrls ?? []),
  ];

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const startTime = performance.now();
    const urlString = input instanceof Request ? input.url : input.toString();

    if (ignorePatterns.some((pattern) => urlString.includes(pattern))) {
      return originalFetch(input, init);
    }

    let queryParams: Record<string, string> = {};
    let pathname = urlString;
    try {
      const parsedUrl = new URL(urlString, 'http://localhost');
      queryParams = Object.fromEntries(parsedUrl.searchParams.entries());
      pathname = parsedUrl.pathname;
    } catch {}

    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    // Capture request headers
    const requestHeaders: Record<string, string> = {};
    try {
      const headersObj = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      headersObj.forEach((val, key) => {
        requestHeaders[key] = val;
      });
    } catch {}

    // Capture request body / payload sent to backend
    let requestBody: any = null;
    if (init?.body) {
      if (typeof init.body === 'string') {
        try {
          requestBody = JSON.parse(init.body);
        } catch {
          requestBody = init.body;
        }
      } else {
        requestBody = '[Binary / FormData / Stream Payload]';
      }
    }

    try {
      const response = await originalFetch(input, init);
      const durationMs = Math.round(performance.now() - startTime);

      // Capture response headers
      const responseHeaders: Record<string, string> = {};
      try {
        response.headers.forEach((val, key) => {
          responseHeaders[key] = val;
        });
      } catch {}

      // Clone response so Next.js Server Components can still consume the stream
      const cloned = response.clone();
      let responseBody: any = null;
      try {
        const rawText = await cloned.text();
        try {
          responseBody = JSON.parse(rawText);
        } catch {
          responseBody = rawText.length > 5000 ? rawText.slice(0, 5000) + '... [Truncated]' : rawText;
        }
      } catch {
        responseBody = '[Unreadable Stream Payload]';
      }

      globalForDebugger.__NEXT_SSR_DEBUG_LOGS__.unshift({
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
      });

      if (globalForDebugger.__NEXT_SSR_DEBUG_LOGS__.length > maxLogs) {
        globalForDebugger.__NEXT_SSR_DEBUG_LOGS__.length = maxLogs;
      }

      return response;
    } catch (error: any) {
      const durationMs = Math.round(performance.now() - startTime);
      globalForDebugger.__NEXT_SSR_DEBUG_LOGS__.unshift({
        id: Math.random().toString(36).substring(2, 10) + Date.now().toString(36),
        url: urlString,
        pathname,
        method,
        queryParams,
        requestHeaders,
        requestBody,
        status: 0,
        statusText: 'NETWORK_ERROR',
        responseHeaders: {},
        responseBody: { error: error?.message || 'Fetch failed on server' },
        durationMs,
        timestamp: Date.now(),
        isError: true,
      });
      throw error;
    }
  };

  globalForDebugger.__NEXT_SSR_FETCH_PATCHED__ = true;
  console.log('✓ [next-ssr-debugger] Server-side fetch interceptor active');
}

export function createDebuggerRouteHandler() {
  return {
    GET: async () => {
      if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Disabled in production' }, { status: 403 });
      }
      return NextResponse.json(globalForDebugger.__NEXT_SSR_DEBUG_LOGS__ || []);
    },
    DELETE: async () => {
      if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Disabled in production' }, { status: 403 });
      }
      globalForDebugger.__NEXT_SSR_DEBUG_LOGS__ = [];
      return NextResponse.json({ cleared: true });
    },
  };
}

export type { ApiLog, SSRDebuggerConfig };
