export interface ServerDebuggerOptions {
  authorize: (request: Request | { headers: HeadersInit }) => boolean | Promise<boolean>;
  durationMinutes?: number;
  maxEntries?: number;
  maxBodyBytes?: number;
  redactKeys?: string[];
}
export function registerServerCapture(): void;
export function runWithDebugSession<T>(request: Request | { headers: HeadersInit }, callback: () => T | Promise<T>): Promise<T>;
export function withDebugCapture<A extends unknown[], T>(handler: (request: Request, ...args: A) => T | Promise<T>): (request: Request, ...args: A) => Promise<T>;
export function createDebuggerHandlers(options: ServerDebuggerOptions): {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
  DELETE(request: Request): Promise<Response>;
};
