(() => {
  if (window.__zakvielMarketAddon) return;
  const source = 'zakviel-market-addon';
  const bindings = typeof pageBindings === 'undefined' ? {expose:fn=>fn,object:()=>({})} : pageBindings;
  const expose = bindings.expose;
  const state = bindings.object();state.enabled = false;window.__zakvielMarketAddon = state;
  const sensitive = /(?:^|[_-])(token|access[_-]?token|auth(?:orization)?|cookie|password|passwd|secret|api[_-]?key|session|sid|lk)(?:$|[_-])/i;
  const clean = (value, depth = 0) => {
    if (depth > 12) return '[глубина ограничена]';
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') {
      if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return '[скрыто: похоже на токен]';
      return value.length > 1_000_000 ? `${value.slice(0, 1_000_000)}\n[текст обрезан]` : value;
    }
    if (Array.isArray(value)) return value.slice(0, 2_000).map((item) => clean(item, depth + 1));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(chat|mchat|dm|dms|whispers|privateMessages)$/i.test(key)).map(([key, item]) => [key, sensitive.test(key) ? '[скрыто]' : clean(item, depth + 1)]));
    return String(value);
  };
  const decode = (text) => {
    try {
      const raw = JSON.parse(text), result = clean(raw);
      if (raw && !Array.isArray(raw) && typeof raw === 'object') {
        const messages = [...(Array.isArray(raw.chat) ? raw.chat : []), ...(Array.isArray(raw.mchat?.chat) ? raw.mchat.chat : [])];
        const authors = messages.filter(m => m && ['g','tr'].includes(m.k) && !['dm','ev'].includes(m.tb) && !m.to && typeof m.l === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(m.l) && Number.isFinite(m.at) && m.at > 0 && m.at < 1e14).slice(-200).map(m => ({ l: m.l, n: String(m.n || m.l).slice(0,150), at: m.at }));
        if (authors.length) result._publicAuthors = authors;
      }
      return result;
    } catch { return clean(text); }
  };
  const payload = async (response) => { try { return decode(await response.clone().text()); } catch { return '[тело недоступно]'; } };
  const requestPayload = (body) => {
    if (body == null) return undefined;
    if (typeof body === 'string') return decode(body);
    if (body instanceof URLSearchParams) return clean(Object.fromEntries(body));
    return '[не-JSON тело не сохранено]';
  };
  const publish = (event) => { if (state.enabled) window.postMessage({ source, type: 'network-event', event }, location.origin); };
  const noisyPaths = new Set(['/api/city/state', '/api/city/go', '/api/city/ping', '/api/mine/state', '/api/mine/go', '/api/mine/ping']);
  const sampledAt = new Map();
  const shouldCapture = (endpoint, key = '', interval = 5000) => {
    const path = endpoint.path.replace(/^\/c\/[^/]+/, '');
    if (!noisyPaths.has(path) && !key) return true;
    const sampleKey = `${path}:${key}`, now = performance.now(), previous = sampledAt.get(sampleKey);
    if (previous !== undefined && now - previous < interval) return false;
    sampledAt.set(sampleKey, now); return true;
  };
  const details = (input) => {
    const candidate = typeof input === 'string' || input instanceof URL ? input : input.url;
    const url = new URL(candidate, location.href);
    if (url.origin !== location.origin) throw new Error('outside game origin');
    if (/\/api\/(?:chat(?:\/|$)|city\/(?:say|chat)|mine\/chat|dm(?:\/|$)|friends(?:\/|$))/.test(url.pathname)) throw new Error('private communication stays local');
    return { path: url.pathname, query: Object.fromEntries([...url.searchParams].filter(([key]) => !sensitive.test(key))) };
  };
  const stamp = () => new Date().toISOString();

  document.addEventListener('submit', (event) => {
    if (event.target instanceof HTMLFormElement && event.target.matches('.au-f, .au-sell')) event.preventDefault();
  }, true);

  const originalFetch = window.fetch;
  window.fetch = expose(async function (input, init = {}) {
    const at = performance.now(), method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    let endpoint; try { endpoint = details(input); } catch { return Reflect.apply(originalFetch, this, arguments); }
    if (!state.enabled || !shouldCapture(endpoint)) return Reflect.apply(originalFetch, this, arguments);
    const request = requestPayload(init.body);
    try {
      const response = await Reflect.apply(originalFetch, this, arguments);
      void payload(response).then((body) => publish({ kind: 'fetch', at: stamp(), method, ...endpoint, status: response.status, contentType: response.headers.get('content-type') || null, contentLength: response.headers.get('content-length') || null, durationMs: Math.round(performance.now() - at), ...(request !== undefined ? { request } : {}), response: body }));
      return response;
    } catch (error) {
      publish({ kind: 'fetch', at: stamp(), method, ...endpoint, error: error && error.name || 'NetworkError', durationMs: Math.round(performance.now() - at), ...(request !== undefined ? { request } : {}) });
      throw error;
    }
  }, true);

  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  const requests = new WeakMap();
  XMLHttpRequest.prototype.open = expose(function (method, url) { requests.set(this,{ method: String(method || 'GET').toUpperCase(), url }); return Reflect.apply(open, this, arguments); });
  XMLHttpRequest.prototype.send = expose(function (body) {
    if (!state.enabled) return Reflect.apply(send, this, arguments);
    const meta = requests.get(this), at = performance.now(), request = requestPayload(body);
    if (meta) this.addEventListener('loadend', expose(() => { try { const endpoint = details(meta.url); if (!shouldCapture(endpoint)) return; publish({ kind: 'xhr', at: stamp(), method: meta.method, ...endpoint, status: this.status, contentType: this.getResponseHeader('content-type'), contentLength: this.getResponseHeader('content-length'), durationMs: Math.round(performance.now() - at), ...(request !== undefined ? { request } : {}), response: decode(this.responseText || '') }); } catch { /* Ignore cross-origin XHR. */ } }), { once: true });
    return Reflect.apply(send, this, arguments);
  });

  const NativeEventSource = window.EventSource;
  if (NativeEventSource) window.EventSource = expose(function (url, config) {
    let endpoint; try { endpoint = details(url); } catch { return new NativeEventSource(url, config); }
    const stream = new NativeEventSource(url, config);
    publish({ kind: 'sse-open', at: stamp(), method: 'GET', ...endpoint });
    const add = stream.addEventListener.bind(stream);
    stream.addEventListener = expose((type, listener, options) => add(type, expose(function (event) {
      const interval = type === 'city' || type === 'mine' ? 5000 : type === 'me' ? 2000 : 1000;
      if (state.enabled && !['dm','fr','friends'].includes(String(type)) && event && typeof event.data === 'string' && shouldCapture(endpoint, String(type), interval)) publish({ kind: 'sse-message', at: stamp(), method: 'GET', ...endpoint, eventType: type, response: decode(event.data) });
      return typeof listener === 'function' ? Reflect.apply(listener, this, [event]) : listener ? Reflect.apply(listener.handleEvent, listener, [event]) : undefined;
    }), options));
    stream.addEventListener('error', () => publish({ kind: 'sse-error', at: stamp(), method: 'GET', ...endpoint }));
    return stream;
  });
  if (NativeEventSource) {
    window.EventSource.prototype = NativeEventSource.prototype;
    for (const key of ['CONNECTING', 'OPEN', 'CLOSED']) window.EventSource[key] = NativeEventSource[key];
  }
  window.addEventListener('message', (event) => { if (event.source === window && event.data && event.data.source === source && event.data.type === 'collector-state') state.enabled = !!event.data.enabled; });
})();
