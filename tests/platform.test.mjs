import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createPlatform,serverTransport,recoverQueues,createPageBindings} from '../src/tampermonkey/platform.mjs';

test('Firefox hooks export functions and return promises, state and errors owned by the page',async()=>{
  const page=vm.runInNewContext('({Promise,Error,Object})'),exported=[];
  const bindings=createPageBindings(page,(fn,target)=>{assert.equal(target,page);exported.push(fn);return fn;});
  assert(bindings.object() instanceof page.Object);
  const response=new page.Object();response.ok=true;
  const context={request:true};
  const fetch=bindings.expose(async function(input){assert.equal(this,context);assert.equal(input,'/site/ver');return response;},true);
  const promise=fetch.call(context,'/site/ver');
  assert(promise instanceof page.Promise);assert(!(promise instanceof Promise));
  assert.equal(await promise.then(value=>value).finally(()=>{}),response);
  assert(exported.includes(fetch));assert.equal(exported.length,2);
  const failed=bindings.expose(async()=>{throw new TypeError('fixture failure');},true);
  await assert.rejects(failed(),error=>error instanceof page.Error&&error.name==='TypeError'&&error.message==='fixture failure');
  const native=new page.Error('native');
  await assert.rejects(bindings.expose(()=>Promise.reject(native),true)(),error=>error===native);
  const open=bindings.expose(function(method,url){assert.equal(this,context);return method+url;});
  assert.equal(open.call(context,'GET','/news'),'GET/news');
  assert.throws(bindings.expose(()=>{throw new Error('sync');}),error=>error instanceof page.Error&&error.message==='sync');
});
test('same-context browsers retain original callable identity without Firefox export APIs',()=>{
  const fn=()=>42,bindings=createPageBindings({},null);
  assert.equal(bindings.expose(fn),fn);assert.equal(bindings.expose(fn,true),fn);
  assert.deepEqual(bindings.object(),{});
});

function storage(){const data=new Map(),listeners=new Map();return {data,get:(key,fallback)=>data.has(key)?data.get(key):fallback,set:(key,value)=>data.set(key,value),delete:key=>data.delete(key),listen:(key,fn)=>listeners.set(key,fn),open(){},listeners};}
test('recover closed tabs without touching active queues; expire seven-day data and bound merged journal',()=>{
  const gm=storage();gm.list=()=>[...gm.data.keys()];const now=10*86400000;
  for(const [id,at,count] of [['closed',now-120000,600],['active',now-120000,1],['expired',1,1]]){
    gm.set(`zma:tab:${id}:lastSeen`,at);gm.set(`zma:tab:${id}:networkJournal`,Array.from({length:count},(_,i)=>({id:`${id}-${i}`})));
  }
  gm.set('zma:tab:current:journalFormatVersion',3);
  recoverQueues(gm,'current',['active'],now);
  const recovered=gm.get('zma:tab:current:networkJournal');assert.equal(recovered.length,500);
  assert(recovered.every(event=>event.id.startsWith('closed')));
  assert.equal(gm.get('zma:tab:active:networkJournal').length,1);
  assert.equal(gm.get('zma:tab:closed:networkJournal'),undefined);assert.equal(gm.get('zma:tab:expired:networkJournal'),undefined);
});
const url=()=> 'https://play.multidonate.ru/c/test/';
test('account settings shared, bounded journal isolated per tab, collection session never persisted',async()=>{
  const gm=storage(),a=createPlatform(gm,'a',url,async()=>{}),b=createPlatform(gm,'b',url,async()=>{});
  await a.worker.storage.local.set({authToken:'test-token',networkJournal:[{path:'/api/me'}],journalCount:1});
  assert.equal((await b.client.storage.local.get('authToken')).authToken,'test-token');
  assert.deepEqual(await b.client.storage.local.get({networkJournal:[]}),{networkJournal:[]});
  await a.worker.storage.session.set({'enabled:a':true});
  const reloaded=createPlatform(gm,'a',url,async()=>{});
  assert.equal((await reloaded.worker.storage.session.get('enabled:a'))['enabled:a'],undefined);
  assert.equal((await reloaded.client.storage.local.get('networkJournal')).networkJournal.length,1);
});
test('request contexts and notification routes remain separate',async()=>{
  const platform=createPlatform(storage(),'tab',url,async()=>{}),notifications=[];
  platform.worker.runtime.onMessage.addListener((message,sender,respond)=>{respond({url:sender.url,id:sender.tab?.id,message});return true;});
  assert.equal((await platform.client.runtime.sendMessage({type:'get-auth'})).id,'tab');
  assert.equal((await platform.settings({type:'get-auth'})).url,'userscript:settings');
  platform.client.runtime.onMessage.addListener(value=>notifications.push(value));
  await platform.worker.tabs.sendMessage('tab',{type:'collector-state',enabled:false});
  assert.equal(notifications[0].enabled,false);
});
test('remote account changes notify modules without exposing token values in messages',async()=>{
  const gm=storage(),platform=createPlatform(gm,'a',url,async()=>{}),notifications=[];
  platform.client.runtime.onMessage.addListener(message=>notifications.push(message));
  await platform.client.storage.local.get('authToken');
  gm.listeners.get('zma:authToken')('zma:authToken','old','new-secret',true);
  assert.deepEqual(notifications,[{type:'hud-state-changed',configuration:true}]);
});
test('GM transport allows local API only, sends no game cookies, parses status and JSON',async()=>{
  let options;
  const fetch=serverTransport(value=>{options=value;queueMicrotask(()=>value.onload({status:200,responseText:'{"ok":true}',finalUrl:value.url}));return {abort(){}};});
  const response=await fetch('http://127.0.0.1:4173/api/auth/login',{method:'POST',body:'{}'});
  assert.equal(response.ok,true);assert.deepEqual(await response.json(),{ok:true});assert.equal(options.anonymous,true);assert.equal(options.redirect,'error');
  await assert.rejects(fetch('https://example.org/api/auth/login'));
  await assert.rejects(fetch('http://127.0.0.1:4173/not-api'));
});
test('GM transport propagates aborts and refuses redirected credentials',async()=>{
  let aborted=0;
  const controller=new AbortController();
  const fetch=serverTransport(()=>({abort(){aborted++;}}));
  const response=fetch('http://127.0.0.1:4173/api/hud',{signal:controller.signal});controller.abort();
  await assert.rejects(response,{name:'AbortError'});assert.equal(aborted,1);
  const redirected=serverTransport(options=>{queueMicrotask(()=>options.onload({status:200,responseText:'{}',finalUrl:'https://example.org/api/hud'}));return {};});
  await assert.rejects(redirected('/api/hud'),/Перенаправление/);
});
test('synchronous GM permission errors reject and release the timeout',async()=>{
  const fetch=serverTransport(()=>{throw Error('GM permission denied');});
  await assert.rejects(fetch('/api/hud'),/GM permission denied/);
});
