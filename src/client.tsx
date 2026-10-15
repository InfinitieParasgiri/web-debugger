import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { ApiLog } from './types';

export interface ServerDebuggerProps {
  endpoint?: string;
  pollInterval?: number;
  position?: 'bottom-right' | 'bottom-left';
}

export function ServerDebugger({
  endpoint = '/api/__nextjs-debugger',
  pollInterval = 1500,
}: ServerDebuggerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'response' | 'params' | 'headers' | 'curl'>('response');

  const [apiSearch, setApiSearch] = useState('');
  const [jsonSearch, setJsonSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('ALL');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const responsePreRef = useRef<HTMLDivElement>(null);
  const keySequenceRef = useRef<string[]>([]);
  const sequenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Use physical digit codes because Shift changes e.key to symbols (for example, #).
  useEffect(() => {
    const resetSequence = () => {
      keySequenceRef.current = [];
      if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing) return;
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) {
        resetSequence();
        return;
      }
      if (['Control', 'Meta', 'Shift'].includes(e.key)) return;
      const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)?.[1]
        ?? (/^[0-9]$/.test(e.key) ? e.key : '');
      const expected = '305'[keySequenceRef.current.length];
      if (digit !== expected) {
        resetSequence();
        if (digit !== '3') return;
      }
      e.preventDefault();
      keySequenceRef.current.push(digit);
      if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
      if (keySequenceRef.current.join('') === '305') {
        setIsOpen((prev) => !prev);
        resetSequence();
      } else {
        sequenceTimerRef.current = setTimeout(resetSequence, 1500);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) resetSequence();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', resetSequence);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', resetSequence);
      resetSequence();
    };
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch {}
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchLogs();
    const timer = setInterval(fetchLogs, pollInterval);
    return () => clearInterval(timer);
  }, [isOpen, endpoint, pollInterval]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (methodFilter !== 'ALL' && log.method !== methodFilter) return false;
      if (!apiSearch.trim()) return true;
      const target = `${log.method} ${log.status} ${log.url} ${JSON.stringify(log.queryParams)} ${JSON.stringify(log.requestBody)}`.toLowerCase();
      return target.includes(apiSearch.toLowerCase());
    });
  }, [logs, apiSearch, methodFilter]);

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
  const contentSections = useMemo(() => {
    const format = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) || 'null';
    if (!activeLog) return [];
    if (activeTab === 'params') return [
      { label: 'Query parameters', text: format(activeLog.queryParams) },
      { label: 'Request body', text: format(activeLog.requestBody) },
    ];
    if (activeTab === 'headers') return [
      { label: 'Request headers', text: format(activeLog.requestHeaders) },
      { label: 'Response headers', text: format(activeLog.responseHeaders) },
    ];
    if (activeTab === 'curl') return [{ label: 'cURL command', text: buildCurlCommand(activeLog) }];
    return [{ label: 'Response body', text: format(activeLog.responseBody) }];
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
              padding: '2px 4px',
              borderRadius: 3,
              fontWeight: 700,
              boxShadow: isActive ? '0 0 8px #f97316' : 'none',
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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 1800);
  };

  const errorCount = logs.filter((l) => l.isError).length;

  if (!isOpen) return null;

  return (
    <div
      className="ssr-debugger"
      role="region"
      aria-label="Web debugger"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 'min(600px, 85dvh)',
        maxHeight: '100dvh',
        colorScheme: 'dark',
        borderRadius: '16px 16px 0 0',
        overflow: 'hidden',
        background: '#090d16',
        color: '#f8fafc',
        zIndex: 999999,
        borderTop: '1px solid #334155',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        boxShadow: '0 -15px 40px rgba(0,0,0,0.7)',
      }}
    >
      <style>{`
        .ssr-debugger, .ssr-debugger * { box-sizing: border-box; }
        .ssr-debugger button, .ssr-debugger input, .ssr-debugger select { font: inherit; }
        .ssr-debugger button { min-height: 32px; }
        .ssr-debugger button:hover { filter: brightness(1.18); }
        .ssr-debugger :is(button,input,select):focus-visible { outline: 2px solid #38bdf8 !important; outline-offset: 2px; }
        .ssr-debugger * { scrollbar-width: thin; scrollbar-color: #334155 #090d16; }
        .ssr-debugger pre { white-space: pre; overflow: auto; line-height: 1.7; tab-size: 2; }
        .ssr-debugger .request-row:hover { background: #142033 !important; }
        .ssr-debugger .request-list { width: 34%; min-width: 240px; }
        .ssr-debugger .request-details { flex: 1; min-width: 0; }
        .ssr-debugger .search-field { width: 100%; min-width: 0; }
        @media (max-width: 700px) {
          .ssr-debugger .main-split { flex-direction: column; }
          .ssr-debugger .request-list { width: 100%; min-width: 0; height: 30%; flex-shrink: 0; border-bottom: 1px solid #1e293b; }
          .ssr-debugger .request-details { width: 100%; }
          .ssr-debugger .search-group { flex-basis: 100% !important; }
        }
      `}</style>
      {/* Top Bar */}
      <div
        style={{
          display: 'flex',
          padding: '10px 16px',
          borderBottom: '1px solid #1e293b',
          gap: 12,
          alignItems: 'center',
          background: '#0f172a',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', display: 'inline-block' }} />
          <strong style={{ color: '#38bdf8', fontSize: 13, letterSpacing: '0.5px' }}>WEB DEBUGGER</strong>
          <span style={{ color: '#94a3b8', marginLeft: 8 }}>{logs.length} requests · {errorCount} errors</span>
        </div>

        <select
          aria-label="Filter requests by HTTP method"
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value)}
          style={{
            background: '#1e293b',
            color: '#f8fafc',
            border: '1px solid #334155',
            padding: '5px 10px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <option value="ALL">ALL METHODS</option>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>

        <input
          aria-label="Search requests"
          className="search-field"
          placeholder="Search URL, status or parameters…"
          value={apiSearch}
          onChange={(e) => setApiSearch(e.target.value)}
          style={{
            background: '#090d16',
            border: '1px solid #334155',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: 6,
            flex: '1 1 220px',
            fontSize: 12,
            outline: 'none',
          }}
        />

        <div className="search-group" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 320px', minWidth: 0 }}>
          <input
            aria-label="Search current request details"
            className="search-field"
            placeholder="Find in details…"
            title="Enter: next match · Shift+Enter: previous match"
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey || e.key === 'ArrowUp') handlePrevMatch();
                else handleNextMatch();
              }
            }}
            value={jsonSearch}
            onChange={(e) => setJsonSearch(e.target.value)}
            style={{
              background: '#090d16',
              border: '1px solid #334155',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: 6,
              flex: 1,
              fontSize: 12,
              outline: 'none',
            }}
          />
          {jsonSearch.trim() && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span
                role="status"
                style={{
                  whiteSpace: 'nowrap',
                  background: matchIndices.length > 0 ? '#eab308' : '#334155',
                  color: matchIndices.length > 0 ? '#000' : '#94a3b8',
                  padding: '3px 8px',
                  borderRadius: 4,
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                {matchIndices.length > 0 ? `${currentMatchIndex + 1}/${matchIndices.length}` : '0 match'}
              </span>
              {matchIndices.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handlePrevMatch}
                    aria-label="Previous match"
                    title="Previous match (Shift+Enter or ↑)"
                    style={{ background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '3px 7px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={handleNextMatch}
                    aria-label="Next match"
                    title="Next match (Enter or ↓)"
                    style={{ background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '3px 7px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                  >
                    ▼
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={fetchLogs}
            style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={async () => {
              await fetch(endpoint, { method: 'DELETE' });
              setLogs([]);
            }}
            style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            Clear
          </button>
          <button
            type="button"
            aria-label="Close debugger"
            title="Close debugger (Ctrl/Cmd + Shift + 3, 0, 5)"
            onClick={() => setIsOpen(false)}
            style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main Split View */}
      <div className="main-split" style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left List */}
        <div className="request-list" style={{ borderRight: '1px solid #1e293b', overflowY: 'auto', background: '#070a12' }}>
          {filteredLogs.length === 0 ? (
            <div style={{ padding: 30, color: '#64748b', textAlign: 'center', fontSize: 13 }}>
              {logs.length ? 'No requests match your filters.' : 'No API requests captured yet.'}<br />{logs.length ? 'Try another search or HTTP method.' : 'Trigger a server action or page load.'}
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isSelected = activeLog?.id === log.id;
              return (
                <div
                  key={log.id}
                  className="request-row"
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(log.id);
                    }
                  }}
                  onClick={() => setSelectedId(log.id)}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid #111827',
                    cursor: 'pointer',
                    background: isSelected ? '#1e293b' : 'transparent',
                    borderLeft: isSelected ? '3px solid #38bdf8' : '3px solid transparent',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          color: log.isError ? '#f87171' : '#4ade80',
                          fontWeight: 700,
                          fontSize: 11,
                          padding: '1px 5px',
                          background: log.isError ? 'rgba(248,113,113,0.15)' : 'rgba(74,222,128,0.15)',
                          borderRadius: 4,
                        }}
                      >
                        {log.status || 'ERR'}
                      </span>
                      <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 11 }}>{log.method}</span>
                    </div>
                    <span style={{ color: '#64748b', fontSize: 11 }}>{log.durationMs}ms</span>
                  </div>
                  <div style={{ color: '#94a3b8', wordBreak: 'break-all', fontSize: 12, lineHeight: 1.4 }}>
                    {log.url}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Details */}
        <div className="request-details" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#090d16' }}>
          {activeLog ? (
            <>
              {/* Tabs */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  overflowX: 'auto',
                  flexShrink: 0,
                  padding: '8px 14px',
                  borderBottom: '1px solid #1e293b',
                  background: '#0b1120',
                }}
              >
                {(['response', 'params', 'headers', 'curl'] as const).map((tab) => (
                  <button
                    type="button"
                    key={tab}
                    aria-pressed={activeTab === tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      background: activeTab === tab ? '#38bdf8' : 'transparent',
                      color: activeTab === tab ? '#090d16' : '#94a3b8',
                      border: 'none',
                      padding: '5px 12px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      fontSize: 11,
                      letterSpacing: '0.5px',
                    }}
                  >
                    {tab === 'response' && 'Response Body'}
                    {tab === 'params' && 'Params & Payload'}
                    {tab === 'headers' && 'Headers'}
                    {tab === 'curl' && 'cURL'}
                  </button>
                ))}

                <div style={{ marginLeft: 'auto' }}>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(JSON.stringify(activeJsonData, null, 2), 'Copied!')}
                    style={{
                      background: '#1e293b',
                      color: '#38bdf8',
                      border: '1px solid #334155',
                      padding: '4px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {copiedText || 'Copy JSON'}
                  </button>
                </div>
              </div>

              {/* Content View */}
              <div ref={responsePreRef} style={{ padding: 16, overflow: 'auto', flex: 1, minHeight: 0 }}>
                <div style={{ marginBottom: 14, color: activeLog.isError ? '#f87171' : '#4ade80', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <strong>{activeLog.status || 'ERR'} {activeLog.statusText}</strong>
                  <span style={{ color: '#94a3b8' }}>{activeLog.method} · {activeLog.durationMs} ms</span>
                </div>
                {contentSections.map((section, sectionIndex) => {
                  const offset = contentSections.slice(0, sectionIndex).reduce((length, item) => length + item.text.length + 1, 0);
                  const matchOffset = matchIndices.filter((index) => index < offset).length;
                  return (
                    <div key={section.label} style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <strong style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{section.label}</strong>
                        {activeTab === 'curl' && (
                          <button type="button" onClick={() => copyToClipboard(section.text, 'cURL Copied!')} style={{ background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '4px 10px', borderRadius: 6, cursor: 'pointer' }}>
                            Copy cURL
                          </button>
                        )}
                      </div>
                      <pre style={{ background: '#05070c', padding: 16, borderRadius: 10, margin: 0, border: '1px solid #1e293b', color: '#e2e8f0' }}>
                        {renderHighlightedJson(section.text, jsonSearch, matchOffset)}
                      </pre>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ padding: 30, color: '#64748b', textAlign: 'center' }}>
              Select an API request on the left.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ServerDebugger;
