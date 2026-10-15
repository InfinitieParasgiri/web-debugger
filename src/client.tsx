import React, { useState, useEffect, useMemo, useRef, useId, useCallback } from 'react';
import type { ApiLog } from './types';

const ICON_PATHS = {
  code: 'M8 5 1 12l7 7M16 5l7 7-7 7',
  search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  refresh: 'M20 7v5h-5M20 12a8 8 0 1 0-2 5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  minimize: 'M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  lock: 'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4M12 14v3',
  network: 'M4 4h16v6H4zM12 10v6M4 20v-4h16v4M8 7h.01M12 7h.01',
};

function DebuggerIcon({ name }: { name: keyof typeof ICON_PATHS }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON_PATHS[name]} /></svg>;
}

function formatDuration(duration: number) {
  return duration >= 1000 ? `${(duration / 1000).toFixed(2)} s` : `${duration} ms`;
}

function formatTime(timestamp: number) {
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleTimeString('en-GB', { hour12: false }) : '—';
}

function formatBytes(value: unknown) {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value) || '';
  const bytes = new TextEncoder().encode(text).length;
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

const DEBUGGER_STYLES = `
  .ssr-debugger, .ssr-debugger *, .ssr-debugger-launcher, .ssr-debugger-launcher * { box-sizing: border-box; }
  .ssr-debugger {
    --debug-bg: #111419; --debug-raised: #181c24; --debug-border: #292e39;
    --debug-text: #dfe3eb; --debug-muted: #818b9d; --debug-accent: #22d3ee;
    position: fixed; inset: auto 12px 12px; height: min(740px, 88dvh); max-height: calc(100dvh - 24px);
    z-index: 999999; display: flex; flex-direction: column; overflow: hidden;
    color: var(--debug-text); background: var(--debug-bg); color-scheme: dark;
    border: 1px solid var(--debug-border); border-radius: 12px;
    box-shadow: 0 16px 64px #0009, 0 0 0 1px #0003;
    font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    text-align: left; letter-spacing: normal;
  }
  .ssr-debugger * { scrollbar-width: thin; scrollbar-color: #404550 transparent; }
  .ssr-debugger button, .ssr-debugger input { font: inherit; color: inherit; letter-spacing: inherit; }
  .ssr-debugger button { cursor: pointer; border: 1px solid var(--debug-border); border-radius: 6px; background: var(--debug-raised); padding: 6px 10px; line-height: 1.5; text-transform: none; }
  .ssr-debugger button:hover { background: #222834; color: #f5f7fb; }
  .ssr-debugger button:disabled { cursor: default; opacity: .45; }
  .ssr-debugger :is(button,input):focus-visible, .ssr-debugger-launcher:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
  .ssr-debugger input { min-width: 0; background: transparent; border: 0; outline: none; box-shadow: none; padding: 7px 10px; border-radius: 5px; }
  .ssr-debugger input::placeholder { color: #626d80; opacity: 1; }
  .ssr-debugger svg { flex-shrink: 0; display: inline-block; vertical-align: middle; }
  .ssr-debugger .debugger-header { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 9px 14px; background: var(--debug-raised); border-bottom: 1px solid var(--debug-border); flex-shrink: 0; }
  .ssr-debugger .debugger-brand { display: flex; gap: 8px; align-items: center; white-space: nowrap; font-family: system-ui, sans-serif; font-size: 13px; }
  .ssr-debugger .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 4px #34d39918; }
  .ssr-debugger .request-count { color: var(--debug-muted); font-size: 11px; }
  .ssr-debugger .header-actions { display: flex; gap: 7px; align-items: center; margin-left: auto; }
  .ssr-debugger .icon-button { display: inline-flex; align-items: center; justify-content: center; width: 29px; height: 29px; padding: 4px; color: #949daf; flex-shrink: 0; }
  .ssr-debugger .network-heading { display: flex; gap: 18px; align-items: center; padding: 0 16px; min-height: 40px; border-bottom: 1px solid var(--debug-border); flex-shrink: 0; }
  .ssr-debugger .network-heading > span:first-child { align-self: stretch; display: flex; align-items: center; gap: 7px; border-bottom: 2px solid var(--debug-accent); color: var(--debug-accent); font-family: system-ui, sans-serif; font-weight: 600; }
  .ssr-debugger .network-heading b { background: #22d3ee18; border-radius: 5px; padding: 0 5px; font: 10px/1.6 ui-monospace, monospace; }
  .ssr-debugger .network-description { color: #697487; font-size: 10px; }
  .ssr-debugger .request-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--debug-border); flex-shrink: 0; }
  .ssr-debugger .request-search { display: flex; align-items: center; flex: 1 1 240px; min-width: 150px; background: var(--debug-raised); border: 1px solid var(--debug-border); border-radius: 6px; padding-left: 10px; color: #626d80; }
  .ssr-debugger .request-search input { width: 100%; color: var(--debug-text); }
  .ssr-debugger .filter-group { display: flex; gap: 6px; }
  .ssr-debugger .filter-group button { background: transparent; color: #929caf; padding: 6px 9px; font-size: 10px; white-space: nowrap; }
  .ssr-debugger .filter-group button[aria-pressed="true"] { color: #67e8f9; border-color: #22d3ee66; background: #22d3ee0d; }
  .ssr-debugger .main-split { display: flex; flex: 1; min-height: 0; overflow: hidden; }
  .ssr-debugger .request-list { flex: 0 0 32%; min-width: 230px; overflow-y: auto; border-right: 1px solid var(--debug-border); }
  .ssr-debugger .request-row { display: block; width: 100%; text-align: left; padding: 10px 12px; border: 0; border-bottom: 1px solid var(--debug-border); border-left: 2px solid transparent; border-radius: 0; background: transparent; }
  .ssr-debugger .request-row[aria-pressed="true"] { border-left-color: var(--debug-accent); background: #22d3ee0b; }
  .ssr-debugger .request-row-main { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .ssr-debugger .method-badge { display: inline-block; flex-shrink: 0; padding: 1px 5px; border-radius: 4px; background: #22d3ee22; color: #67e8f9; font-size: 10px; font-weight: 700; }
  .ssr-debugger .method-post { color: #6ee7b7; background: #34d39922; }
  .ssr-debugger .method-put, .ssr-debugger .method-patch { color: #fcd34d; background: #fbbf2422; }
  .ssr-debugger .method-delete { color: #fda4af; background: #fb718522; }
  .ssr-debugger .request-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; font-size: 11px; }
  .ssr-debugger .request-dot { width: 6px; height: 6px; border-radius: 50%; background: #34d399; flex-shrink: 0; }
  .ssr-debugger .request-dot.failed { background: #fb7185; }
  .ssr-debugger .request-row-meta { display: flex; gap: 9px; color: #626d80; margin-top: 4px; font-size: 10px; }
  .ssr-debugger .request-details { display: flex; flex-direction: column; flex: 1; min-width: 0; overflow: hidden; }
  .ssr-debugger .detail-scroll { overflow: auto; padding: 16px; flex: 1; min-height: 0; }
  .ssr-debugger .request-title { display: flex; align-items: baseline; gap: 8px; margin-bottom: 16px; overflow-wrap: anywhere; }
  .ssr-debugger .request-metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; background: var(--debug-raised); border: 1px solid var(--debug-border); border-radius: 8px; padding: 14px 12px; margin: 0 0 16px; }
  .ssr-debugger .request-metrics dt { color: #697487; font: 9px/1.5 system-ui, sans-serif; text-transform: uppercase; letter-spacing: .6px; margin: 0 0 4px; }
  .ssr-debugger .request-metrics dd { margin: 0; overflow-wrap: anywhere; font-size: 11px; }
  .ssr-debugger .success-text { color: #34d399; }
  .ssr-debugger .failed-text { color: #fb7185; }
  .ssr-debugger .copy-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
  .ssr-debugger .copy-actions button { font: 600 10px/1.5 system-ui, sans-serif; }
  .ssr-debugger .copy-actions > span { color: #6ee7b7; font-size: 10px; }
  .ssr-debugger .detail-tabs { display: flex; overflow-x: auto; gap: 3px; border-bottom: 1px solid var(--debug-border); margin-bottom: 10px; }
  .ssr-debugger .detail-tabs button { white-space: nowrap; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--debug-muted); font-size: 10px; padding: 8px 10px; }
  .ssr-debugger .detail-tabs button[aria-pressed="true"] { color: var(--debug-accent); border-bottom-color: var(--debug-accent); }
  .ssr-debugger .detail-search { display: flex; align-items: center; gap: 5px; border: 1px solid var(--debug-border); border-radius: 6px; background: var(--debug-raised); padding: 0 7px; color: #697487; margin-bottom: 14px; }
  .ssr-debugger .detail-search input { flex: 1; color: var(--debug-text); }
  .ssr-debugger .detail-search > span { white-space: nowrap; color: #a4aebf; font-size: 10px; }
  .ssr-debugger .detail-search button { width: 23px; height: 25px; }
  .ssr-debugger .detail-card { border: 1px solid var(--debug-border); border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
  .ssr-debugger .section-toggle { width: 100%; display: flex; justify-content: space-between; gap: 8px; text-align: left; border: 0; border-radius: 0; padding: 9px 11px; font: 600 11px/1.5 system-ui, sans-serif; }
  .ssr-debugger .section-count { color: #8d97a8; font-weight: 400; }
  .ssr-debugger pre { margin: 0; padding: 12px; white-space: pre; overflow: auto; color: #dfe3eb; background: #101318; font: 11px/1.7 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; tab-size: 2; }
  .ssr-debugger .curl-content { white-space: pre-wrap; overflow-wrap: anywhere; }
  .ssr-debugger [hidden] { display: none; }
  .ssr-debugger .empty-state { padding: 40px 22px; text-align: center; color: var(--debug-muted); margin: auto; }
  .ssr-debugger .empty-state svg { width: 25px; height: 25px; display: block; margin: 0 auto 12px; color: #566174; }
  .ssr-debugger .empty-state strong { display: block; color: #aab3c3; font-family: system-ui, sans-serif; font-weight: 500; }
  .ssr-debugger .empty-state p { font-size: 10px; line-height: 1.8; max-width: 320px; margin: 7px auto 0; }
  .ssr-debugger .fetch-error { color: #fda4af; background: #fb71850a; border-bottom: 1px solid #fb718533; padding: 7px 14px; font-size: 11px; flex-shrink: 0; }
  .ssr-debugger .debugger-footer { display: flex; justify-content: space-between; gap: 10px; padding: 6px 14px; border-top: 1px solid var(--debug-border); color: #626d80; font: 10px/1.5 system-ui, sans-serif; flex-shrink: 0; }
  .ssr-debugger kbd { display: inline-block; border: 1px solid var(--debug-border); background: var(--debug-raised); border-radius: 3px; font: 9px/1.4 ui-monospace, monospace; padding: 0 4px; }
  .ssr-debugger.is-locked { width: min(430px, calc(100vw - 24px)); height: auto; left: auto; }
  .ssr-debugger .unlock-panel { padding: 26px; overflow-y: auto; }
  .ssr-debugger .unlock-icon { display: inline-flex; padding: 10px; border: 1px solid #22d3ee33; color: #67e8f9; border-radius: 10px; background: #22d3ee0a; }
  .ssr-debugger .unlock-panel h2 { font: 600 17px/1.5 system-ui, sans-serif; margin: 14px 0 6px; color: var(--debug-text); }
  .ssr-debugger .unlock-panel p { font: 12px/1.8 system-ui, sans-serif; color: var(--debug-muted); margin: 0 0 18px; }
  .ssr-debugger .unlock-panel label { display: block; color: #aab3c3; font: 11px/1.5 system-ui, sans-serif; margin-bottom: 6px; }
  .ssr-debugger .unlock-panel input { display: block; width: 100%; border: 1px solid var(--debug-border); background: var(--debug-raised); padding: 10px; margin-bottom: 12px; }
  .ssr-debugger .unlock-panel .password-error { color: #fda4af; margin-bottom: 12px; }
  .ssr-debugger .unlock-panel .primary-button { width: 100%; background: #22d3ee; color: #082f49; border-color: #22d3ee; font: 600 12px/1.5 system-ui, sans-serif; padding: 9px; }
  .ssr-debugger-launcher { position: fixed; bottom: 20px; display: flex; align-items: center; justify-content: center; width: 54px; height: 54px; padding: 0; border: 1px solid #2c3440; border-radius: 50%; background: #111419; color: #22d3ee; box-shadow: 0 6px 24px #0008; z-index: 999999; cursor: pointer; }
  .ssr-debugger-launcher > svg { width: 22px; height: 22px; }
  .ssr-debugger-launcher > span { position: absolute; top: -4px; right: -4px; min-width: 21px; height: 21px; padding: 0 5px; border-radius: 20px; border: 2px solid #111419; background: #22d3ee; color: #082f49; font: 700 10px/17px ui-monospace, monospace; text-align: center; }
  .ssr-debugger-launcher > span.has-errors { background: #fb7185; color: #4c0519; }
  .ssr-debugger-launcher:hover { background: #1b2029; }
  @media (max-width: 800px) {
    .ssr-debugger .request-search { flex-basis: 100%; }
    .ssr-debugger .request-list { min-width: 200px; }
    .ssr-debugger .request-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  @media (max-width: 540px) {
    .ssr-debugger { inset: auto 6px 6px; max-height: calc(100dvh - 12px); height: 92dvh; border-radius: 10px; }
    .ssr-debugger .debugger-header { gap: 6px; padding: 9px 10px; flex-wrap: wrap; }
    .ssr-debugger .request-count { font-size: 9px; order: 3; flex-basis: 100%; }
    .ssr-debugger .header-actions { gap: 5px; }
    .ssr-debugger .network-heading { padding: 0 10px; }
    .ssr-debugger .request-toolbar { padding: 8px 10px; gap: 6px; }
    .ssr-debugger .filter-group button { padding: 5px 7px; }
    .ssr-debugger .method-filters { flex: 1; overflow-x: auto; }
    .ssr-debugger .main-split { flex-direction: column; }
    .ssr-debugger .request-list { flex: 0 0 25%; width: 100%; min-width: 0; border-right: 0; border-bottom: 1px solid var(--debug-border); }
    .ssr-debugger .detail-scroll { padding: 12px; }
    .ssr-debugger .debugger-footer > span:last-child { display: none; }
    .ssr-debugger.is-locked { width: calc(100vw - 12px); }
  }
`;

