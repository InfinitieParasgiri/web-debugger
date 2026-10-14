/** Adds public build metadata without changing rendering or existing Next.js settings. */
export function withDebugger(config = {}) {
  if (typeof config === 'function') return async (...args) => withDebugger(await config(...args));
  return { ...config, env: { ...config.env, NEXT_PUBLIC_WEB_DEBUGGER_MODE: config.output === 'export' ? 'static' : 'server' } };
}
