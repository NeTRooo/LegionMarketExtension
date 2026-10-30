// Privileged APIs stay inside the Tampermonkey sandbox, never on unsafeWindow.
export function recoverQueues(gm, tabId, activeIds, now = Date.now()) {
  const prefix=`zma:tab:${tabId}:`, live=new Set([...activeIds,tabId]);
  const candidates=gm.list().filter(key=>/^zma:tab:[^:]+:networkJournal$/.test(key)).map(key=>({key,id:key.split(':')[2],at:gm.get(key.replace(/networkJournal$/,'lastSeen'),0)})).filter(entry=>!live.has(entry.id));
  const current=gm.get(prefix+'networkJournal',[]),events=Array.isArray(current)?current:[],seen=new Set(events.map(event=>JSON.stringify(event))),recovered=[];
  for(const entry of candidates){
    // Newly opened tabs may not yet have published their tab identity.
    if(now-entry.at<60000)continue;
    const value=gm.get(entry.key,[]);
    if(now-entry.at<7*86400000&&Array.isArray(value))for(const event of value){const key=JSON.stringify(event);if(!seen.has(key)){events.push(event);seen.add(key);}}
    recovered.push(entry);
  }
  if(!recovered.length)return;
  events.sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0));
  let bytes=2;const bounded=[];
  for(const event of events.slice(-500).reverse()){const size=new TextEncoder().encode(JSON.stringify(event)).byteLength+1;if(bytes+size>8*1024*1024)break;bounded.push(event);bytes+=size;}
  gm.set(prefix+'networkJournal',bounded.reverse());gm.set(prefix+'journalCount',bounded.length);gm.set(prefix+'journalFormatVersion',3);gm.set(prefix+'lastSeen',now);
  for(const entry of recovered)for(const suffix of ['networkJournal','journalCount','journalFormatVersion','lastSeen'])gm.delete(entry.key.replace(/networkJournal$/,suffix));
}

export function serverTransport(request, base = 'http://127.0.0.1:4173') {
  return (input, init = {}) => new Promise((resolve, reject) => {
    const url = new URL(input, base);
    if (url.origin !== base || !url.pathname.startsWith('/api/')) return reject(Error('Недопустимый адрес сервера'));
    if (init.signal?.aborted) return reject(init.signal.reason || new DOMException('Aborted', 'AbortError'));
    let handle, timeout;
    const abort = () => { handle?.abort(); finish(reject, init.signal.reason || new DOMException('Aborted', 'AbortError')); };
    let settled = false;
    function finish(callback, value) { if (settled) return; settled = true; clearTimeout(timeout); init.signal?.removeEventListener('abort', abort); callback(value); }
    // anonymous/redirect use fetch mode in Tampermonkey; its native timeout may
    // be ignored on Chromium, so also enforce the deadline in the sandbox.
    timeout = setTimeout(() => { finish(reject, new DOMException('Сервер не ответил', 'TimeoutError')); handle?.abort(); }, 15000);
    try { handle = request({
      url: url.href, method: init.method || 'GET', headers: init.headers || {}, data: init.body,
      anonymous: true, timeout: 15000, redirect: 'error',
      onload: response => {
        if (response.finalUrl && new URL(response.finalUrl).origin !== base) return finish(reject, Error('Перенаправление сервера запрещено'));
        finish(resolve, {ok: response.status >= 200 && response.status < 300, status: response.status,
          json: async () => JSON.parse(response.responseText), text: async () => response.responseText});
      },
      onerror: () => finish(reject, new TypeError('Локальный сервер недоступен')),
      ontimeout: () => finish(reject, new DOMException('Сервер не ответил', 'TimeoutError')),
      onabort: () => finish(reject, new DOMException('Aborted', 'AbortError')),
    }); } catch(error) { finish(reject,error); return; }
    if(settled)return;
    init.signal?.addEventListener('abort', abort, {once: true});
    if (init.signal?.aborted) abort();
  });
}

export function createPlatform(gm, tabId, pageUrl, loadScript) {
  const workerListeners = new Set(), clientListeners = new Set(), changes = new Set();
  const watched = new Set(), sessions = new Map();
  const tab = () => ({id: tabId, url: pageUrl()});
  // Separate durable queues per tab: multiple game tabs never overwrite each other.
  const localKey = key => /^(networkJournal|journalCount|journalFormatVersion)$/.test(key) ? `zma:tab:${tabId}:${key}` : `zma:${key}`;
  function watch(key) {
    if (watched.has(key)) return; watched.add(key);
    gm.listen(localKey(key), (_key, oldValue, newValue, remote) => {
      if (remote) for (const listener of changes) listener({[key]: {oldValue, newValue}}, 'local');
      if (remote && /^(authToken|authUser|zma-hud:|zma-priest:)/.test(key)) void notify({type:'hud-state-changed',configuration:true});
    });
  }
  const local = {
    async get(keys) {
      const defaults = typeof keys === 'string' ? {[keys]: undefined} : Array.isArray(keys) ? Object.fromEntries(keys.map(key => [key, undefined])) : keys;
      return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {watch(key);return [key, gm.get(localKey(key), fallback)];}));
    },
    async set(values) {
      const changed = {};
      for (const [key, newValue] of Object.entries(values)) {watch(key);changed[key] = {oldValue:gm.get(localKey(key)),newValue};gm.set(localKey(key),newValue);if(key==='networkJournal')gm.set(`zma:tab:${tabId}:lastSeen`,Date.now());}
      for (const listener of changes) listener(changed, 'local');
    },
    async remove(keys) {
      const changed = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {changed[key]={oldValue:gm.get(localKey(key)),newValue:undefined};gm.delete(localKey(key));}
      for (const listener of changes) listener(changed, 'local');
    },
  };
  const session = {
    async get(keys) {return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,sessions.get(key)]));},
    async set(values) {for(const [key,value] of Object.entries(values))sessions.set(key,value);},
    async remove(keys) {for(const key of Array.isArray(keys)?keys:[keys])sessions.delete(key);},
  };
  async function notify(message) {for(const listener of clientListeners)listener(message);}
  const event = listeners => ({addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)});
  function send(message, settings = false) {
    return new Promise((resolve,reject) => {
      let async = false, answered = false;
      const respond = value => {answered=true;resolve(value);};
      const sender = settings ? {url:'userscript:settings',frameId:0} : {tab:tab(),url:pageUrl(),frameId:0};
      try {for(const listener of workerListeners)async = listener(message,sender,respond) === true || async;}
      catch(error){reject(error);return;}
      if(!async&&!answered)resolve(undefined);
    });
  }
  const storage = {local,session,onChanged:event(changes)};
  const tabs = {query:async()=>[tab()],get:async()=>tab(),sendMessage:async(_id,message)=>notify(message),
    create:async({url})=>{const target=new URL(url);if(target.origin!=='http://127.0.0.1:4173')throw Error('Недопустимая ссылка');gm.open(url);},
    onRemoved:{addListener(){}},onUpdated:{addListener(){}}};
  const worker = {storage,tabs,runtime:{onMessage:event(workerListeners),getURL:()=> 'userscript:settings'},
    scripting:{executeScript:async({files})=>{for(const file of files)await loadScript(file);}}};
  const client = {storage,runtime:{sendMessage:message=>send(message),onMessage:event(clientListeners)}};
  return {worker,client,settings:message=>send({...message,tabId},true),notify};
}
