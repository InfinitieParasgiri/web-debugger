'use client';

import { useEffect } from 'react';
import { initDebugger } from './browser.js';

/** Mount once in the root layout. Keep options stable to avoid restarting a session. */
export function WebDebugger({ mode, authorize, development, serverEndpoint, durationMinutes, maxEntries, maxBodyBytes, redactKeys } = {}) {
  useEffect(() => {
    const debuggerInstance = initDebugger({ mode: mode ?? process.env.NEXT_PUBLIC_WEB_DEBUGGER_MODE,
      development: development ?? process.env.NODE_ENV === 'development', authorize, serverEndpoint, durationMinutes, maxEntries, maxBodyBytes, redactKeys });
    return () => debuggerInstance.destroy();
  }, [mode, authorize, development, serverEndpoint, durationMinutes, maxEntries, maxBodyBytes, redactKeys]);
  return null;
}
