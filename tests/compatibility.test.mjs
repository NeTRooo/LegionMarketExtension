import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createBrowserRuntime,showCompatibilityFailure} from '../src/tampermonkey/compatibility.mjs';
const manager={GM_getValue(){},GM_xmlhttpRequest(){}};
const scope=()=>({fetch(){},XMLHttpRequest:class{},AbortController,AbortSignal,DOMException,MutationObserver:class{},TextEncoder,Element:class{attachShadow(){}},HTMLDialogElement:class{showModal(){}},crypto:{randomUUID:()=> 'native-id',getRandomValues:bytes=>bytes.fill(1)},setTimeout,clearTimeout});
test('modern browser APIs retain native controller, timeout and UUID implementations',()=>{
  const runtime=createBrowserRuntime(scope(),manager);
  assert(runtime.supported);assert.deepEqual(runtime.missing,[]);assert.equal(runtime.AbortController,AbortController);assert.equal(runtime.AbortSignal,AbortSignal);assert.equal(runtime.tabId(),'native-id');
});
test('UUID fallback uses cryptographic randomness with RFC4122 version and variant',()=>{
  const browser=scope();delete browser.crypto.randomUUID;
  assert.match(createBrowserRuntime(browser,manager).tabId(),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('local fallbacks support browsers without timeout/throwIfAborted and never patch global prototypes',()=>{
  class Signal extends EventTarget{aborted=false;reason=undefined;}
  class Controller{signal=new Signal();abort(reason){this.signal.aborted=true;this.signal.reason=reason;this.signal.dispatchEvent(new Event('abort'));}}
  let trigger,cleared=0;const browser={...scope(),AbortController:Controller,AbortSignal:Signal,setTimeout:fn=>{trigger=fn;return 1;},clearTimeout:()=>cleared++};
  const runtime=createBrowserRuntime(browser,manager),signal=runtime.AbortSignal.timeout(10);
  assert.equal(Signal.prototype.throwIfAborted,undefined);assert.equal(Signal.timeout,undefined);signal.throwIfAborted();trigger();
  assert.equal(signal.reason.name,'TimeoutError');assert.throws(()=>signal.throwIfAborted(),{name:'TimeoutError'});assert.equal(cleared,1);assert.throws(()=>runtime.AbortSignal.timeout(-1),RangeError);
});
test('missing manager and browser features are reported before collector installation',()=>{
  const browser=scope();delete browser.crypto.getRandomValues;browser.HTMLDialogElement=undefined;
  const result=createBrowserRuntime(browser,{...manager,GM_getValue:null});
  assert.equal(result.supported,false);assert.deepEqual(result.missing,['GM_getValue','dialog.showModal','crypto.getRandomValues']);
});
test('unsupported environment banner uses text and is installed only once',()=>{
  let installed;const document={getElementById:()=>installed,createElement:()=>({style:{},setAttribute(){}}),documentElement:{append:node=>{installed=node;}}};
  showCompatibilityFailure(document,['GM_getValue']);assert.match(installed.textContent,/GM_getValue/);assert.equal(installed.id,'zma-compatibility-error');const original=installed;showCompatibilityFailure(document,['other']);assert.equal(installed,original);
});
test('built userscript leaves game hooks untouched when Tampermonkey grants are missing',async()=>{
  const fetch=()=>{},window={fetch};window.top=window;
  let installed,touches=0;
  const unsafeWindow=new Proxy({}, {get(){touches++;throw Error('Game accessed before preflight');}});
  const document={getElementById:()=>installed,createElement:()=>({style:{},setAttribute(){}}),documentElement:{append:node=>{installed=node;}}};
  const errors=[];
  const script=await readFile(new URL('../dist/ZakvielMarket.user.js',import.meta.url),'utf8');
  await vm.runInNewContext(script,{window,unsafeWindow,document,console:{error:(...values)=>errors.push(values)}});
  assert.equal(touches,0);assert.equal(window.fetch,fetch);assert.equal(installed.id,'zma-compatibility-error');assert.deepEqual(errors,[]);
});
