const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('disabled collector does not clone bodies; enabled collector strips chat and credentials', async () => {
  const listeners = {}, sent = [];
  let clones = 0;
  const sandbox = {
    URL, URLSearchParams, performance, Date,
    location: { href: 'https://play.multidonate.ru/c/test/', origin: 'https://play.multidonate.ru' },
    document: { addEventListener() {} },
    XMLHttpRequest: function() {},
  };
  sandbox.XMLHttpRequest.prototype = { open() {}, send() {} };
  sandbox.window = {
    fetch: async () => ({ status: 200, headers: { get: () => 'application/json' }, clone() { clones++; return { text: async () => JSON.stringify({ hero: { money: 42 }, chat: [{ text: 'private' }], token: 'secret' }) }; } }),
    addEventListener(type, listener) { listeners[type] = listener; },
    postMessage(message) { sent.push(message); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'collector-main.js'), 'utf8'), sandbox);
  await sandbox.window.fetch('/api/me');
  assert.equal(clones, 0);
  listeners.message({ source: sandbox.window, data: { source: 'zakviel-market-addon', type: 'collector-state', enabled: true } });
  await sandbox.window.fetch('/api/me');
  await new Promise(setImmediate);
  assert.equal(clones, 1);
  assert.equal(sent[0].event.response.hero.money, 42);
  assert.equal(sent[0].event.response.token, '[скрыто]');
  assert.equal(sent[0].event.response.chat, undefined);
  await sandbox.window.fetch('/api/city/say', { method: 'POST', body: '{"text":"private"}' });
  assert.equal(clones, 1);
  await sandbox.window.fetch('/api/dm/send', {method:'POST',body:'{"text":"private"}'});
  await sandbox.window.fetch('/api/friends/list');
  assert.equal(clones, 1);
});

test('new private SSE dm and friends events are delivered to the game without telemetry', () => {
  const sent=[],callbacks={};let stateListener;
  class Stream {addEventListener(type,fn){callbacks[type]=fn;}}
  function Xhr(){}Xhr.prototype={open(){},send(){}};
  const window={fetch:async()=>{},EventSource:Stream,postMessage:message=>sent.push(message),addEventListener:(_type,fn)=>{stateListener=fn;}};
  const sandbox={window,XMLHttpRequest:Xhr,URL,URLSearchParams,performance,Date,document:{addEventListener(){}},location:{href:'https://play.multidonate.ru/c/test/',origin:'https://play.multidonate.ru'}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','src','runtime','collector-main.js'),'utf8'),sandbox);
  stateListener({source:window,data:{source:'zakviel-market-addon',type:'collector-state',enabled:true}});
  const stream=new window.EventSource('/api/live');let delivered=0;
  stream.addEventListener('dm',()=>delivered++);stream.addEventListener('friends',()=>delivered++);stream.addEventListener('fr',()=>delivered++);
  const count=sent.length;callbacks.dm({data:'{"text":"secret"}'});callbacks.friends({data:'{"list":["private"]}'});callbacks.fr({data:'{"login":"private"}'});
  assert.equal(delivered,3);assert.equal(sent.length,count);
});

test('bridge creates no observers or intervals until enabled; disabling releases them', async () => {
  let runtimeListener, observers = 0, disconnects = 0, intervals = 0, cleared = 0;
  const sandbox = {
    document: { documentElement: {}, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null },
    location: { origin: 'https://play.multidonate.ru', href: 'https://play.multidonate.ru/c/test/' },
    sessionStorage: { getItem: () => null },
    chrome: { runtime: { onMessage: { addListener(fn) { runtimeListener = fn; } }, sendMessage: async () => ({ enabled: false }) } },
    MutationObserver: class { constructor() { observers++; } observe() {} disconnect() { disconnects++; } },
    setTimeout: () => 1, clearTimeout() {},
    setInterval: () => { intervals++; return 1; }, clearInterval: () => { cleared++; },
    addEventListener() {}, window: { addEventListener() {}, postMessage() {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'content-bridge.js'), 'utf8'), sandbox);
  await new Promise(setImmediate);
  assert.equal(observers, 0); assert.equal(intervals, 0);
  runtimeListener({ type: 'collector-state', enabled: true });
  assert.equal(observers, 1); assert.equal(intervals, 1);
  runtimeListener({ type: 'collector-state', enabled: false });
  assert.equal(disconnects, 1); assert.equal(cleared, 1);
});
