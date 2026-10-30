import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const platform=(await read('src/tampermonkey/platform.mjs')).replace(/^export /gm,'');
let collector=await read('src/runtime/collector-main.js');
collector=collector.replace("window.postMessage({ source, type: 'network-event', event }, location.origin)",'deliverEvent(event)');
collector=collector.replace(/  window\.addEventListener\('message', .*\n/, '  setCollector = value => { state.enabled = !!value; };\n');
// Do not interfere with the native auction forms.
collector=collector.replace(/  document\.addEventListener\('submit',[\s\S]*?\n  }, true\);\n/,'');
let bridge=await read('src/runtime/content-bridge.js');
bridge=bridge.replace(/  window\.addEventListener\('message',[\s\S]*?\n  }\);/,`  deliverEvent = event => {
    if (!enabled) return;
    globalThis.__zmaPriest?.ingest(event);
    void chrome.runtime.sendMessage({type:'network-event',event});
  };`);
bridge=bridge.replace('window.postMessage({ source: MESSAGE_SOURCE, type: \'collector-state\', enabled }, location.origin);','setCollector(enabled);');
const ui=(await read('build/auction.js')).replaceAll('popup расширения','настройки Market').replaceAll('popup','настройки Market').replaceAll('Аккаунт расширения:','Аккаунт Market:').replaceAll('хранилище расширения','хранилище Tampermonkey').replaceAll('настройки расширения','настройки Market').replaceAll('Перезагрузите расширение','Обновите userscript');
const worker=(await read('build/worker.js')).replaceAll('popup расширения','настройки Market').replaceAll('popup','настройки Market');
const panel=(await read('src/runtime/auction-panel.js')).replaceAll('popup расширения','настройки Market').replaceAll('Перезагрузите расширение','Обновите userscript');
const hud=(await read('src/runtime/hud-panel.js')).replaceAll('popup расширения','настройки Market').replaceAll('Расширение перезагружено','Userscript обновлён');
const header=`// ==UserScript==
// @name         Zakviel Market Addon
// @namespace    zakviel-market-addon
// @version      0.11.0
// @description  Аукцион, игроки, HUD и помощник жреца поверх Легиона
// @homepageURL  https://github.com/NeTRooo/LegionMarketExtension
// @supportURL   https://github.com/NeTRooo/LegionMarketExtension/issues
// @downloadURL  https://raw.githubusercontent.com/NeTRooo/LegionMarketExtension/main/dist/ZakvielMarket.user.js
// @updateURL    https://raw.githubusercontent.com/NeTRooo/LegionMarketExtension/main/dist/ZakvielMarket.user.js
// @match        https://play.multidonate.ru/c/*
// @run-at       document-start
// @noframes
// @sandbox      JavaScript
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_getTabs
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @connect      127.0.0.1
// ==/UserScript==
`;
const output=header+`\n(async function(){
'use strict';
if(window.top!==window)return;
if(unsafeWindow.__zakvielMarketAddon){console.warn('Zakviel Market: отключите старое расширение или второй экземпляр userscript и перезагрузите игру.');return;}
// Local shared module registry; never assigned to the game window.
const globalThis=Object.create(null);
let deliverEvent=()=>{},setCollector=()=>{};
(function(window,XMLHttpRequest,URL,URLSearchParams,HTMLFormElement){${collector}\n})(unsafeWindow,unsafeWindow.XMLHttpRequest,unsafeWindow.URL,unsafeWindow.URLSearchParams,unsafeWindow.HTMLFormElement);
${platform}
const tabState=await new Promise(resolve=>GM_getTab(resolve));
if(!tabState.zmaId){tabState.zmaId=crypto.randomUUID();GM_saveTab(tabState);}
const gmStore={get:GM_getValue,set:GM_setValue,delete:GM_deleteValue,list:GM_listValues};
const otherTabs=await new Promise(resolve=>GM_getTabs(resolve));
recoverQueues(gmStore,tabState.zmaId,Object.values(otherTabs).map(tab=>tab.zmaId).filter(Boolean));
const scripts=new Map();
const platform=createPlatform({get:GM_getValue,set:GM_setValue,delete:GM_deleteValue,listen:GM_addValueChangeListener,open:url=>GM_openInTab(url,{active:true,insert:true})},tabState.zmaId,()=>location.href,async file=>{if(!scripts.has(file))throw Error('Неизвестный модуль');scripts.get(file)();});
const chrome=platform.client;globalThis.chrome=chrome;
const serverFetch=serverTransport(GM_xmlhttpRequest);
scripts.set('auction-ui/auction.js',()=>{${ui}\n});
scripts.set('content-bridge.js',()=>{});scripts.set('collector-main.js',()=>{});scripts.set('auction-panel.js',()=>{});scripts.set('hud-panel.js',()=>{});
(function(chrome,fetch){${worker}\n})(platform.worker,serverFetch);
${await read('build/runtime.js')}
${bridge}
${panel}
${hud}
${await read('src/tampermonkey/settings.js')}
const ready=()=>{installSettings(platform);void platform.settings({type:'set-sync-mode',mode:GM_getValue('zma:syncMode','15s')});};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})().catch(error=>console.error('Zakviel Market:',error));\n`;
await mkdir(new URL('dist/',root),{recursive:true});
await writeFile(new URL('dist/ZakvielMarket.user.js',root),output);
console.log(`Tampermonkey: ${fileURLToPath(new URL('dist/ZakvielMarket.user.js',root))} (${Math.round(Buffer.byteLength(output)/1024)} KB)`);
