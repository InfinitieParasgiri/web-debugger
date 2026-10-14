export interface DebuggerOptions {
  mode?: 'static' | 'server' | 'unknown';
  /** Required for production browser-only activation. Use your existing developer authentication. */
  authorize?: () => boolean | Promise<boolean>;
  /** Explicit opt-in for local development only. */
  development?: boolean;
  serverEndpoint?: string;
  durationMinutes?: number;
  maxEntries?: number;
  maxBodyBytes?: number;
  redactKeys?: string[];
}
export interface DebuggerController { enable(): Promise<boolean>; disable(): void; destroy(): void; }
export function initDebugger(options?: DebuggerOptions): DebuggerController;
