export interface ApiLog {
  id: string;
  url: string;
  pathname: string;
  method: string;
  queryParams: Record<string, string>;
  requestHeaders: Record<string, string>;
  requestBody: any;
  status: number;
  statusText: string;
  responseHeaders: Record<string, string>;
  responseBody: any;
  durationMs: number;
  timestamp: number;
  isError: boolean;
}

export interface SSRDebuggerConfig {
  /** Maximum number of server API logs to keep in memory (default: 100) */
  maxLogs?: number;
  /** Substrings of URLs to ignore from logging */
  ignoreUrls?: string[];
  /** Custom internal API route path if changed from default '/api/__nextjs-debugger' */
  endpoint?: string;
}