export interface ServerDebuggerProps {
  endpoint?: string;
  pollInterval?: number;
  position?: 'bottom-right' | 'bottom-left';
  /** Optional client-side UI gate. Protect the API route separately. */
  password?: string;
}

export function ServerDebugger({
  endpoint = '/api/__nextjs-debugger',
  pollInterval = 1500,
  position = 'bottom-right',
  password = '',
}: ServerDebuggerProps) {
  const [view, setView] = useState<'hidden' | 'open' | 'minimized'>('hidden');
  const [viewRestored, setViewRestored] = useState(false);
  const [unlockedEndpoint, setUnlockedEndpoint] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [fetchError, setFetchError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isOpen = view === 'open';
  const unlockStorageKey = `next-ssr-debugger:unlocked:${endpoint}`;
  const canInspect = !password || unlockedEndpoint === unlockStorageKey;
  const detailsId = useId();
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'response' | 'params' | 'headers' | 'curl'>('overview');

  const [apiSearch, setApiSearch] = useState('');
  const [jsonSearch, setJsonSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('ALL');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const responsePreRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const keySequenceRef = useRef<string[]>([]);
  const sequenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Only visibility and an unlock marker are saved. Never persist passwords or API logs.
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem('next-ssr-debugger:view');
      if (saved === 'open' || saved === 'minimized') setView(saved);
    } catch {}
    setViewRestored(true);
  }, []);

  useEffect(() => {
    if (!viewRestored) return;
    try { window.sessionStorage.setItem('next-ssr-debugger:view', view); } catch {}
  }, [view, viewRestored]);

  useEffect(() => {
    let unlocked = !password;
    try { unlocked ||= window.sessionStorage.getItem(unlockStorageKey) === 'true'; } catch {}
    setUnlockedEndpoint(unlocked ? unlockStorageKey : null);
    setPasswordInput('');
    setPasswordError('');
  }, [password, unlockStorageKey]);

  const unlockDebugger = () => {
    if (passwordInput !== password) {
      setPasswordError('Incorrect password. Please try again.');
      return;
    }
    try { window.sessionStorage.setItem(unlockStorageKey, 'true'); } catch {}
    setUnlockedEndpoint(unlockStorageKey);
    setPasswordInput('');
    setPasswordError('');
  };

  const hideDebugger = useCallback((nextView: 'hidden' | 'minimized') => {
    setView(nextView);
    setPasswordInput('');
    setPasswordError('');
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && panelRef.current && !panelRef.current.contains(event.target)) {
        hideDebugger('minimized');
      }
    };
    document.addEventListener('pointerdown', handleOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer, true);
  }, [isOpen, hideDebugger]);

  // Ctrl + Alt + * twice, using either the number row or the numpad.
  useEffect(() => {
    const resetSequence = () => {
      keySequenceRef.current = [];
      if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing) return;
      if (!e.ctrlKey || !e.altKey || e.metaKey) {
        resetSequence();
        return;
      }
      if (['Control', 'Alt', 'Shift'].includes(e.key)) return;
      // Recognize the physical 8/* key without requiring Shift, including on Mac.
      const isAsterisk = e.key === '*' || e.code === 'NumpadMultiply'
        || e.code === 'Digit8';
      if (!isAsterisk) {
        resetSequence();
        return;
      }
      e.preventDefault();
      keySequenceRef.current.push('*');
      if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
      if (keySequenceRef.current.join('') === '**') {
        setView('open');
        resetSequence();
      } else {
        sequenceTimerRef.current = setTimeout(resetSequence, 1500);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.altKey) resetSequence();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', resetSequence);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', resetSequence);
      resetSequence();
    };
  }, []);

  const fetchLogs = async () => {
    if (!canInspect) return;
    setIsLoading(true);
    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('Invalid response');
        setLogs(data);
        setFetchError('');
      } else {
        setFetchError(`Could not load requests (HTTP ${res.status}).`);
      }
    } catch {
      setFetchError('Could not reach the debugger endpoint. Try refreshing.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !canInspect) return;
    fetchLogs();
    const timer = setInterval(fetchLogs, pollInterval);
    return () => clearInterval(timer);
  }, [isOpen, endpoint, pollInterval, canInspect]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (statusFilter === 'success' && log.isError) return false;
      if (statusFilter === 'failed' && !log.isError) return false;
      if (methodFilter !== 'ALL' && log.method !== methodFilter) return false;
      if (!apiSearch.trim()) return true;
      const target = `${log.method} ${log.status} ${log.url} ${JSON.stringify(log.queryParams)} ${JSON.stringify(log.requestBody)}`.toLowerCase();
      return target.includes(apiSearch.toLowerCase());
    });
  }, [logs, apiSearch, methodFilter, statusFilter]);

  const activeLog = useMemo(() => {
    return filteredLogs.find((l) => l.id === selectedId) || filteredLogs[0] || null;
  }, [filteredLogs, selectedId]);

  const buildCurlCommand = (log: ApiLog) => {
    let cmd = `curl -X ${log.method} "${log.url}"`;
    Object.entries(log.requestHeaders || {}).forEach(([k, v]) => {
      cmd += ` \
  -H "${k}: ${v}"`;
    });
    if (log.requestBody) {
      const bodyStr = typeof log.requestBody === 'string' ? log.requestBody : JSON.stringify(log.requestBody);
      cmd += ` \
  -d '${bodyStr.replace(/'/g, "'\''")}'`;
    }
    return cmd;
  };

  const activeJsonData = useMemo(() => {
    if (!activeLog) return '';
    if (activeTab === 'response') return activeLog.responseBody;
    if (activeTab === 'params') return { queryParams: activeLog.queryParams, requestBody: activeLog.requestBody };
    if (activeTab === 'headers') return { requestHeaders: activeLog.requestHeaders, responseHeaders: activeLog.responseHeaders };
    return activeLog;
  }, [activeLog, activeTab]);

  // Search exactly the text rendered in each tab, including both header/payload sections.
  const contentSections = useMemo<{ label: string; text: string; count?: number; defaultOpen: boolean }[]>(() => {
    const format = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) || 'null';
    if (!activeLog) return [];
    const sections = {
      curl: { label: 'cURL command', text: buildCurlCommand(activeLog), defaultOpen: true },
      query: { label: 'Query parameters', text: format(activeLog.queryParams), count: Object.keys(activeLog.queryParams || {}).length, defaultOpen: false },
      requestHeaders: { label: 'Request headers', text: format(activeLog.requestHeaders), count: Object.keys(activeLog.requestHeaders || {}).length, defaultOpen: false },
      requestBody: { label: 'Request body', text: activeLog.requestBody == null ? 'No body' : format(activeLog.requestBody), defaultOpen: true },
      responseHeaders: { label: 'Response headers', text: format(activeLog.responseHeaders), count: Object.keys(activeLog.responseHeaders || {}).length, defaultOpen: false },
      response: { label: 'Response body', text: format(activeLog.responseBody), defaultOpen: true },
    };
    if (activeTab === 'params') return [sections.query, sections.requestBody];
    if (activeTab === 'headers') return [sections.requestHeaders, sections.responseHeaders];
    if (activeTab === 'curl') return [sections.curl];
    if (activeTab === 'response') return [sections.response];
    return Object.values(sections);
  }, [activeLog, activeTab]);

  const formattedJsonString = contentSections.map((section) => section.text).join('\n');

  const matchIndices = useMemo(() => {
    if (!jsonSearch.trim() || !formattedJsonString) return [];
    const escaped = jsonSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const indices: number[] = [];
    let match;
    while ((match = regex.exec(formattedJsonString)) !== null) {
      indices.push(match.index);
    }
    return indices;
  }, [jsonSearch, formattedJsonString]);

  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [jsonSearch, selectedId, activeLog?.id, activeTab, formattedJsonString]);

  const scrollToMatch = (index: number) => {
    if (matchIndices.length === 0 || !responsePreRef.current) return;
    const marks = responsePreRef.current.querySelectorAll('mark');
    if (marks[index]) {
      marks[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  useEffect(() => {
    if (isOpen) scrollToMatch(currentMatchIndex);
  }, [isOpen, currentMatchIndex, jsonSearch, formattedJsonString, activeTab]);

  const handleNextMatch = () => {
    if (matchIndices.length === 0) return;
    const next = (currentMatchIndex + 1) % matchIndices.length;
    setCurrentMatchIndex(next);
    if (next === currentMatchIndex) scrollToMatch(next);
  };

  const handlePrevMatch = () => {
    if (matchIndices.length === 0) return;
    const prev = (currentMatchIndex - 1 + matchIndices.length) % matchIndices.length;
    setCurrentMatchIndex(prev);
    if (prev === currentMatchIndex) scrollToMatch(prev);
  };

  const renderHighlightedJson = (text: string, query: string, matchOffset = 0) => {
    if (!query.trim()) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));

    let globalMatchCount = matchOffset;
    return parts.map((part, index) => {
      const isMatch = part.toLowerCase() === query.toLowerCase();
      if (isMatch) {
        const currentIdx = globalMatchCount++;
        const isActive = currentIdx === currentMatchIndex;
        return (
          <mark
            key={index}
            style={{
              background: isActive ? '#f97316' : '#eab308',
              color: '#000',
              padding: '1px 0',
              borderRadius: 3,
              fontWeight: 700,
              outline: isActive ? '1px solid #fdba74' : 'none',
              transition: 'all 0.2s ease',
            }}
          >
            {part}
          </mark>
        );
      }
      return part;
    });
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(label);
    } catch {
      setCopiedText('Copy failed. Try again.');
    }
    setTimeout(() => setCopiedText(null), 1800);
  };

  const clearLogs = async () => {
    try {
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (!res.ok) throw new Error('Clear failed');
      setLogs([]);
      setSelectedId(null);
      setFetchError('');
    } catch {
      setFetchError('Could not clear requests. Try again.');
    }
  };

  const errorCount = logs.filter((log) => log.isError).length;
  const shortcutLabel = 'Ctrl + Alt + * → *';

  if (view === 'hidden') return null;

  return (
    <>
      <style>{DEBUGGER_STYLES}</style>
      {view === 'minimized' ? (
        <button
          type="button"
          className="ssr-debugger-launcher"
          aria-label="Open debugger"
          title="Open API Debugger"
          onClick={() => setView('open')}
          style={position === 'bottom-left' ? { left: 20 } : { right: 20 }}
        >
          <DebuggerIcon name="code" />
          {canInspect && logs.length > 0 && <span className={errorCount ? 'has-errors' : ''}>{logs.length}</span>}
        </button>
      ) : (
        <section ref={panelRef} className={`ssr-debugger${canInspect ? '' : ' is-locked'}`} aria-label="Web debugger">
          <header className="debugger-header">
            <div className="debugger-brand"><span className="live-dot" /><strong>API Debugger</strong></div>
            {canInspect && <span className="request-count">{logs.length} requests · {errorCount} failed</span>}
            <div className="header-actions">
              {canInspect && <>
                <button type="button" className="icon-button" aria-label="Refresh" title="Refresh requests" onClick={fetchLogs} disabled={isLoading}><DebuggerIcon name="refresh" /></button>
                <button type="button" className="icon-button" aria-label="Clear" title="Clear requests" onClick={clearLogs}><DebuggerIcon name="trash" /></button>
              </>}
              <button type="button" className="icon-button" aria-label="Minimize debugger" title="Minimize debugger" onClick={() => hideDebugger('minimized')}><DebuggerIcon name="minimize" /></button>
              <button type="button" className="icon-button" aria-label="Close debugger" title={`Hide debugger (${shortcutLabel})`} onClick={() => hideDebugger('hidden')}><DebuggerIcon name="close" /></button>
            </div>
          </header>

          {!canInspect ? (
            <div className="unlock-panel">
              <span className="unlock-icon"><DebuggerIcon name="lock" /></span>
              <h2>Unlock API Debugger</h2>
              <p>Enter your debugger password. You only need to unlock once in this browser tab.</p>
              <label htmlFor={`${detailsId}-password`}>Password</label>
              <input id={`${detailsId}-password`} type="password" autoComplete="off" autoFocus value={passwordInput}
                aria-invalid={!!passwordError} aria-describedby={passwordError ? `${detailsId}-password-error` : undefined}
                onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); unlockDebugger(); } }} />
              {passwordError && <p id={`${detailsId}-password-error`} className="password-error" role="alert">{passwordError}</p>}
              <button type="button" className="primary-button" onClick={unlockDebugger}>Unlock debugger</button>
            </div>
          ) : <>
            <div className="network-heading"><span>Network <b>{logs.length}</b></span><span className="network-description">Server-side requests</span></div>
            <div className="request-toolbar">
              <div className="request-search"><DebuggerIcon name="search" /><input aria-label="Search requests" placeholder="Filter by URL, endpoint, method or status code…" value={apiSearch} onChange={(e) => setApiSearch(e.target.value)} /></div>
              <div className="filter-group" aria-label="Filter by request status">
                <button type="button" aria-pressed={statusFilter === 'success'} onClick={() => setStatusFilter(statusFilter === 'success' ? 'all' : 'success')}>Success</button>
                <button type="button" aria-pressed={statusFilter === 'failed'} onClick={() => setStatusFilter(statusFilter === 'failed' ? 'all' : 'failed')}>Failed</button>
              </div>
              <div className="filter-group method-filters" aria-label="Filter requests by HTTP method">
                {['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => <button type="button" key={method} aria-pressed={methodFilter === method} onClick={() => setMethodFilter(methodFilter === method ? 'ALL' : method)}>{method}</button>)}
              </div>
            </div>
            {fetchError && <div className="fetch-error" role="alert">{fetchError}</div>}
            <div className="main-split">
              <nav className="request-list" aria-label="Captured requests">
                {filteredLogs.length === 0 ? (
                  <div className="empty-state"><DebuggerIcon name="network" /><strong>{logs.length ? 'No matching requests' : isLoading ? 'Loading requests…' : 'Waiting for requests'}</strong><p>{logs.length ? 'Try another search, status or method.' : 'Trigger a server action or load a page to capture requests.'}</p></div>
                ) : filteredLogs.map((log) => (
                  <button type="button" key={log.id} className="request-row" aria-pressed={activeLog?.id === log.id} onClick={() => setSelectedId(log.id)} title={log.url}>
                    <span className="request-row-main"><span className={`method-badge method-${log.method.toLowerCase()}`}>{log.method}</span><span className="request-path">{log.pathname || log.url}</span><span className={`request-dot ${log.isError ? 'failed' : ''}`} /></span>
                    <span className="request-row-meta"><span className={log.isError ? 'failed-text' : ''}>{log.status || 'ERR'}</span><span>{formatDuration(log.durationMs)}</span><time>{formatTime(log.timestamp)}</time></span>
                  </button>
                ))}
              </nav>
              <div className="request-details">
                {activeLog ? <>
                  <div className="detail-scroll" ref={responsePreRef}>
                    <div className="request-title"><span className={`method-badge method-${activeLog.method.toLowerCase()}`}>{activeLog.method}</span><span>{activeLog.url}</span></div>
                    <dl className="request-metrics">
                      <div><dt>Status</dt><dd className={activeLog.isError ? 'failed-text' : 'success-text'}>{activeLog.status || 'ERR'} {activeLog.statusText}</dd></div>
                      <div><dt>Duration</dt><dd>{formatDuration(activeLog.durationMs)}</dd></div>
                      <div><dt>Time</dt><dd>{formatTime(activeLog.timestamp)}</dd></div>
                      <div><dt>Req. size</dt><dd>{formatBytes(activeLog.requestBody)}</dd></div>
                      <div><dt>Res. size</dt><dd>{formatBytes(activeLog.responseBody)}</dd></div>
                    </dl>
                    <div className="copy-actions">
                      <button type="button" onClick={() => copyToClipboard(buildCurlCommand(activeLog), 'cURL Copied!')}>Copy cURL</button>
                      <button type="button" onClick={() => copyToClipboard(JSON.stringify({ url: activeLog.url, method: activeLog.method, queryParams: activeLog.queryParams, headers: activeLog.requestHeaders, body: activeLog.requestBody }, null, 2), 'Request copied')}>Copy Request</button>
                      <button type="button" onClick={() => copyToClipboard(typeof activeLog.responseBody === 'string' ? activeLog.responseBody : JSON.stringify(activeLog.responseBody, null, 2), 'Response copied')}>Copy Response</button>
                      <button type="button" onClick={() => copyToClipboard(JSON.stringify(activeJsonData, null, 2), 'Copied!')}>Copy JSON</button>
                      <span aria-live="polite">{copiedText}</span>
                    </div>
                    <div className="detail-tabs" aria-label="Request detail views">
                      {(['overview', 'response', 'params', 'headers', 'curl'] as const).map((tab) => <button type="button" key={tab} aria-pressed={activeTab === tab} onClick={() => setActiveTab(tab)}>
                        {{ overview: 'Overview', response: 'Response Body', params: 'Params & Payload', headers: 'Headers', curl: 'cURL' }[tab]}
                      </button>)}
                    </div>
                    <div className="detail-search">
                      <DebuggerIcon name="search" /><input aria-label="Search current request details" placeholder="Find in details…" title="Enter: next match · Shift+Enter: previous match" value={jsonSearch} onChange={(e) => setJsonSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing) return;
                          if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                            e.preventDefault(); e.stopPropagation();
                            if (e.shiftKey || e.key === 'ArrowUp') handlePrevMatch(); else handleNextMatch();
                          }
                        }} />
                      {jsonSearch.trim() && <>
                        <span role="status">{matchIndices.length ? `${currentMatchIndex + 1}/${matchIndices.length}` : '0 match'}</span>
                        <button type="button" className="icon-button" disabled={!matchIndices.length} onClick={handlePrevMatch} aria-label="Previous match" title="Previous match (Shift+Enter or ↑)">↑</button>
                        <button type="button" className="icon-button" disabled={!matchIndices.length} onClick={handleNextMatch} aria-label="Next match" title="Next match (Enter or ↓)">↓</button>
                      </>}
                    </div>
                    {contentSections.map((section, sectionIndex) => {
                      const offset = contentSections.slice(0, sectionIndex).reduce((length, item) => length + item.text.length + 1, 0);
                      const matchOffset = matchIndices.filter((index) => index < offset).length;
                      const expanded = !!jsonSearch.trim() || (expandedSections[section.label] ?? (activeTab === 'overview' ? section.defaultOpen : true));
                      const sectionId = `${detailsId}-section-${sectionIndex}`;
                      return <section className="detail-card" key={section.label}>
                        <button type="button" className="section-toggle" aria-expanded={expanded} aria-controls={sectionId} onClick={() => setExpandedSections((previous) => ({ ...previous, [section.label]: !expanded }))}>
                          <span>{section.label}{'count' in section && <span className="section-count"> ({section.count})</span>}</span><span aria-hidden="true">{expanded ? '−' : '+'}</span>
                        </button>
                        <pre id={sectionId} className={section.label === 'cURL command' ? 'curl-content' : undefined} hidden={!expanded}>{renderHighlightedJson(section.text, jsonSearch, matchOffset)}</pre>
                      </section>;
                    })}
                  </div>
                </> : <div className="empty-state"><DebuggerIcon name="network" /><strong>No request selected</strong><p>Select a captured request to inspect its response, headers and payload.</p></div>}
              </div>
            </div>
          </>}
          <footer className="debugger-footer"><span><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>* → *</kbd> to open</span><span>{canInspect ? 'Server network inspector' : 'Password protected'}</span></footer>
        </section>
      )}
    </>
  );
}

export default ServerDebugger;
