import React, { useState, useEffect, useMemo } from 'react';
import type { ApiLog } from './types';

export interface ServerDebuggerProps {
  /** Custom internal API route path (default: '/api/__nextjs-debugger') */
  endpoint?: string;
  /** Polling interval in ms when drawer is open (default: 1500) */
  pollInterval?: number;
  /** Button position on screen (default: 'bottom-right') */
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

  // 1. Search bar for filtering API endpoints & sent parameters
  const [apiSearch, setApiSearch] = useState('');
  // 2. Search bar for deep searching inside the JSON response / payload
  const [jsonSearch, setJsonSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('ALL');
  const [copiedText, setCopiedText] = useState<string | null>(null);

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

  // Filter API list by URL, method, query params, or request body
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

  // Count how many matches exist inside the active view for jsonSearch
  const matchCount = useMemo(() => {
    if (!jsonSearch.trim() || !activeLog) return 0;
    const targetData =
      activeTab === 'response'
        ? activeLog.responseBody
        : activeTab === 'params'
        ? { queryParams: activeLog.queryParams, requestBody: activeLog.requestBody }
        : activeTab === 'headers'
        ? { requestHeaders: activeLog.requestHeaders, responseHeaders: activeLog.responseHeaders }
        : '';
    const formatted = JSON.stringify(targetData, null, 2) || '';
    const escaped = jsonSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = formatted.match(new RegExp(escaped, 'gi'));
    return matches ? matches.length : 0;
  }, [jsonSearch, activeLog, activeTab]);

  // Filter object keys/lines or highlight matching text inside JSON
  const highlightJson = (data: any, query: string) => {
    const formatted = typeof data === 'string' ? data : JSON.stringify(data, null, 2) || 'null';
    if (!query.trim()) return formatted;

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = formatted.split(new RegExp(`(${escaped})`, 'gi'));

    return parts.map((part, index) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark
          key={index}
          style={{
            background: '#facc15',
            color: '#090d16',
            padding: '1px 3px',
            borderRadius: 3,
            fontWeight: 700,
          }}
        >
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const buildCurlCommand = (log: ApiLog) => {
    let cmd = `curl -X ${log.method} "${log.url}"`;
    Object.entries(log.requestHeaders || {}).forEach(([k, v]) => {
      cmd += ` \\
  -H "${k}: ${v}"`;
    });
    if (log.requestBody) {
      const bodyStr = typeof log.requestBody === 'string' ? log.requestBody : JSON.stringify(log.requestBody);
      cmd += ` \\
  -d '${bodyStr.replace(/'/g, "'\\''")}'`;
    }
    return cmd;
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 1800);
  };

  if (process.env.NODE_ENV !== 'development') return null;

  const errorCount = logs.filter((l) => l.isError).length;

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: 16,
          ...(position === 'bottom-right' ? { right: 16 } : { left: 16 }),
          zIndex: 99999,
          background: '#090d16',
          color: '#38bdf8',
          padding: '10px 16px',
          borderRadius: 999,
          border: errorCount > 0 ? '1px solid #ef4444' : '1px solid #1e293b',
          cursor: 'pointer',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 13,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: errorCount > 0 ? '#ef4444' : '#22c55e',
            display: 'inline-block',
          }}
        />
        <span>SSR Network ({logs.length})</span>
        {errorCount > 0 && (
          <span style={{ background: '#ef4444', color: '#fff', borderRadius: 999, padding: '1px 6px', fontSize: 11 }}>
            {errorCount} err
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
        height: '460px',
        background: '#090d16',
        color: '#e2e8f0',
        zIndex: 99999,
        borderTop: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        boxShadow: '0 -10px 30px rgba(0,0,0,0.6)',
      }}
    >
      {/* Top Search & Action Bar */}
      <div
        style={{
          display: 'flex',
          padding: '8px 14px',
          borderBottom: '1px solid #1e293b',
          gap: 10,
          alignItems: 'center',
          background: '#0f172a',
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ color: '#38bdf8', fontSize: 13, marginRight: 4 }}>⚡ Next.js SSR Debugger</strong>

