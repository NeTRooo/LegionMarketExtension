// Browser selection is based on available APIs, never on user-agent strings.
export function createBrowserRuntime(scope, manager) {
  const missing=Object.entries(manager).filter(([,value])=>typeof value!=='function').map(([name])=>name);
  for(const name of ['fetch','XMLHttpRequest','AbortController','AbortSignal','DOMException','MutationObserver','TextEncoder'])if(typeof scope[name]!=='function')missing.push(name);
  if(typeof scope.Element?.prototype?.attachShadow!=='function')missing.push('Shadow DOM');
  if(typeof scope.HTMLDialogElement?.prototype?.showModal!=='function')missing.push('dialog.showModal');
  if(typeof scope.crypto?.getRandomValues!=='function')missing.push('crypto.getRandomValues');
  if(missing.length)return {supported:false,missing};
  const NativeController=scope.AbortController,NativeSignal=scope.AbortSignal;
  const Controller=typeof NativeSignal.prototype.throwIfAborted==='function'?NativeController:class extends NativeController {
    constructor(){super();Object.defineProperty(this.signal,'throwIfAborted',{value(){if(this.aborted)throw this.reason||new scope.DOMException('Aborted','AbortError');}});}
  };
  const Signal=typeof NativeSignal.timeout==='function'&&typeof NativeSignal.prototype.throwIfAborted==='function'?NativeSignal:{timeout(ms){
    if(!Number.isInteger(ms)||ms<0||ms>2147483647)throw new RangeError('Invalid timeout');
    const controller=new Controller();
    const timer=scope.setTimeout(()=>controller.abort(new scope.DOMException('Сервер не ответил','TimeoutError')),ms);
    controller.signal.addEventListener('abort',()=>scope.clearTimeout(timer),{once:true});
    return controller.signal;
  }};
  return {supported:true,missing:[],AbortController:Controller,AbortSignal:Signal,
    tabId(){
      if(typeof scope.crypto.randomUUID==='function')return scope.crypto.randomUUID();
      const bytes=new Uint8Array(16);scope.crypto.getRandomValues(bytes);bytes[6]=bytes[6]&15|64;bytes[8]=bytes[8]&63|128;
      const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    },
  };
}

export function showCompatibilityFailure(document,missing) {
  const show=()=>{
    if(document.getElementById('zma-compatibility-error'))return;
    const message=document.createElement('aside');message.id='zma-compatibility-error';message.setAttribute('role','alert');
    message.style.cssText='position:fixed;top:12px;right:12px;max-width:420px;padding:16px;background:#302032;color:#fff;border:1px solid #f99;border-radius:10px;z-index:2147483647;font:14px/1.5 system-ui';
    message.textContent='Zakviel Market: обновите браузер и Tampermonkey, разрешите выполнение userscript. Недоступны: '+missing.join(', ')+'.';
    document.documentElement.append(message);
  };
  if(document.documentElement)show();else document.addEventListener('DOMContentLoaded',show,{once:true});
}
