import { auctionRequestPath, publicAuctionPayload } from './auction-api.mjs';
import { playersRequest } from './players-api.mjs';
import { hudPreferences, dashboardLink } from './hud-state.mjs';
import { priestPreferences, briefQuestTelemetry } from './priest-state.mjs';

const GAME_PATTERN = /^https:\/\/play\.multidonate\.ru\/c\/[^/]+\/?/;
const STORE_KEY = 'networkJournal';
const MAX_EVENTS = 500;
const MAX_BYTES = 8 * 1024 * 1024;
const SENSITIVE_KEY = /(?:^|[_-])(token|access[_-]?token|auth(?:orization)?|cookie|password|passwd|secret|api[_-]?key|session|sid|lk)(?:$|[_-])/i;
const DASHBOARD_URL = 'http://127.0.0.1:4173';
const SYNC_MODE_KEY = 'syncMode';
const JOURNAL_VERSION_KEY = 'journalFormatVersion';
const JOURNAL_VERSION = 3;
const SYNC_DELAYS = { immediate: 0, '15s': 15_000, '30s': 30_000, '1m': 60_000, '5m': 300_000 };
let syncTimer = null;
let pendingEvents = [];
let flushTimer = null;
let flushChain = Promise.resolve();
let syncPromise = null;
let syncRequested = false;
let hudNotifyTimer = null;
let hudConfigChanged = false;
function hudStateChanged(configuration=false) {
  hudConfigChanged ||= configuration;
  if(hudNotifyTimer)return;
  hudNotifyTimer=setTimeout(async()=>{
    hudNotifyTimer=null;
    const configuration=hudConfigChanged;hudConfigChanged=false;
    const tabs=await chrome.tabs.query({url:'https://play.multidonate.ru/c/*'});
    await Promise.allSettled(tabs.map(tab=>chrome.tabs.sendMessage(tab.id,{type:'hud-state-changed',configuration})));
  },500);
}
function syncJournal() {
  if (syncPromise) { syncRequested=true;return syncPromise; }
  syncPromise = performSyncJournal().finally(() => { syncPromise = null;if(syncRequested){syncRequested=false;void scheduleSync()} });
  return syncPromise;
}

async function ensureJournalVersion() {
  const { [JOURNAL_VERSION_KEY]: version } = await chrome.storage.local.get(JOURNAL_VERSION_KEY);
  if (version !== JOURNAL_VERSION) await chrome.storage.local.set({ [JOURNAL_VERSION_KEY]: JOURNAL_VERSION, [STORE_KEY]: [], journalCount:0 });
}