        {/* Method Filter */}
        <select
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value)}
          style={{
            background: '#1e293b',
            color: '#f8fafc',
            border: '1px solid #334155',
            padding: '5px 8px',
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          <option value="ALL">ALL</option>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>

        {/* 1. API & Sent Params Search */}
        <input
          placeholder="🔍 Filter API URL or sent params..."
          value={apiSearch}
          onChange={(e) => setApiSearch(e.target.value)}
          style={{
            background: '#090d16',
            border: '1px solid #334155',
            color: '#fff',
            padding: '5px 10px',
            borderRadius: 4,
            width: 240,
            fontSize: 12,
          }}
        />

        {/* 2. Deep Response / JSON Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            placeholder="🔎 Search inside Response / Payload JSON..."
            value={jsonSearch}
            onChange={(e) => setJsonSearch(e.target.value)}
            style={{
              background: '#090d16',
              border: '1px solid #334155',
              color: '#fff',
              padding: '5px 10px',
              borderRadius: 4,
              width: 260,
              fontSize: 12,
            }}
          />
          {jsonSearch.trim() && (
            <span
              style={{
                background: matchCount > 0 ? '#eab308' : '#334155',
                color: matchCount > 0 ? '#000' : '#94a3b8',
                padding: '2px 7px',
                borderRadius: 4,
                fontWeight: 700,
                fontSize: 11,
              }}
            >
              {matchCount} matches
            </span>
          )}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            onClick={fetchLogs}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              padding: '5px 10px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
          <button
            onClick={async () => {
              await fetch(endpoint, { method: 'DELETE' });
              setLogs([]);
            }}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              padding: '5px 10px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
          <button
            onClick={() => setIsOpen(false)}
            style={{
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              padding: '5px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main Split View */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Column: Captured Server API Calls */}
        <div style={{ width: '38%', borderRight: '1px solid #1e293b', overflowY: 'auto' }}>
          {filteredLogs.length === 0 ? (
            <div style={{ padding: 20, color: '#64748b', textAlign: 'center' }}>
              No server API calls matching filter.
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isSelected = activeLog?.id === log.id;
              return (
                <div
                  key={log.id}
                  onClick={() => setSelectedId(log.id)}
                  style={{
                    padding: '9px 12px',
                    borderBottom: '1px solid #0f172a',
                    cursor: 'pointer',
                    background: isSelected ? '#1e293b' : 'transparent',
                    borderLeft: isSelected ? '3px solid #38bdf8' : '3px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div>
                      <span
                        style={{
                          color: log.isError ? '#f87171' : '#4ade80',
                          fontWeight: 700,
                          marginRight: 8,
                        }}
                      >
                        [{log.status || 'ERR'}] {log.method}
                      </span>
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <span style={{ color: '#64748b', fontSize: 11 }}>{log.durationMs}ms</span>
                  </div>
                  <div
                    style={{
                      color: '#f1f5f9',
                      wordBreak: 'break-all',
                      fontSize: 12,
                      opacity: 0.95,
                    }}
                  >
                    {log.url}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Column: Inspector Tabs (Response, Sent Params, Headers, cURL) */}
        <div style={{ width: '62%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {activeLog ? (
            <>
              {/* Sub-navigation Tabs */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
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
                      padding: '4px 10px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      fontSize: 11,
                    }}
                  >
                    {tab === 'response' && 'Response Body'}
                    {tab === 'params' && 'Sent Params & Payload'}
                    {tab === 'headers' && 'Headers'}
                    {tab === 'curl' && 'cURL'}
                  </button>
                ))}

                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        JSON.stringify(
                          activeTab === 'response'
                            ? activeLog.responseBody
                            : activeTab === 'params'
                            ? { queryParams: activeLog.queryParams, requestBody: activeLog.requestBody }
                            : activeLog,
                          null,
                          2
                        ),
                        'JSON Copied!'
                      )
                    }
                    style={{
                      background: '#1e293b',
                      color: '#38bdf8',
                      border: '1px solid #334155',
                      padding: '3px 9px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 11,
                    }}
                  >
                    {copiedText || 'Copy JSON'}
                  </button>
                </div>
              </div>

              {/* Tab Content Viewer */}
              <div style={{ padding: 14, overflowY: 'auto', flex: 1 }}>
                {activeTab === 'response' && (
                  <div>
                    <div style={{ marginBottom: 6, color: '#4ade80', fontWeight: 600 }}>
                      Server Response ({activeLog.status} {activeLog.statusText}) — {activeLog.durationMs}ms:
                    </div>
                    <pre
                      style={{
                        background: '#0f172a',
                        padding: 12,
                        borderRadius: 6,
                        overflowX: 'auto',
                        margin: 0,
                        lineHeight: 1.5,
                        border: '1px solid #1e293b',
                      }}
                    >
                      {highlightJson(activeLog.responseBody, jsonSearch)}
                    </pre>
                  </div>
                )}

                {activeTab === 'params' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <div style={{ marginBottom: 6, color: '#c084fc', fontWeight: 600 }}>
                        URL Query Parameters Sent to Backend:
                      </div>
                      <pre
                        style={{
                          background: '#0f172a',
                          padding: 12,
                          borderRadius: 6,
                          overflowX: 'auto',
                          margin: 0,
                          border: '1px solid #1e293b',
                        }}
                      >
                        {highlightJson(activeLog.queryParams, jsonSearch)}
                      </pre>
                    </div>
                    <div>
                      <div style={{ marginBottom: 6, color: '#38bdf8', fontWeight: 600 }}>
                        Request Body Payload Sent to Backend:
                      </div>
                      <pre
                        style={{
                          background: '#0f172a',
                          padding: 12,
                          borderRadius: 6,
                          overflowX: 'auto',
                          margin: 0,
                          border: '1px solid #1e293b',
                        }}
                      >
                        {highlightJson(activeLog.requestBody, jsonSearch)}
                      </pre>
                    </div>
                  </div>
                )}

                {activeTab === 'headers' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <div style={{ marginBottom: 6, color: '#facc15', fontWeight: 600 }}>Request Headers:</div>
                      <pre
                        style={{
                          background: '#0f172a',
                          padding: 12,
                          borderRadius: 6,
                          overflowX: 'auto',
                          margin: 0,
                          border: '1px solid #1e293b',
                        }}
                      >
                        {highlightJson(activeLog.requestHeaders, jsonSearch)}
                      </pre>
                    </div>
                    <div>
                      <div style={{ marginBottom: 6, color: '#4ade80', fontWeight: 600 }}>Response Headers:</div>
                      <pre
                        style={{
                          background: '#0f172a',
                          padding: 12,
                          borderRadius: 6,
                          overflowX: 'auto',
                          margin: 0,
                          border: '1px solid #1e293b',
                        }}
                      >
                        {highlightJson(activeLog.responseHeaders, jsonSearch)}
                      </pre>
                    </div>
                  </div>
                )}

                {activeTab === 'curl' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ color: '#38bdf8', fontWeight: 600 }}>Reproduce Request via cURL:</span>
                      <button
                        onClick={() => copyToClipboard(buildCurlCommand(activeLog), 'cURL Copied!')}
                        style={{
                          background: '#1e293b',
                          color: '#fff',
                          border: 'none',
                          padding: '3px 8px',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontSize: 11,
                        }}
                      >
                        Copy cURL
                      </button>
                    </div>
                    <pre
                      style={{
                        background: '#0f172a',
                        padding: 12,
                        borderRadius: 6,
                        overflowX: 'auto',
                        margin: 0,
                        border: '1px solid #1e293b',
                        color: '#e2e8f0',
                      }}
                    >
                      {buildCurlCommand(activeLog)}
                    </pre>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ padding: 24, color: '#64748b' }}>
              Select an API request on the left to inspect sent parameters and server response.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ServerDebugger;
