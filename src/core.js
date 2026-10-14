export const MASK = '[REDACTED]';
const sensitive = /authorization|cookie|password|passwd|secret|token|api[-_]?key|session|credential/i;

export function redact(value, keys = [], seen = new WeakSet(), depth = 0) {
  if (depth > 12) return '[Depth limit]';
  if (value === null || typeof value !== 'object') return typeof value === 'string' ? redactText(value) : value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error) return { name: value.name, message: redactText(value.message), stack: redactText(value.stack || '') };
  if (Array.isArray(value)) return value.slice(0, 200).map(v => redact(v, keys, seen, depth + 1));
  const result = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value)).slice(0, 200)) {
    if (!descriptor.enumerable) continue;
    result[key] = sensitive.test(key) || keys.some(k => k.toLowerCase() === key.toLowerCase())
      ? MASK : 'value' in descriptor ? redact(descriptor.value, keys, seen, depth + 1) : '[Accessor]';
  }
  return result;
}

export function redactText(text) {
  return String(text).replace(/\b(Bearer|Basic)\s+[\w.+/=-]+/gi, '$1 [REDACTED]')
    .replace(/((?:password|passwd|secret|token|api[-_]?key|authorization|cookie)["']?\s*[=:]\s*["']?)([^\s&,;"'}]+)/gi, '$1[REDACTED]');
}

export function safeText(value, keys = [], limit = 65536) {
  try {
    const text = typeof value === 'string' ? redactText(value) : JSON.stringify(redact(value, keys), null, 2);
    return (text ?? String(value)).slice(0, limit);
  } catch { return '[Unserializable]'; }
}

export function sanitizeBody(text, keys = []) {
  try { return safeText(JSON.parse(text), keys); } catch { return redactText(text); }
}

export function sanitizeURL(url, keys = []) {
  try {
    const parsed = new URL(url);
    if (parsed.username) parsed.username = MASK;
    if (parsed.password) parsed.password = MASK;
    for (const key of [...parsed.searchParams.keys()]) {
      if (sensitive.test(key) || keys.some(k => k.toLowerCase() === key.toLowerCase())) parsed.searchParams.set(key, MASK);
    }
    return parsed.href;
  } catch { return redactText(url); }
}

export function sanitizeHeaders(headers, keys = []) {
  try { return redact(Object.fromEntries(new Headers(headers)), keys); } catch { return {}; }
}

export async function readBody(response, limit = 65536, keys = []) {
  const type = response.headers.get('content-type') || '';
  if (/event-stream|octet-stream|image\/|audio\/|video\//i.test(type)) return '[Streaming or binary body omitted]';
  if (!response.body) return '';
  const clone = response.clone();
  const reader = clone.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '', timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 3000);
  timer.unref?.();
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) return sanitizeBody(text + decoder.decode(), keys) + (timedOut ? '\n[Body capture timed out]' : '');
      const take = Math.min(value.byteLength, limit - size);
      text += decoder.decode(value.subarray(0, take), { stream: true });
      size += take;
    }
    return sanitizeBody(text + decoder.decode(), keys) + '\n[Body truncated]';
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export function requestDetails(input, init = {}, base, keys = []) {
  const isRequest = input instanceof Request;
  const rawURL = isRequest ? input.url : String(input);
  let url = rawURL;
  try { url = new URL(rawURL, base).href; } catch { /* Keep invalid URLs for failed request inspection. */ }
  const body = init.body;
  let requestBody = '';
  let requestBodyReplayable = true;
  if (typeof body === 'string') requestBody = sanitizeBody(body.slice(0, 65536), keys);
  else if (body instanceof URLSearchParams) requestBody = sanitizeURL('https://debug.invalid/?' + body, keys).split('?')[1] || '';
  else if (typeof FormData !== 'undefined' && body instanceof FormData) {
    requestBodyReplayable = false;
    requestBody = safeText(Object.fromEntries([...body.entries()].map(([key, value]) => [key, typeof value === 'string' ? value : '[File omitted]'])), keys);
  } else if (body != null || (isRequest && input.body)) { requestBody = '[Binary/stream/Request body not captured]'; requestBodyReplayable = false; }
  const requestHeaders = sanitizeHeaders(init.headers ?? (isRequest ? input.headers : undefined), keys);
  if (!('content-type' in requestHeaders)) {
    if (typeof body === 'string') requestHeaders['content-type'] = 'text/plain;charset=UTF-8';
    else if (body instanceof URLSearchParams) requestHeaders['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
  }
  return { url: sanitizeURL(url, keys), method: (init.method || (isRequest ? input.method : 'GET')).toUpperCase(),
    requestHeaders, requestBody, requestBodyReplayable };
}

/** Read a clone of textual Request bodies without consuming the application's Request. */
export function captureRequestBody(entry, input, init, limit, keys, changed) {
  if (!(input instanceof Request) || init?.body != null || !input.body || !/json|text\/|x-www-form-urlencoded|xml/i.test(input.headers.get('content-type') || '')) return;
  void readBody(input, limit, keys).then(body => {
    entry.requestBody = body; entry.requestBodyReplayable = !/\[Body (truncated|capture timed out)\]/.test(body); changed();
  }, () => {});
}

const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
export function toCurl(entry) {
  const lines = ['curl -X ' + quote(entry.method) + ' ' + quote(entry.url)];
  for (const [key, value] of Object.entries(entry.requestHeaders || {})) {
    if (!/^(content-length|host|connection)$/i.test(key)) lines.push('  -H ' + quote(key + ': ' + value));
  }
  if (entry.requestBody && entry.requestBodyReplayable !== false) lines.push('  --data-raw ' + quote(entry.requestBody));
  return lines.join(' \\\n');
}

export function searchJSON(text, query) {
  if (!query) return [];
  const matches = [], needle = query.toLowerCase();
  try {
    const walk = (value, path, depth = 0) => {
      if (matches.length >= 100 || depth > 30) return;
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          const next = Array.isArray(value) ? `${path}[${key}]` : `${path}[${JSON.stringify(key)}]`;
          if (key.toLowerCase().includes(needle)) matches.push({ path: next, value: safeText(child, [], 200) });
          walk(child, next, depth + 1);
          if (matches.length >= 100) break;
        }
      } else if (String(value).toLowerCase().includes(needle)) matches.push({ path, value: String(value) });
    };
    walk(JSON.parse(text), '$');
  } catch {
    text.split('\n').forEach((line, i) => { if (matches.length < 100 && line.toLowerCase().includes(needle)) matches.push({ path: `Line ${i + 1}`, value: line.slice(0, 200) }); });
  }
  return matches.slice(0, 100);
}
