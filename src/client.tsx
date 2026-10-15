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
  position = 'bottom-right',
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

  const responsePreRef = useRef<HTMLPreElement>(null);
  const keySequenceRef = useRef<string[]>([]);
  const sequenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Keyboard shortcut listener: Ctrl + Shift + 3 -> 0 -> 5
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if Ctrl or Cmd and Shift are held down
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        const key = e.key; // '3', '0', '5'
        if (['3', '0', '5'].includes(key)) {
          e.preventDefault();
          
          // Append to sequence
          keySequenceRef.current.push(key);

          // Clear previous timeout
          if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);

          // Reset sequence if no keypress within 1.5 seconds
          sequenceTimerRef.current = setTimeout(() => {
            keySequenceRef.current = [];
          }, 1500);

          // Check if sequence matches ['3', '0', '5']
          if (keySequenceRef.current.join('') === '305') {
            setIsOpen((prev) => !prev);
            keySequenceRef.current = [];
            if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
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
    fetchLogs();
    if (!isOpen) return;
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

  const activeJsonData = useMemo(() => {
    if (!activeLog) return '';
    if (activeTab === 'response') return activeLog.responseBody;
    if (activeTab === 'params') return { queryParams: activeLog.queryParams, requestBody: activeLog.requestBody };
    if (activeTab === 'headers') return { requestHeaders: activeLog.requestHeaders, responseHeaders: activeLog.responseHeaders };
    return activeLog;
  }, [activeLog, activeTab]);

  const formattedJsonString = useMemo(() => {
    return typeof activeJsonData === 'string' ? activeJsonData : JSON.stringify(activeJsonData, null, 2) || 'null';
  }, [activeJsonData]);

  const matchIndices = useMemo(() => {
    if (!jsonSearch.trim() || !formattedJsonString) return [];
    const escaped = jsonSearch.replace(/[.*+?^${}()|[\\]/g, '\\$&');
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
  }, [jsonSearch]);

  const scrollToMatch = (index: number) => {
    if (matchIndices.length === 0 || !responsePreRef.current) return;
    const marks = responsePreRef.current.querySelectorAll('mark');
    if (marks[index]) {
      marks[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleNextMatch = () => {
    if (matchIndices.length === 0) return;
    const next = (currentMatchIndex + 1) % matchIndices.length;
    setCurrentMatchIndex(next);
    scrollToMatch(next);
  };

  const handlePrevMatch = () => {
    if (matchIndices.length === 0) return;
    const prev = (currentMatchIndex - 1 + matchIndices.length) % matchIndices.length;
    setCurrentMatchIndex(prev);
    scrollToMatch(prev);
  };

  const renderHighlightedJson = (text: string, query: string) => {
    if (!query.trim()) return text;
    const escaped = query.replace(/[.*+?^${}()|[\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));

    let globalMatchCount = 0;
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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 1800);
  };

  const errorCount = logs.filter((l) => l.isError).length;

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: 20,
          ...(position === 'bottom-right' ? { right: 20 } : { left: 20 }),
          zIndex: 999999,
          background: '#0f172a',
          color: '#38bdf8',
          padding: '10px 18px',
          borderRadius: 999,
          border: errorCount > 0 ? '1px solid #ef4444' : '1px solid #334155',
          cursor: 'pointer',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 13,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: errorCount > 0 ? '#ef4444' : '#22c55e',
            display: 'inline-block',
            boxShadow: errorCount > 0 ? '0 0 8px #ef4444' : '0 0 8px #22c55e',
          }}
        />
        <span>SSR Network ({logs.length})</span>
        {errorCount > 0 && (
          <span style={{ background: '#ef4444', color: '#fff', borderRadius: 999, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>
            {errorCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '480px',
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
        </div>

        <select
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
          placeholder="🔍 Search API URL or params..."
          value={apiSearch}
          onChange={(e) => setApiSearch(e.target.value)}
          style={{
            background: '#090d16',
            border: '1px solid #334155',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: 6,
            width: 240,
            fontSize: 12,
            outline: 'none',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            placeholder="🔎 Search inside Response JSON..."
            value={jsonSearch}
            onChange={(e) => setJsonSearch(e.target.value)}
            style={{
              background: '#090d16',
              border: '1px solid #334155',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: 6,
              width: 240,
              fontSize: 12,
              outline: 'none',
            }}
          />
          {jsonSearch.trim() && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span
                style={{
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
                    onClick={handlePrevMatch}
                    title="Previous match (Up)"
                    style={{ background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '3px 7px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                  >
                    ▲
                  </button>
                  <button
                    onClick={handleNextMatch}
                    title="Next match (Down)"
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
            onClick={fetchLogs}
            style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            Refresh
          </button>
          <button
            onClick={async () => {
              await fetch(endpoint, { method: 'DELETE' });
              setLogs([]);
            }}
            style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            Clear
          </button>
          <button
            onClick={() => setIsOpen(false)}
            style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main Split View */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left List */}
        <div style={{ width: '36%', borderRight: '1px solid #1e293b', overflowY: 'auto', background: '#070a12' }}>
          {filteredLogs.length === 0 ? (
            <div style={{ padding: 30, color: '#64748b', textAlign: 'center', fontSize: 13 }}>
              No API requests captured yet.<br />Trigger a server action or page load!
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isSelected = activeLog?.id === log.id;
              return (
                <div
                  key={log.id}
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
        <div style={{ width: '64%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#090d16' }}>
          {activeLog ? (
            <>
              {/* Tabs */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 14px',
                  borderBottom: '1px solid #1e293b',
                  background: '#0b1120',
                }}
              >
                {(['response', 'params', 'headers', 'curl'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
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
              <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
                {activeTab === 'response' && (
                  <div>
                    <div style={{ marginBottom: 8, color: '#4ade80', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>Status: {activeLog.status} {activeLog.statusText} ({activeLog.durationMs}ms)</span>
                    </div>
                    <pre
                      ref={responsePreRef}
                      style={{
                        background: '#05070c',
                        padding: 14,
                        borderRadius: 8,
                        overflowX: 'auto',
                        margin: 0,
                        lineHeight: 1.6,
                        border: '1px solid #1e293b',
                        color: '#e2e8f0',
                      }}
                    >
                      {renderHighlightedJson(formattedJsonString, jsonSearch)}
                    </pre>
                  </div>
                )}

                {activeTab === 'params' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <div style={{ marginBottom: 6, color: '#c084fc', fontWeight: 600 }}>Query Parameters:</div>
                      <pre style={{ background: '#05070c', padding: 12, borderRadius: 8, margin: 0, border: '1px solid #1e293b' }}>
                        {renderHighlightedJson(JSON.stringify(activeLog.queryParams, null, 2), jsonSearch)}
                      </pre>
                    </div>
                    <div>
                      <div style={{ marginBottom: 6, color: '#38bdf8', fontWeight: 600 }}>Request Body Payload:</div>
                      <pre style={{ background: '#05070c', padding: 12, borderRadius: 8, margin: 0, border: '1px solid #1e293b' }}>
                        {renderHighlightedJson(JSON.stringify(activeLog.requestBody, null, 2), jsonSearch)}
                      </pre>
                    </div>
                  </div>
                )}

                {activeTab === 'headers' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <div style={{ marginBottom: 6, color: '#facc15', fontWeight: 600 }}>Request Headers:</div>
                      <pre style={{ background: '#05070c', padding: 12, borderRadius: 8, margin: 0, border: '1px solid #1e293b' }}>
                        {renderHighlightedJson(JSON.stringify(activeLog.requestHeaders, null, 2), jsonSearch)}
                      </pre>
                    </div>
                    <div>
                      <div style={{ marginBottom: 6, color: '#4ade80', fontWeight: 600 }}>Response Headers:</div>
                      <pre style={{ background: '#05070c', padding: 12, borderRadius: 8, margin: 0, border: '1px solid #1e293b' }}>
                        {renderHighlightedJson(JSON.stringify(activeLog.responseHeaders, null, 2), jsonSearch)}
                      </pre>
                    </div>
                  </div>
                )}

                {activeTab === 'curl' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ color: '#38bdf8', fontWeight: 600 }}>cURL Command:</span>
                      <button
                        onClick={() => copyToClipboard(buildCurlCommand(activeLog), 'cURL Copied!')}
                        style={{ background: '#1e293b', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                      >
                        Copy cURL
                      </button>
                    </div>
                    <pre style={{ background: '05070c', padding: 14, borderRadius: 8, margin: 0, border: '1px solid #1e293b', color: '#e2e8f0' }}>
                      {buildCurlCommand(activeLog)}
                    </pre>
                  </div>
                )}
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
