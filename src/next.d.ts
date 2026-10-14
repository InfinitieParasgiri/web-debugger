export function withDebugger<A extends unknown[], T extends object>(config: (...args: A) => T | Promise<T>): (...args: A) => Promise<T>;
export function withDebugger<T extends object = Record<string, unknown>>(config?: T): T & { env: Record<string, string | number | undefined> };
