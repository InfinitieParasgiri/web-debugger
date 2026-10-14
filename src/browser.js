'use client';

import { requestDetails, captureRequestBody, readBody, safeText, sanitizeBody, sanitizeHeaders, searchJSON, toCurl } from './core.js';

let instance;

export function initDebugger(options = {}) {
  if (typeof window === 'undefined') return { destroy() {}, enable: async () => false, disable() {} };
  if (instance) return instance;
  const mode = ['static', 'server'].includes(options.mode) ? options.mode : 'unknown';
  const maxEntries = Math.min(1000, Math.max(1, options.maxEntries || 200));
  const maxBodyBytes = Math.min(262144, Math.max(256, options.maxBodyBytes || 65536));
  const keys = options.redactKeys || [];
  const duration = Math.min(60, Math.max(1, options.durationMinutes || 15));
  const endpoint = options.serverEndpoint ? new URL(options.serverEndpoint, location.href) : null;
  if (endpoint && endpoint.origin !== location.origin) throw new Error('Debugger endpoint must use the same origin.');
  const nativeFetch = window.fetch;
  const state = { active: false, paused: false, open: false, tab: 'network', entries: [], logs: [], selected: null, query: '', responseQuery: '' };
  let host, ui, stopCapture = () => {}, expiry, poll, activating = false, destroyed = false, sequence = '', lastKey = 0, renderPending = false, serverCursor = 0, polling = false, clearVersion = 0, generation = 0;
  const ignore = url => endpoint && (() => { try { return new URL(url, location.href).pathname === endpoint.pathname; } catch { return false; } })();
  const bounded = (list, entry) => { list.push(entry); if (list.length > maxEntries) list.splice(0, list.length - maxEntries); };
  function changed() {
    if (renderPending || !state.active) return;
    renderPending = true;
    requestAnimationFrame(() => { renderPending = false; if (ui && state.active) render(); });
  }
  const attempt = fn => { try { fn(); } catch { /* Debugger failures must not break the application. */ } };
  function installCapture() {
    const restores = [];
    const appFetch = window.fetch;
    const fetchWrapper = function (input, init) {
      if (state.paused || !state.active) return Reflect.apply(appFetch, this, arguments);
      let entry;
      attempt(() => {
        entry = { id: crypto.randomUUID(), source: 'Browser', transport: 'fetch', ...requestDetails(input, init, location.href, keys), status: 'Pending', startedAt: Date.now(), responseBody: '' };
        if (ignore(entry.url)) { entry = null; return; }
        captureRequestBody(entry, input, init, maxBodyBytes, keys, changed);
        bounded(state.entries, entry); changed();
      });
      let result;
      try { result = Reflect.apply(appFetch, this, arguments); }
      catch (error) { if (entry) { entry.status = 'Failed'; entry.responseBody = safeText(error, keys); changed(); } throw error; }
      if (entry) void result.then(response => {
        entry.status = response.status; entry.duration = Date.now() - entry.startedAt;
        entry.responseHeaders = sanitizeHeaders(response.headers, keys); changed();
        void readBody(response, maxBodyBytes, keys).then(body => { entry.responseBody = body; changed(); }, () => { entry.responseBody = '[Body unavailable]'; changed(); });
      }, error => { entry.status = 'Failed'; entry.duration = Date.now() - entry.startedAt; entry.responseBody = safeText(error, keys); changed(); }).catch(() => {});
      return result;
    };
    window.fetch = fetchWrapper;
    restores.push(() => { if (window.fetch === fetchWrapper) window.fetch = appFetch; });

    const proto = XMLHttpRequest.prototype, open = proto.open, send = proto.send, setHeader = proto.setRequestHeader;
    const requests = new WeakMap();
    function openWrapper(method, url) {
      const result = Reflect.apply(open, this, arguments);
      attempt(() => requests.set(this, { method, url: new URL(String(url), location.href).href, headers: {} }));
      return result;
    }
    function headerWrapper(name, value) {
      const result = Reflect.apply(setHeader, this, arguments);
      attempt(() => { const data = requests.get(this); if (data) data.headers[name] = data.headers[name] ? data.headers[name] + ', ' + value : value; });
      return result;
    }
    function sendWrapper(body) {
      const data = requests.get(this);
      let entry;
      if (state.active && !state.paused && data && !ignore(data.url)) attempt(() => {
        entry = { id: crypto.randomUUID(), source: 'Browser', transport: 'XHR', ...requestDetails(data.url, { method: data.method, headers: data.headers, body }, location.href, keys), status: 'Pending', startedAt: Date.now(), responseBody: '' };
        bounded(state.entries, entry); changed();
        this.addEventListener('loadend', () => attempt(() => {
          entry.status = this.status || 'Failed'; entry.duration = Date.now() - entry.startedAt;
          entry.responseHeaders = sanitizeHeaders(this.getAllResponseHeaders().trim().split(/[\r\n]+/).filter(Boolean).map(line => { const index = line.indexOf(':'); return [line.slice(0, index), line.slice(index + 1).trim()]; }), keys);
          entry.responseBody = this.responseType === 'json' ? safeText(this.response, keys, maxBodyBytes)
            : !this.responseType || this.responseType === 'text' ? sanitizeBody(this.responseText.slice(0, maxBodyBytes), keys) + (this.responseText.length > maxBodyBytes ? '\n[Body truncated]' : '') : '[Binary body omitted]';
          changed();
        }), { once: true });
      });
      try { return Reflect.apply(send, this, arguments); }
      catch (error) { if (entry) { entry.status = 'Failed'; entry.responseBody = safeText(error, keys); changed(); } throw error; }
    }
    proto.open = openWrapper; proto.send = sendWrapper; proto.setRequestHeader = headerWrapper;
    restores.push(() => {
      if (proto.open === openWrapper) proto.open = open;
      if (proto.send === sendWrapper) proto.send = send;
      if (proto.setRequestHeader === headerWrapper) proto.setRequestHeader = setHeader;
    });
    const log = (level, args) => attempt(() => {
      if (!state.active || state.paused) return;
      bounded(state.logs, { id: crypto.randomUUID(), source: 'Browser', level, time: Date.now(), text: args.map(arg => safeText(arg, keys, maxBodyBytes)).join(' ').slice(0, maxBodyBytes) }); changed();
    });
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      const original = console[level];
      const wrapper = function (...args) { const result = Reflect.apply(original, this, args); log(level, args); return result; };
      console[level] = wrapper;
      restores.push(() => { if (console[level] === wrapper) console[level] = original; });
    }
    const onError = event => log('error', [event.error || event.message || 'Resource load error']);
    const onRejection = event => log('error', [event.reason]);
    window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
    restores.push(() => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); });
    stopCapture = () => restores.forEach(restore => restore());
  }

  function mount() {
    host = document.createElement('div'); host.setAttribute('data-web-debugger', '');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{all:initial;color-scheme:dark;font:13px system-ui,sans-serif;color:#dce6f6}
      *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:2px solid #64e8ce;outline-offset:2px}
      .bubble{position:fixed;bottom:22px;right:22px;width:54px;height:54px;border:1px solid #64e8ce;border-radius:50%;background:#112a32;color:#64e8ce;font-size:20px;box-shadow:0 6px 24px #0008;z-index:2147483647}
      .panel{position:fixed;bottom:18px;right:18px;width:min(960px,calc(100vw - 36px));height:min(650px,calc(100dvh - 36px));background:#101722;border:1px solid #344155;border-radius:16px;box-shadow:0 18px 80px #0009;z-index:2147483647;display:flex;flex-direction:column;overflow:hidden}
      [hidden]{display:none!important}.head,.toolbar,.tabs{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #2b3545}.head strong{font-size:15px}.mode{color:#7de0c8;font-size:11px}.spacer{flex:1}button{background:#202c3e;color:#dce6f6;border:1px solid #38475d;padding:7px 10px;border-radius:7px}.tabs button[aria-selected=true]{background:#164239;border-color:#55cbb1;color:#a3ffe6}
      input{min-width:0;background:#0b121d;color:#e1ebff;border:1px solid #38475d;border-radius:7px;padding:9px;width:100%}.search{flex:1}.content{display:flex;flex:1;min-height:0}.list{width:36%;overflow:auto;border-right:1px solid #2b3545;padding:8px}.details{flex:1;min-width:0;overflow:auto;padding:14px}.row{display:block;text-align:left;width:100%;margin-bottom:6px;background:#141f2e;border-color:#27374d;overflow-wrap:anywhere}.row.selected{border-color:#64e8ce}.row small{display:block;color:#95a5bf;margin-top:5px}.bad{color:#ffb4b4}.console{padding:12px;overflow:auto;width:100%}.log{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px 4px;border-bottom:1px solid #283347}.log small{color:#93a4bf}.note,.empty{color:#98abc5;font-size:12px;line-height:1.6}.notice{padding:0 16px 8px;color:#ffdc8b;font-size:12px}pre{background:#0b121d;border:1px solid #28374b;border-radius:8px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.65 ui-monospace,monospace}h3{font-size:12px;color:#9badc7;margin:18px 0 8px}.match{padding:7px;border-bottom:1px solid #2b3545;overflow-wrap:anywhere}mark{background:#5a4918;color:#fff1ad}
      @media(max-width:600px){.panel{right:8px;bottom:8px;width:calc(100vw - 16px);height:calc(100dvh - 16px)}.head,.toolbar,.tabs{padding:10px;flex-wrap:wrap}.content{flex-direction:column}.list{width:100%;max-height:36%;border-right:0;border-bottom:1px solid #2b3545}.details{min-height:0}.head .mode{max-width:110px}}
    </style>
    <button class="bubble" aria-label="Open web debugger">⌘</button>
    <section class="panel" role="dialog" aria-label="Web debugger" hidden>
      <div class="head"><strong>Web debugger</strong><span class="mode"></span><span class="spacer"></span><button data-action="minimize" aria-label="Minimize debugger">—</button><button data-action="stop">Stop</button></div>
      <div class="tabs" role="tablist"><button role="tab" data-tab="network">Network</button><button role="tab" data-tab="console">Console</button><span class="spacer"></span><span class="note">Ctrl + 3 → 0 → 5</span></div>
      <div class="toolbar"><input class="search" aria-label="Search requests or console" placeholder="Search URL, method, status, source…"><button data-action="pause">Pause</button><button data-action="clear">Clear</button></div>
      <div class="notice" role="status"></div><div class="content"><div class="list"></div><div class="details"></div><div class="console" hidden></div></div>
    </section>`;
    document.documentElement.appendChild(host);
    const get = selector => shadow.querySelector(selector);
    ui = { shadow, bubble: get('.bubble'), panel: get('.panel'), list: get('.list'), details: get('.details'), console: get('.console'), search: get('.search'), notice: get('.notice') };
    get('.mode').textContent = `${mode === 'static' ? 'Static export' : mode === 'server' ? 'Server deployment' : 'Unknown deployment'} · Live`;
    ui.bubble.onclick = () => { state.open = true; render(); ui.search.focus(); };
    shadow.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.dataset.action === 'minimize') { state.open = false; render(); ui.bubble.focus(); }
      if (button.dataset.action === 'stop') disable();
      if (button.dataset.action === 'clear') { clearVersion++; state.entries = []; state.logs = []; state.selected = null; render(); }
      if (button.dataset.action === 'pause') { state.paused = !state.paused; render(); }
      if (button.dataset.tab) { state.tab = button.dataset.tab; render(); }
    });
    ui.search.addEventListener('input', () => { state.query = ui.search.value; render(); });
    shadow.addEventListener('keydown', event => { if (event.key === 'Escape') { state.open = false; render(); ui.bubble.focus(); } });
  }
  function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
  function render() {
    if (!ui) return;
    ui.bubble.hidden = state.open; ui.panel.hidden = !state.open;
    ui.shadow.querySelector('[data-action="pause"]').textContent = state.paused ? 'Resume' : 'Pause';
    for (const tab of ui.shadow.querySelectorAll('[data-tab]')) tab.setAttribute('aria-selected', String(state.tab === tab.dataset.tab));
    ui.list.hidden = ui.details.hidden = state.tab !== 'network'; ui.console.hidden = state.tab !== 'console';
    const query = state.query.toLowerCase();
    if (state.tab === 'console') {
      ui.console.replaceChildren();
      const logs = state.logs.filter(log => `${log.level} ${log.source} ${log.text}`.toLowerCase().includes(query));
      if (!logs.length) ui.console.append(node('p', 'No console entries. Repeat an action after activation.', 'empty'));
      for (const log of logs) { const row = node('div', undefined, 'log' + (log.level === 'error' ? ' bad' : '')); row.append(node('small', `${new Date(log.time).toLocaleTimeString()} · ${log.source} · ${log.level}`), node('div', log.text)); ui.console.append(row); }
      return;
    }
    ui.list.replaceChildren();
    const entries = state.entries.filter(entry => `${entry.url} ${entry.method} ${entry.status} ${entry.source}`.toLowerCase().includes(query));
    if (!entries.length) ui.list.append(node('p', 'No requests yet. Reload or repeat an action while debugging is active.', 'empty'));
    for (const entry of [...entries].reverse()) {
      const row = node('button', `${entry.method} · ${entry.status}`, 'row' + (state.selected === entry.id ? ' selected' : ''));
      row.append(node('small', entry.url), node('small', `${entry.source} · ${entry.transport || 'fetch'} · ${entry.duration ?? '…'} ms`));
      row.onclick = () => { state.selected = entry.id; state.responseQuery = ''; render(); }; ui.list.append(row);
    }
    const entry = state.entries.find(item => item.id === state.selected);
    // Preserve response-search focus while new requests arrive.
    const signature = entry ? JSON.stringify(entry) : '';
    if (ui.details.dataset.signature === signature) return;
    ui.details.dataset.signature = signature;
    ui.details.replaceChildren();
    if (!entry) { ui.details.append(node('p', 'Select a request to inspect parameters, headers, response and cURL.', 'empty')); return; }
    ui.details.append(node('strong', `${entry.method} ${entry.status}`));
    const copy = node('button', 'Copy cURL'); copy.style.marginLeft = '12px';
    copy.onclick = async () => { try { await navigator.clipboard.writeText(toCurl(entry)); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy unavailable'; } };
    ui.details.append(copy, node('p', 'Sensitive fields are masked. Replace placeholders and missing credentials before replaying cURL. Multipart, binary and omitted bodies need manual reconstruction.', 'note'));
    const section = (label, value) => { ui.details.append(node('h3', label), node('pre', typeof value === 'string' ? value : JSON.stringify(value, null, 2))); };
    section('URL', entry.url);
    let params = {}; try { const search = new URL(entry.url).searchParams; params = Object.fromEntries([...new Set(search.keys())].map(key => [key, search.getAll(key).length > 1 ? search.getAll(key) : search.get(key)])); } catch { /* Invalid URL. */ }
    section('Query parameters', params); section('Request headers', entry.requestHeaders); section('Request body', entry.requestBody || '(empty)');
    section('Response headers', entry.responseHeaders || {});
    ui.details.append(node('h3', 'Search response'));
    const search = node('input'); search.setAttribute('aria-label', 'Search response'); search.placeholder = 'Search JSON keys, values or response text…'; search.value = state.responseQuery;
    const results = node('div'), body = node('pre');
    const update = () => {
      results.replaceChildren(); body.replaceChildren();
      const q = state.responseQuery, response = entry.responseBody || '(empty / pending)';
      if (q) {
        const matches = searchJSON(response, q);
        results.append(node('p', `${matches.length} matches (maximum 100)`, 'note'));
        for (const match of matches) results.append(node('div', `${match.path}: ${match.value}`, 'match'));
      }
      if (!q) body.textContent = response;
      else {
        let start = 0, index, count = 0;
        while ((index = response.toLowerCase().indexOf(q.toLowerCase(), start)) !== -1 && count++ < 200) {
          body.append(document.createTextNode(response.slice(start, index)), node('mark', response.slice(index, index + q.length))); start = index + q.length;
        }
        body.append(document.createTextNode(response.slice(start)));
      }
    };
    search.oninput = () => { state.responseQuery = search.value; update(); };
    ui.details.append(search, results, node('h3', 'Response body'), body); update();
  }

  async function pollServer() {
    if (!state.active || state.paused || !endpoint || polling) return;
    polling = true;
    const version = clearVersion;
    const sessionGeneration = generation;
    try {
      const url = new URL(endpoint); url.searchParams.set('after', String(serverCursor));
      const response = await nativeFetch(url.href, { credentials: 'same-origin', cache: 'no-store' });
      if (!state.active || sessionGeneration !== generation) return;
      if (!response.ok) { ui.notice.textContent = 'Server session unavailable or expired. Browser capture continues.'; return; }
      const data = await response.json();
      serverCursor = data.cursor ?? serverCursor;
      if (version !== clearVersion || sessionGeneration !== generation) return;
      if (!state.active || state.paused) return;
      for (const [name, incoming] of [['entries', data.entries], ['logs', data.logs]]) {
        if (!Array.isArray(incoming)) continue;
        for (const item of incoming.slice(-maxEntries)) {
          const existing = state[name].find(entry => entry.id === item.id);
          if (existing) Object.assign(existing, item); else bounded(state[name], item);
        }
      }
      changed();
    } catch { if (ui) ui.notice.textContent = 'Could not read server capture. Browser capture continues.'; }
    finally { polling = false; }
  }
  async function enable() {
    if (destroyed || activating || state.active) return state.active;
    activating = true;
    const sessionGeneration = generation;
    let serverStarted = false;
    try {
      if (options.authorize && await options.authorize() !== true) return false;
      if (endpoint) {
        const response = await nativeFetch(endpoint.href, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
        if (!response.ok) return false;
        serverStarted = true;
      } else if (!options.authorize && !options.development) return false;
      if (destroyed || sessionGeneration !== generation) { if (serverStarted) void nativeFetch(endpoint.href, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {}); return false; }
      state.active = true; state.paused = false; state.entries = []; state.logs = []; state.selected = null; state.query = ''; state.responseQuery = ''; serverCursor = 0;
      mount(); installCapture(); render();
      expiry = setTimeout(disable, duration * 60000);
      if (endpoint) { poll = setInterval(pollServer, 1500); void pollServer(); }
      return true;
    } catch { disable(); return false; }
    finally { activating = false; }
  }
  function disable() {
    generation++;
    const wasActive = state.active; state.active = false; state.open = false;
    clearTimeout(expiry); clearInterval(poll); stopCapture(); host?.remove(); host = ui = undefined;
    state.entries = []; state.logs = []; state.selected = null;
    if (wasActive && endpoint) void nativeFetch(endpoint.href, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
  }
  function keydown(event) {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
    if (event.key === 'Control') return;
    const now = Date.now(); if (now - lastKey > 2000) sequence = ''; lastKey = now;
    sequence = '305'.startsWith(sequence + event.key) ? sequence + event.key : event.key === '3' ? '3' : '';
    if (sequence) event.preventDefault();
    if (sequence === '305') { sequence = ''; if (state.active) { state.open = !state.open; render(); } else void enable(); }
  }
  const keyup = event => { if (event.key === 'Control') sequence = ''; };
  window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
  const resetSequence = () => { sequence = ''; };
  window.addEventListener('blur', resetSequence);
  instance = { enable, disable, destroy() { destroyed = true; disable(); window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', resetSequence); instance = undefined; } };
  return instance;
}
