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
  const state = { active: false, paused: false, open: false, tab: 'network', entries: [], logs: [], selected: null, query: '', responseQuery: '', hideNavigation: false, method: '', status: '' };
  const sectionState = new Map();
  const positions = { bubble: null, panel: null };
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

  function isNavigation(entry) {
    if (/text\/x-component/i.test(entry.responseHeaders?.['content-type'] || '') || entry.requestHeaders?.rsc === '1') return true;
    try { return new URL(entry.url).searchParams.has('_rsc'); } catch { return false; }
  }
  function place(element, key, x, y) {
    if (element.hidden) return;
    const rect = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, Math.max(8, window.innerWidth - rect.width - 8)));
    const top = Math.max(8, Math.min(y, Math.max(8, window.innerHeight - rect.height - 8)));
    positions[key] = { x: left, y: top };
    Object.assign(element.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
  }
  function keepPositions() {
    if (!ui) return;
    for (const key of ['bubble', 'panel']) {
      const position = positions[key]; if (position) place(ui[key], key, position.x, position.y);
    }
  }
  function makeDraggable(element, handle, key) {
    let drag, suppressClick = false;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || (handle !== element && event.target.closest('button,input,a'))) return;
      const rect = element.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      suppressClick = false;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true; event.preventDefault();
      place(element, key, drag.left + dx, drag.top + dy);
    });
    const finish = event => {
      if (!drag || drag.id !== event.pointerId) return;
      suppressClick = drag.moved; drag = null;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', () => { drag = null; });
    handle.addEventListener('click', event => {
      if (suppressClick && event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); }
      suppressClick = false;
    }, true);
  }
  function mount() {
    host = document.createElement('div'); host.setAttribute('data-web-debugger', '');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{all:initial;color-scheme:dark;font:13px system-ui,sans-serif;color:#dce6f6}
      *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:2px solid #64e8ce;outline-offset:2px}
      .bubble{position:fixed;bottom:22px;right:22px;width:54px;height:54px;border:1px solid #64e8ce;border-radius:50%;background:#112a32;color:#64e8ce;font-size:20px;box-shadow:0 6px 24px #0008;z-index:2147483647;touch-action:none;cursor:grab}
      .head{touch-action:none;cursor:grab;user-select:none}.bubble:active,.head:active{cursor:grabbing}
      .panel{position:fixed;bottom:18px;right:18px;width:min(960px,calc(100vw - 36px));height:min(650px,calc(100dvh - 36px));background:#101722;border:1px solid #344155;border-radius:16px;box-shadow:0 18px 80px #0009;z-index:2147483647;display:flex;flex-direction:column;overflow:hidden}
      [hidden]{display:none!important}.head,.toolbar,.tabs{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #2b3545}.head strong{font-size:15px}.mode{color:#7de0c8;font-size:11px}.spacer{flex:1}button{background:#202c3e;color:#dce6f6;border:1px solid #38475d;padding:7px 10px;border-radius:7px}.tabs button[aria-selected=true]{background:#164239;border-color:#55cbb1;color:#a3ffe6}
      input{min-width:0;background:#0b121d;color:#e1ebff;border:1px solid #38475d;border-radius:7px;padding:9px;width:100%}.search{flex:1}.content{display:flex;flex:1;min-height:0}.list{width:36%;overflow:auto;border-right:1px solid #2b3545;padding:8px}.details{flex:1;min-width:0;overflow:auto;padding:14px}.row{display:block;text-align:left;width:100%;margin-bottom:6px;background:#141f2e;border-color:#27374d;overflow-wrap:anywhere}.row.selected{border-color:#64e8ce}.row small{display:block;color:#95a5bf;margin-top:5px}.bad{color:#ffb4b4}.console{padding:12px;overflow:auto;width:100%}.log{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px 4px;border-bottom:1px solid #283347}.log small{color:#93a4bf}.note,.empty{color:#98abc5;font-size:12px;line-height:1.6}.notice{padding:0 16px 8px;color:#ffdc8b;font-size:12px}pre{background:#0b121d;border:1px solid #28374b;border-radius:8px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.65 ui-monospace,monospace}h3{font-size:12px;color:#9badc7;margin:18px 0 8px}.match{padding:7px;border-bottom:1px solid #2b3545;overflow-wrap:anywhere}mark{background:#5a4918;color:#fff1ad}
      @media(max-width:600px){.panel{right:8px;bottom:8px;width:calc(100vw - 16px);height:calc(100dvh - 16px)}.head,.toolbar,.tabs{padding:10px;flex-wrap:wrap}.content{flex-direction:column}.list{width:100%;max-height:36%;border-right:0;border-bottom:1px solid #2b3545}.details{min-height:0}.head .mode{max-width:110px}}
      .panel{background:#101319;border-radius:10px;border-color:#303641;font-size:12px}.head{background:#181c24}.head strong{font-size:13px}.head strong::before{content:'';display:inline-block;width:7px;height:7px;background:#2ccea0;border-radius:50%;margin-right:7px}.mode{color:#8a94a6}.head,.toolbar,.tabs{border-color:#292f3a}.tabs button{border:0;border-radius:0;background:transparent;color:#8e98aa}.tabs button[aria-selected=true]{background:transparent;color:#27d8ed;border-bottom:2px solid #27d8ed}.toolbar{flex-wrap:wrap;padding:10px 14px}.search{flex-basis:300px}.filters{display:flex;gap:6px;flex-wrap:wrap}button[aria-pressed=true]{color:#32def1;border-color:#32a6b7;background:#12303a}.list{width:32%;padding:0;background:#101319}.row{border:0;border-bottom:1px solid #292f3a;border-radius:0;margin:0;padding:12px;background:transparent;font:11px ui-monospace,monospace}.row.selected{background:#191f2a;box-shadow:inset 2px 0 #25d5e9}.row small{font-size:10px}.details{padding:16px;background:#101319}.request-title{display:block;font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}.metadata{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:12px;background:#181c24;border:1px solid #2c323e;border-radius:8px;margin:14px 0}.metadata small{display:block;color:#768195;font:9px/1.7 system-ui;text-transform:uppercase;letter-spacing:1px}.metadata span{font:12px ui-monospace,monospace}.copy-actions{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.accordion{border:1px solid #2c323e;border-radius:7px;margin:12px 0;overflow:hidden}.accordion summary{background:#181c24;padding:11px;cursor:pointer;font-weight:600;list-style:none}.accordion summary::after{content:'+';float:right;color:#acb7c8}.accordion[open] summary::after{content:'−'}.accordion-content{padding:10px}.accordion pre{border:0;border-radius:0;padding:0;background:transparent;margin:0;font-size:11px}.payload{max-height:330px;overflow:auto;margin-top:10px!important}.kv{display:grid;grid-template-columns:minmax(90px,30%) 1fr;gap:8px 16px;font:11px/1.5 ui-monospace,monospace}.kv dt{color:#8d99ae;overflow-wrap:anywhere}.kv dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.json-key{color:#41def3}.json-string{color:#76e3b2}.json-number{color:#e9c568}.json-literal{color:#c99bf5}.footer{padding:8px 14px;border-top:1px solid #292f3a;color:#7e899b;font-size:10px}.status-success{color:#35cda1}.status-failed{color:#ff9898}
      @media(min-width:601px){.panel{width:min(1180px,calc(100vw - 36px));height:min(760px,calc(100dvh - 36px))}}
      @media(max-width:600px){.list{width:100%}.metadata{grid-template-columns:repeat(2,minmax(0,1fr))}.filters{gap:4px}.filters button{padding:5px 7px}}
    </style>
    <button class="bubble" aria-label="Open web debugger">⌘</button>
    <section class="panel" role="dialog" aria-label="Web debugger" hidden>
      <div class="head"><strong>API Debugger</strong><span class="request-count note"></span><span class="mode"></span><span class="spacer"></span><button data-action="minimize" aria-label="Minimize debugger">—</button><button data-action="stop">Stop</button></div>
      <div class="tabs" role="tablist"><button role="tab" data-tab="network">Network</button><button role="tab" data-tab="console">Console</button><span class="spacer"></span><span class="note">Ctrl + 3 → 0 → 5</span></div>
      <div class="toolbar"><input class="search" aria-label="Search requests or console" placeholder="Filter by URL, endpoint, method or status code…"><button data-action="pause">Pause</button><button data-action="clear">Clear</button><div class="filters"><button data-status="success" aria-pressed="false">Success</button><button data-status="failed" aria-pressed="false">Failed</button>${['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => `<button data-method="${method}" aria-pressed="false">${method}</button>`).join('')}</div></div>
      <div class="navigation-filter"><button data-action="navigation" aria-pressed="false">Hide Next.js navigation</button></div>
      <div class="notice" role="status"></div><div class="content"><div class="list"></div><div class="details"></div><div class="console" hidden></div></div>
      <div class="footer">Ctrl + 3 → 0 → 5 to toggle · Drag the header to move · Captured data is masked</div>
    </section>`;
    document.documentElement.appendChild(host);
    const get = selector => shadow.querySelector(selector);
    ui = { shadow, bubble: get('.bubble'), panel: get('.panel'), list: get('.list'), details: get('.details'), console: get('.console'), search: get('.search'), notice: get('.notice') };
    get('.navigation-filter').style.cssText = 'padding:8px 16px;border-bottom:1px solid #2b3545';
    makeDraggable(ui.bubble, ui.bubble, 'bubble'); makeDraggable(ui.panel, get('.head'), 'panel');
    window.addEventListener('resize', keepPositions);
    get('.mode').textContent = `${mode === 'static' ? 'Static export' : mode === 'server' ? 'Server deployment' : 'Unknown deployment'} · Live`;
    ui.bubble.onclick = () => { state.open = true; render(); ui.search.focus(); };
    shadow.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.dataset.action === 'minimize') { state.open = false; render(); ui.bubble.focus(); }
      if (button.dataset.action === 'stop') disable();
      if (button.dataset.action === 'clear') { clearVersion++; state.entries = []; state.logs = []; state.selected = null; sectionState.clear(); render(); }
      if (button.dataset.action === 'pause') { state.paused = !state.paused; render(); }
      if (button.dataset.action === 'navigation') { state.hideNavigation = !state.hideNavigation; render(); }
      if (button.dataset.method) { state.method = state.method === button.dataset.method ? '' : button.dataset.method; render(); }
      if (button.dataset.status) { state.status = state.status === button.dataset.status ? '' : button.dataset.status; render(); }
      if (button.dataset.tab) { state.tab = button.dataset.tab; render(); }
    });
    ui.search.addEventListener('input', () => { state.query = ui.search.value; render(); });
    shadow.addEventListener('keydown', event => { if (event.key === 'Escape') { state.open = false; render(); ui.bubble.focus(); } });
  }
  function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
  function appendPayload(target, text, query = '') {
    const needle = query.toLowerCase();
    const ranges = [];
    if (needle) {
      let start = 0, index;
      const lower = text.toLowerCase();
      while (ranges.length < 200 && (index = lower.indexOf(needle, start)) !== -1) { ranges.push({ start: index, end: index + query.length }); start = index + query.length; }
    }
    let rangeIndex = 0;
    const append = (parent, part, offset = 0) => {
      while (rangeIndex < ranges.length && ranges[rangeIndex].end <= offset) rangeIndex++;
      let start = 0;
      for (let i = rangeIndex; i < ranges.length && ranges[i].start < offset + part.length; i++) {
        const from = Math.max(0, ranges[i].start - offset), to = Math.min(part.length, ranges[i].end - offset);
        parent.append(document.createTextNode(part.slice(start, from)), node('mark', part.slice(from, to))); start = to;
      }
      parent.append(document.createTextNode(part.slice(start)));
    };
    let json = false; try { JSON.parse(text); json = true; } catch { /* Render other formats as text. */ }
    if (!json) { append(target, text); return; }
    const pattern = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;
    let start = 0;
    for (const match of text.matchAll(pattern)) {
      append(target, text.slice(start, match.index), start);
      const token = match[0], type = token.startsWith('"') ? /^\s*:/.test(text.slice(match.index + token.length)) ? 'key' : 'string' : /^(true|false|null)$/.test(token) ? 'literal' : 'number';
      const span = node('span', undefined, `json-${type}`); append(span, token, match.index); target.append(span); start = match.index + token.length;
    }
    append(target, text.slice(start), start);
  }
  function render() {
    if (!ui) return;
    ui.bubble.hidden = state.open; ui.panel.hidden = !state.open;
    keepPositions();
    ui.shadow.querySelector('.request-count').textContent = `${state.entries.length} requests`;
    ui.shadow.querySelector('.filters').hidden = state.tab !== 'network';
    for (const button of ui.shadow.querySelectorAll('[data-method]')) button.setAttribute('aria-pressed', String(state.method === button.dataset.method));
    for (const button of ui.shadow.querySelectorAll('[data-status]')) button.setAttribute('aria-pressed', String(state.status === button.dataset.status));
    const navigationButton = ui.shadow.querySelector('[data-action="navigation"]');
    navigationButton.textContent = state.hideNavigation ? 'Show Next.js navigation' : 'Hide Next.js navigation';
    navigationButton.setAttribute('aria-pressed', String(state.hideNavigation));
    ui.shadow.querySelector('.navigation-filter').hidden = state.tab !== 'network';
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
    const entries = state.entries.filter(entry => (!state.hideNavigation || !isNavigation(entry)) && (!state.method || entry.method === state.method) && (!state.status || (state.status === 'success' ? entry.status >= 200 && entry.status < 400 : entry.status === 'Failed' || entry.status >= 400)) && `${entry.url} ${entry.method} ${entry.status} ${entry.source} ${isNavigation(entry) ? 'Next.js navigation' : ''}`.toLowerCase().includes(query));
    if (!entries.length) ui.list.append(node('p', state.hideNavigation ? 'No matching requests. Next.js navigation is hidden; show it again or repeat an API action. Server-side APIs require server capture.' : 'No requests yet. Reload or repeat an action while debugging is active.', 'empty'));
    for (const entry of [...entries].reverse()) {
      const row = node('button', `${entry.method} · ${entry.status}`, 'row' + (state.selected === entry.id ? ' selected' : ''));
      row.append(node('small', entry.url), node('small', `${entry.source} · ${entry.transport || 'fetch'} · ${entry.duration ?? '…'} ms`));
      if (isNavigation(entry)) row.append(node('small', 'Next.js navigation · RSC'));
      row.onclick = () => { state.selected = entry.id; state.responseQuery = ''; render(); }; ui.list.append(row);
    }
    const entry = entries.find(item => item.id === state.selected);
    // Preserve response-search focus while new requests arrive.
    const signature = entry ? JSON.stringify(entry) : '';
    if (ui.details.dataset.signature === signature) return;
    ui.details.dataset.signature = signature;
    ui.details.replaceChildren();
    if (!entry) { ui.details.append(node('p', 'Select a request to inspect parameters, headers, response and cURL.', 'empty')); return; }
    ui.details.append(node('strong', `${entry.method} ${entry.url}`, 'request-title'));
    if (isNavigation(entry)) ui.details.append(node('p', 'Next.js navigation response (React Server Component payload). This contains page-rendering data. Backend API JSON fetched during SSR requires server capture around the server data-loading code.', 'note rsc-note'));
    const metadata = node('div', undefined, 'metadata');
    const size = value => `${new TextEncoder().encode(value || '').byteLength.toLocaleString()} B`;
    for (const [label, value] of [['Status', entry.status], ['Duration', `${entry.duration ?? '…'} ms`], ['Time', new Date(entry.startedAt).toLocaleTimeString()], ['Source', `${entry.source} · ${entry.transport || 'fetch'}`], ['Request captured', size(entry.requestBody)], ['Response captured', size(entry.responseBody)]]) {
      const item = node('div'); item.append(node('small', label), node('span', String(value), label === 'Status' ? entry.status >= 200 && entry.status < 400 ? 'status-success' : 'status-failed' : undefined)); metadata.append(item);
    }
    ui.details.append(metadata);
    const actions = node('div', undefined, 'copy-actions');
    for (const [label, value] of [['Copy cURL', toCurl(entry)], ['Copy Request', () => JSON.stringify({ url: entry.url, method: entry.method, headers: entry.requestHeaders, body: entry.requestBody }, null, 2)], ['Copy Response', () => entry.responseBody || '']]) {
      const button = node('button', label); button.onclick = async () => { try { await navigator.clipboard.writeText(typeof value === 'function' ? value() : value); button.textContent = 'Copied'; setTimeout(() => { button.textContent = label; }, 1200); } catch { button.textContent = 'Copy unavailable'; } }; actions.append(button);
    }
    ui.details.append(actions, node('p', 'Sensitive fields are masked. Replace placeholders and missing credentials before replaying cURL. Multipart, binary and omitted bodies need manual reconstruction.', 'note'));
    const section = (label, value, open = false, table = false) => {
      const accordion = node('details', undefined, 'accordion');
      const sectionKey = entry.id + ':' + label;
      accordion.open = sectionState.get(sectionKey) ?? open;
      accordion.append(node('summary', label));
      const content = node('div', undefined, 'accordion-content');
      if (value !== undefined) {
        if (table && value && typeof value === 'object' && Object.keys(value).length) {
          const list = node('dl', undefined, 'kv');
          for (const [key, item] of Object.entries(value)) list.append(node('dt', key), node('dd', typeof item === 'string' ? item : JSON.stringify(item)));
          content.append(list);
        } else { const pre = node('pre'); appendPayload(pre, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); content.append(pre); }
      }
      accordion.append(content); accordion.addEventListener('toggle', () => { sectionState.set(sectionKey, accordion.open); if (sectionState.size > maxEntries * 6) sectionState.delete(sectionState.keys().next().value); }); ui.details.append(accordion);
      return content;
    };
    section('cURL', toCurl(entry), true);
    let params = {}; try { const search = new URL(entry.url).searchParams; params = Object.fromEntries([...new Set(search.keys())].map(key => [key, search.getAll(key).length > 1 ? search.getAll(key) : search.get(key)])); } catch { /* Invalid URL. */ }
    section(`Query parameters (${Object.keys(params).length})`, params, false, true);
    section(`Request headers (${Object.keys(entry.requestHeaders || {}).length})`, entry.requestHeaders || {}, false, true);
    section('Request body', entry.requestBody || 'No body', false);
    section(`Response headers (${Object.keys(entry.responseHeaders || {}).length})`, entry.responseHeaders || {}, false, true);
    const responseSection = section(isNavigation(entry) ? 'Raw response body · Next.js RSC' : 'Response body', undefined, true);
    const search = node('input'); search.setAttribute('aria-label', 'Search response'); search.placeholder = 'Search JSON keys, values or response text…'; search.value = state.responseQuery;
    const results = node('div'), body = node('pre', undefined, 'payload');
    const update = () => {
      results.replaceChildren(); body.replaceChildren();
      const q = state.responseQuery, response = entry.responseBody || '(empty / pending)';
      if (q) {
        const matches = searchJSON(response, q);
        results.append(node('p', `${matches.length} matches (maximum 100)`, 'note'));
        for (const match of matches) results.append(node('div', `${match.path}: ${match.value}`, 'match'));
      }
      appendPayload(body, response, q);
    };
    search.oninput = () => { state.responseQuery = search.value; update(); };
    responseSection.append(search, results, body); update();
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
    window.removeEventListener('resize', keepPositions);
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