function safeValue(value, depth = 0) {
  if (depth > 12) return '[глубина ограничена]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return '[скрыто: похоже на токен]';
    return value.length > 1_000_000 ? `${value.slice(0, 1_000_000)}\n[текст обрезан]` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 2_000).map((item) => safeValue(item, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[скрыто]' : safeValue(item, depth + 1)]));
  return String(value);
}

function normaliseEvent(raw, page) {
  if (!raw || typeof raw !== 'object' || typeof raw.path !== 'string' || !(raw.path.includes('/api/') || raw.path === '/site/worldgeo.json')) return null;
  const channel = /^\/c\/([^/]+)\/?/.exec(page || '')?.[1] || null;
  const path = raw.path.replace(/^\/c\/[^/]+/, '');
  return {
    at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(), kind: raw.kind, method: raw.method, path, page,
    ...(channel ? { channel } : {}),
    query: safeValue(raw.query || {}),
    ...(Number.isInteger(raw.status) ? { status: raw.status } : {}),
    ...(typeof raw.contentType === 'string' ? { contentType: raw.contentType } : {}),
    ...(typeof raw.contentLength === 'string' ? { contentLength: raw.contentLength } : {}),
    ...(Number.isInteger(raw.durationMs) ? { durationMs: raw.durationMs } : {}),
    ...(raw.request !== undefined ? { request: safeValue(raw.request) } : {}),
    ...(raw.response !== undefined ? { response: safeValue(raw.response) } : {}),
    ...(typeof raw.cityKey === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(raw.cityKey) ? { cityKey: raw.cityKey } : {}),
    ...(raw.eventType ? { eventType: String(raw.eventType).slice(0, 80) } : {})
  };
}
const encodedSize = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength + 1;
function trimJournal(events) {
  const weighted = events.map((event) => [event, encodedSize(event)]);
  let total = weighted.reduce((sum, entry) => sum + entry[1], 2);
  while (weighted.length > MAX_EVENTS || total > MAX_BYTES) total -= weighted.shift()[1];
  return weighted.map((entry) => entry[0]);
}
function flushPendingEvents() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!pendingEvents.length) return flushChain;
  const batch = pendingEvents; pendingEvents = [];
  flushChain = flushChain.then(async () => {
    await ensureJournalVersion();
    const data = await chrome.storage.local.get({ [STORE_KEY]: [] });
    const journal=trimJournal([...data[STORE_KEY], ...batch]);
    await chrome.storage.local.set({ [STORE_KEY]: journal,journalCount:journal.length });
    hudStateChanged();
  });
  void flushChain.then(() => scheduleSync());
  return flushChain;
}
async function performSyncJournal() {
  await flushPendingEvents();
  await ensureJournalVersion();
  const { authToken, authUser } = await chrome.storage.local.get(['authToken','authUser']);
  if (!authToken) return;
  const { [STORE_KEY]: events = [] } = await chrome.storage.local.get({ [STORE_KEY]: [] });
  if (!events.length) return;
  try {
    const response = await fetch(`${DASHBOARD_URL}/api/import`, { method: 'POST', headers: {'content-type':'application/json',authorization:`Bearer ${authToken}`}, body: JSON.stringify({ format: 'zakviel-network-map/v1', events }), signal:AbortSignal.timeout(15000) });
    if (!response.ok) throw Error(`Ошибка отправки: ${response.status}`);
    const sent = new Set(events.map((event) => JSON.stringify(event)));
    const current = await chrome.storage.local.get({ [STORE_KEY]: [] });
    const remaining=current[STORE_KEY].filter((event) => !sent.has(JSON.stringify(event)));
    await chrome.storage.local.set({ [STORE_KEY]: remaining,journalCount:remaining.length });
    await chrome.storage.local.set({[`syncStatus:${authUser?.id||'guest'}`]:{lastSyncAt:new Date().toISOString(),error:null}});
    hudStateChanged();
  } catch(error) {
    const key=`syncStatus:${authUser?.id||'guest'}`,saved=await chrome.storage.local.get(key);
    await chrome.storage.local.set({[key]:{lastSyncAt:saved[key]?.lastSyncAt||null,error:error.message||'Сервер недоступен'}});
    hudStateChanged();
  }
}
async function scheduleSync(reset = false) {
  const { [SYNC_MODE_KEY]: mode = '15s' } = await chrome.storage.local.get({ [SYNC_MODE_KEY]: '15s' });
  const delay = SYNC_DELAYS[mode] ?? SYNC_DELAYS['15s'];
  if (syncTimer && !reset) return;
  if (syncTimer) clearTimeout(syncTimer);
  if (!delay) { syncTimer = null; await syncJournal(); return; }
  syncTimer = setTimeout(() => { syncTimer = null; void syncJournal(); }, delay);
}
function saveEvent(event) {
  pendingEvents.push(event);
  if (pendingEvents.length >= 40) return flushPendingEvents();
  if (!flushTimer) flushTimer = setTimeout(flushPendingEvents, 300);
  return Promise.resolve();
}
function townFrom(value) {
  if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)) return value;
  if (value && typeof value === 'object') return townFrom(value.key || value.k || value.id);
  return null;
}
function needsKnownCity(event) { return event.path === '/api/city/stock' || event.path === '/api/city/enter'; }
async function attachCity(tabId, event) {
  const key = `city:${tabId}`;
  const response = event.response && typeof event.response === 'object' ? event.response : {};
  const request = event.request && typeof event.request === 'object' ? event.request : {};
  const detected = townFrom(response.town || response.city || response.place) || townFrom(request.town || request.city || request.place);
  if (detected) await chrome.storage.session.set({ [key]: detected });
  if (event.path === '/api/city/leave') { await chrome.storage.session.remove(key); return true; }
  const stored = await chrome.storage.session.get(key);
  const town = detected || stored[key];
  if (town) event.cityKey = town;
  // A shop snapshot without a city would poison price history. Keep all other
  // game data, but do not retain or send that particular snapshot.
  return !needsKnownCity(event) || !!town;
}
async function ensureCollector(tabId, enabled) {
  // After an extension reload Chrome does not always reinject a registered
  // content script into an already open tab. Install a guarded bridge first.
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content-bridge.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['collector-main.js'] });
  await chrome.tabs.sendMessage(tabId, { type: 'collector-state', enabled });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const auctionSender = sender.tab && sender.frameId === 0 && GAME_PATTERN.test(sender.url || '');
  if(['priest-state','priest-preferences','priest-context'].includes(message.type)){
    (async()=>{
      if(!auctionSender)throw Error('Помощник доступен на вкладке игры');
      const channel=/^\/c\/([^/]+)/.exec(new URL(sender.url).pathname)?.[1];
      if(!channel||!/^[A-Za-z0-9_-]{1,80}$/.test(channel))throw Error('Канал не определён');
      const {authUser,authToken}=await chrome.storage.local.get(['authUser','authToken']),userId=authToken&&authUser?.id?authUser.id:'guest',key=`zma-priest:${userId}:${channel}`;
      const saved=await chrome.storage.local.get(key);
      if(message.type==='priest-preferences'){
        if(message.userId!==userId)throw Error('Аккаунт изменился');
        const preferences=priestPreferences({...saved[key],...message.preferences});await chrome.storage.local.set({[key]:preferences});hudStateChanged(true);return {ok:true,preferences};
      }
      if(message.type==='priest-state'){
        const state=await chrome.storage.session.get(`enabled:${sender.tab.id}`);
        return {ok:true,userId,signedIn:!!authToken,collector:!!state[`enabled:${sender.tab.id}`],preferences:priestPreferences(saved[key])};
      }
      if(!authToken)throw Error('Войдите через popup расширения');
      const response=await fetch(`${DASHBOARD_URL}/api/priest/context?${new URLSearchParams({channel})}`,{headers:{authorization:`Bearer ${authToken}`},credentials:'omit',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error(response.status===401?'Сессия истекла. Войдите через popup':'Не удалось загрузить настройки жреца');
      return {ok:true,userId,data:await response.json()};
    })().then(respond).catch(error=>respond({ok:false,error:error instanceof TypeError||error.name==='TimeoutError'?'Локальный сервер недоступен':error.message}));return true;
  }
  if (['hud-state','hud-preferences','hud-data','hud-module','hud-link','priest-module'].includes(message.type)) {
    (async()=>{
      const popup=sender.url===chrome.runtime.getURL('popup.html');
      if(!auctionSender&&!popup)throw Error('Недопустимый контекст HUD');
      const {authUser,authToken}=await chrome.storage.local.get(['authUser','authToken']);
      const userId=authToken&&authUser?.id?authUser.id:'guest',key=`zma-hud:${userId}`;
      if(message.type==='hud-link'){const url=dashboardLink(message.tab);await chrome.tabs.create({url});return {ok:true}}
      if(message.type==='hud-preferences'){
        if(message.userId!==undefined&&message.userId!==userId)throw Error('Аккаунт изменился');
        const saved=await chrome.storage.local.get(key);
        const prefs=hudPreferences({...saved[key],...message.preferences});
        if(popup&&prefs.enabled&&Number.isInteger(message.tabId)){
          const tab=await chrome.tabs.get(message.tabId);if(!GAME_PATTERN.test(tab.url||''))throw Error('Откройте вкладку игры');
          await chrome.scripting.executeScript({target:{tabId:tab.id},files:['auction-panel.js','hud-panel.js']});
        }
        await chrome.storage.local.set({[key]:prefs});hudStateChanged(true);return {ok:true,preferences:prefs};
      }
      if(message.type==='hud-state'){
        const stored=await chrome.storage.local.get([key,'journalCount',`syncStatus:${userId}`]);
        if(typeof stored.journalCount!=='number'){
          const journal=await chrome.storage.local.get(STORE_KEY);stored.journalCount=journal[STORE_KEY]?.length||0;
          await chrome.storage.local.set({journalCount:stored.journalCount});
        }
        const tabId=auctionSender?sender.tab.id:message.tabId;
        const state=await chrome.storage.session.get(`enabled:${tabId}`);
        return {ok:true,userId,signedIn:!!authToken,preferences:hudPreferences(stored[key]),queue:stored.journalCount+pendingEvents.length,collector:!!state[`enabled:${tabId}`],sync:stored[`syncStatus:${userId}`]||{lastSyncAt:null,error:null}};
      }
      if(!authToken)throw Error('Войдите через popup расширения');
      if(!auctionSender)throw Error('Сводка доступна на вкладке игры');
      const channel=/^\/c\/([^/]+)/.exec(new URL(sender.url).pathname)?.[1];
      if(!channel||!/^[A-Za-z0-9_-]{1,80}$/.test(channel))throw Error('Канал не определён');
      const headers={'content-type':'application/json',authorization:`Bearer ${authToken}`};
      if(message.type==='hud-module'||message.type==='priest-module'){
        const response=await fetch(`${DASHBOARD_URL}/api/settings`,{headers,signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw Error('Не удалось прочитать настройки');
        const settings=await response.json();settings.modules[message.type==='priest-module'?'priest':'hud']=message.enabled===true;
        const updated=await fetch(`${DASHBOARD_URL}/api/settings`,{method:'PUT',headers,body:JSON.stringify(settings),signal:AbortSignal.timeout(15000)});
        if(!updated.ok)throw Error('Не удалось сохранить настройку модуля');hudStateChanged(true);return {ok:true};
      }
      const response=await fetch(`${DASHBOARD_URL}/api/hud?${new URLSearchParams({channel})}`,{headers,credentials:'omit',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error(response.status===401?'Сессия истекла. Войдите через popup':`Ошибка сервера ${response.status}`);
      return {ok:true,data:await response.json(),userId};
    })().then(respond).catch(error=>respond({ok:false,error:error instanceof TypeError||error.name==='TimeoutError'?'Сервер недоступен':error.message}));
    return true;
  }
  if (message.type === 'players-request') {
    (async () => {
      if (!auctionSender) throw Error('Игроки доступны только на вкладке игры');
      const request = playersRequest(message), { authToken } = await chrome.storage.local.get('authToken');
      if (!authToken) throw Error('Войдите в аккаунт через popup расширения');
      const response = await fetch(DASHBOARD_URL+request.path,{method:request.method,body:request.body,headers:{'content-type':'application/json',authorization:`Bearer ${authToken}`},credentials:'omit',signal:AbortSignal.timeout(15000)});
      const data=await response.json();
      if (!response.ok) throw Error(response.status===401?'Сессия истекла. Войдите через popup расширения':typeof data.detail==='string'?data.detail:'Ошибка данных игроков');
      return {ok:true,data};
    })().then(respond).catch(error=>respond({ok:false,error:error instanceof TypeError||error.name==='TimeoutError'?'Локальный сервер недоступен. Запустите Zakviel Market.':error.message}));
    return true;
  }
  if (message.type === 'open-auction') {
    (async () => {
      if (sender.url !== chrome.runtime.getURL('popup.html') || !Number.isInteger(message.tabId)) throw Error('Недопустимая вкладка');
      const tab = await chrome.tabs.get(message.tabId);
      if (!GAME_PATTERN.test(tab.url || '')) throw Error('Откройте вкладку игры');
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['auction-panel.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'show-auction', view: ['players','priest'].includes(message.view) ? message.view : 'auction' });
      return { ok: true };
    })().then(respond).catch(error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'auction-load-ui' || message.type === 'auction-query' || message.type === 'auction-import') {
    (async () => {
      if (!auctionSender) throw Error('Аукцион доступен только на вкладке игры');
      if (message.type === 'auction-load-ui') {
        await chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [0] }, files: ['auction-ui/auction.js'] });
        return { ok: true };
      }
      if (message.type === 'auction-query') {
        const path = auctionRequestPath(message.path);
        const response = await fetch(DASHBOARD_URL + path, { credentials: 'omit', signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (!response.ok) throw Error(typeof data.detail === 'string' ? data.detail : 'Ошибка сервера аукциона');
        return { ok: true, data };
      }
      const state = await chrome.storage.session.get(`enabled:${sender.tab.id}`);
      if (!state[`enabled:${sender.tab.id}`]) throw Error('Включите сбор в popup расширения для обновления из игры');
      const { authToken } = await chrome.storage.local.get('authToken');
      if (!authToken) throw Error('Войдите в аккаунт сайта через popup расширения');
      const event = normaliseEvent({ at: new Date().toISOString(), kind: 'fetch', method: 'GET', path: '/api/auction', status: 200, response: publicAuctionPayload(message.response) }, new URL(sender.url).pathname);
      try {
        const response = await fetch(`${DASHBOARD_URL}/api/import`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${authToken}` }, body: JSON.stringify({ format: 'zakviel-network-map/v1', events: [event] }), signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw Error(response.status === 401 ? 'Сессия истекла. Войдите в popup расширения' : 'Сервер не принял снимок');
        const {authUser}=await chrome.storage.local.get('authUser');
        await chrome.storage.local.set({[`syncStatus:${authUser?.id||'guest'}`]:{lastSyncAt:new Date().toISOString(),error:null}});
        hudStateChanged();
      } catch (error) {
        await saveEvent(event);
        throw Error(`${error.message || 'Сервер недоступен'}. Снимок сохранён в очередь отправки.`);
      }
      return { ok: true };
    })().then(respond).catch(error => respond({ ok: false, error: error instanceof TypeError || error.name === 'TimeoutError' ? 'Локальный сервер недоступен. Запустите Zakviel Market на 127.0.0.1:4173.' : error.message }));
    return true;
  }
  if (message.type === 'get-collector-state' && sender.tab) { chrome.storage.session.get(`enabled:${sender.tab.id}`).then(data => respond({ enabled: !!data[`enabled:${sender.tab.id}`] })); return true; }
  if (message.type === 'set-enabled') { chrome.storage.session.set({ [`enabled:${message.tabId}`]: !!message.enabled }).then(() => ensureCollector(message.tabId, !!message.enabled)).then(() => message.enabled ? scheduleSync() : null).then(() => {hudStateChanged();respond({ ok: true })}).catch((error) => respond({ ok: false, error: error.message })); return true; }
  if (message.type === 'get-state') { chrome.storage.session.get(`enabled:${message.tabId}`).then((data) => respond({ enabled: !!data[`enabled:${message.tabId}`] })); return true; }
  if (message.type === 'get-journal-count') { flushPendingEvents().then(() => chrome.storage.local.get({ [STORE_KEY]: [] })).then((data) => respond({ count: data[STORE_KEY].length })); return true; }
  if (message.type === 'clear-journal') { pendingEvents = []; if (flushTimer) clearTimeout(flushTimer); flushTimer = null; flushChain.then(() => chrome.storage.local.set({ [STORE_KEY]: [],journalCount:0 })).then(() => {hudStateChanged();respond({ ok: true })}); return true; }
  if (message.type === 'get-sync-settings') { chrome.storage.local.get({ [SYNC_MODE_KEY]: '15s' }).then((data) => respond({ mode: SYNC_DELAYS[data[SYNC_MODE_KEY]] === undefined ? '15s' : data[SYNC_MODE_KEY] })); return true; }
  if (message.type === 'set-sync-mode') { const mode = SYNC_DELAYS[message.mode] === undefined ? '15s' : message.mode; chrome.storage.local.set({ [SYNC_MODE_KEY]: mode }).then(() => scheduleSync(true)).then(() => respond({ ok: true, mode })).catch((error) => respond({ ok: false, error: error.message })); return true; }
  if (message.type === 'login') { fetch(`${DASHBOARD_URL}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: message.identity, password: message.password }) }).then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.detail || 'Не удалось войти'); await chrome.storage.local.set({ authToken: data.token, authUser: data.user }); await scheduleSync(); hudStateChanged(true); respond({ ok: true, user: data.user }); }).catch(error => respond({ ok: false, error: error.message })); return true; }
  if (message.type === 'get-auth') { chrome.storage.local.get(['authToken', 'authUser']).then(data => respond({ signedIn: !!data.authToken, user: data.authUser || null })); return true; }
  if (message.type === 'logout') { chrome.storage.local.remove(['authToken', 'authUser']).then(() => {hudStateChanged(true);respond({ ok: true })}); return true; }
  if (message.type === 'city-context' && sender.tab && GAME_PATTERN.test(sender.tab.url || '')) {
    const key = `city:${sender.tab.id}`;
    if (typeof message.cityKey === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(message.cityKey)) void chrome.storage.session.set({ [key]: message.cityKey });
    else void chrome.storage.session.remove(key);
    return;
  }
  if (message.type === 'asset-urls' && sender.tab && GAME_PATTERN.test(sender.tab.url || '')) { const event = normaliseEvent({ at: new Date().toISOString(), kind: 'fetch', method: 'GET', path: '/api/client-assets', response: { assets: Array.isArray(message.assets) ? message.assets.slice(0, 500) : [] } }, new URL(sender.tab.url).pathname); if (event) void saveEvent(event); return; }
  if (message.type === 'svg-art' && sender.tab && GAME_PATTERN.test(sender.tab.url || '')) { const event = normaliseEvent({ at: new Date().toISOString(), kind: 'fetch', method: 'GET', path: '/api/client-art', response: { art: Array.isArray(message.art) ? message.art.slice(0, 250) : [] } }, new URL(sender.tab.url).pathname); if (event) void saveEvent(event); return; }
  if (message.type === 'doll-snapshot' && sender.tab && GAME_PATTERN.test(sender.tab.url || '')) { const event = normaliseEvent({ at: new Date().toISOString(), kind: 'fetch', method: 'GET', path: '/api/client-doll', response: { doll: message.doll || {} } }, new URL(sender.tab.url).pathname); if (event) void saveEvent(event); return; }
  if (message.type === 'network-event' && sender.tab && GAME_PATTERN.test(sender.tab.url || '')) { const event = normaliseEvent(briefQuestTelemetry(message.event), new URL(sender.tab.url).pathname); if (!event) return; void attachCity(sender.tab.id, event).then((allowed) => allowed && saveEvent(event)); }
});
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove([`enabled:${tabId}`, `city:${tabId}`]));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => { if (!GAME_PATTERN.test(tab.url || '') || !['loading', 'complete'].includes(changeInfo.status)) return; chrome.storage.session.get(`enabled:${tabId}`).then((data) => { if (data[`enabled:${tabId}`]) return ensureCollector(tabId, true).catch(() => {}); }); });
