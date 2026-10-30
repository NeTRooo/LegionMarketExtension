// Real Firefox WebExtension compartment regression. No game/server account used.
// Requires Firefox, Python 3 and geckodriver already running on 127.0.0.1:18875.
// Generated files stay under .data/; only a temporary test profile is used.
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),work=path.join(root,'.data/firefox-compartment');
let server,session;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function command(method,route,body){
  const response=await fetch('http://127.0.0.1:18875'+route,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();if(!response.ok||result.value?.error)throw Error(JSON.stringify(result));return result.value;
}
const fixture=`window.fixture={errors:[],events:[],sse:0};
addEventListener('error',event=>fixture.errors.push(event.message));
addEventListener('message',event=>{try{const data=typeof event.data==='string'?JSON.parse(event.data):event.data;if(data?.source==='zakviel-market-addon'&&data.type==='network-event')fixture.events.push(data.event);}catch{}});
function finish(result){document.body.dataset.result=JSON.stringify({...result,addon:document.documentElement.dataset.addon,compatibility:document.documentElement.dataset.compatibility,addonError:document.documentElement.dataset.addonError,errors:fixture.errors});}
try{
  const mode=new URL(location.href).searchParams.get('mode');
  // Match the game's verCheck/news chain before touching EventSource.
  const version=fetch('/site/ver').then(response=>response.json()).then(value=>value.v==='fixture');
  const news=fetch('/news').then(response=>response.json()).then(value=>value.ok);
  const stream=new EventSource('/events');fixture.sse++;let received=0;
  stream.addEventListener('q',()=>{received++;stream.close();});
  Promise.all([
    version,
    news,
    fetch('/api/me').then(response=>response.json()).then(value=>value.hero.money===42),
    new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('GET','/api/xhr');xhr.onload=()=>resolve(JSON.parse(xhr.responseText).ok);xhr.onerror=reject;xhr.send();})
  ]).then(async values=>{
    let rejection=false;try{await fetch('http://127.0.0.1:1/unreachable');}catch(error){rejection=!!error.name&&typeof error.message==='string';}
    await new Promise(resolve=>setTimeout(resolve,300));
    finish({ok:values.every(Boolean),rejection,sse:received,pagePromise:fetch('/site/ver') instanceof Promise,events:fixture.events.length,mode});
  }).catch(error=>finish({ok:false,error:String(error)}));
}catch(error){finish({ok:false,error:String(error)});}`;
(async()=>{
  await fs.mkdir(path.join(work,'profile'),{recursive:true});
  const platform=(await fs.readFile(path.join(root,'src/tampermonkey/platform.mjs'),'utf8')).replace(/^export /gm,'');
  const compatibility=(await fs.readFile(path.join(root,'src/tampermonkey/compatibility.mjs'),'utf8')).replace(/^export /gm,'');
  const collector=(await fs.readFile(path.join(root,'src/runtime/collector-main.js'),'utf8')).replace('window.postMessage({ source, type: \'network-event\', event }, location.origin)', 'window.postMessage(JSON.stringify({ source, type: \'network-event\', event }), location.origin)');
  // The broken mode intentionally uses the former unexported hooks. It must
  // reproduce the reported permission failure before the fixed mode is tested.
  const content=`document.addEventListener('DOMContentLoaded',()=>document.documentElement.dataset.addon='running');try{(()=>{const page=window.wrappedJSObject;${platform}
    ${compatibility}
    const runtime=createBrowserRuntime(window,{GM_getValue(){}});
    if(!runtime.supported)throw Error(runtime.missing.join(', '));
    document.addEventListener('DOMContentLoaded',()=>document.documentElement.dataset.compatibility='ready');
    const AbortController=runtime.AbortController,AbortSignal=runtime.AbortSignal;
    const mode=new URL(location.href).searchParams.get('mode');
    const pageBindings=mode==='broken'?{expose:fn=>fn,object:()=>({})}:createPageBindings(page,exportFunction);
    (function(window,XMLHttpRequest,URL,URLSearchParams,HTMLFormElement){${collector}})(page,page.XMLHttpRequest,page.URL,page.URLSearchParams,page.HTMLFormElement);
    if(mode==='enabled')page.__zakvielMarketAddon.enabled=true;
  })();}catch(error){document.addEventListener('DOMContentLoaded',()=>document.documentElement.dataset.addonError=String(error));}`;
  const manifest={manifest_version:2,name:'Legion compartment regression',version:'1.0',permissions:['http://127.0.0.1/*'],browser_specific_settings:{gecko:{id:'legion-compartment-regression@example.invalid'}},content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js'],run_at:'document_start'}]};
  await fs.writeFile(path.join(work,'content.js'),content);await fs.writeFile(path.join(work,'manifest.json'),JSON.stringify(manifest));
  const xpi=path.join(work,'regression.xpi');
  execFileSync('python3',['-c','import sys,zipfile,pathlib; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w"); [z.write(p/n,n) for n in ["manifest.json","content.js"]]; z.close()',work,xpi]);
  server=http.createServer((req,res)=>{
    if(req.url.startsWith('/fixture.js')){res.writeHead(200,{'content-type':'text/javascript'});res.end(fixture);}
    else if(req.url==='/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.end('event: q\ndata: {"on":false}\n\n');}
    else if(req.url.startsWith('/site/ver')||req.url==='/news'||req.url.startsWith('/api/')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,v:'fixture',hero:{money:42}}));}
    else{res.writeHead(200,{'content-type':'text/html','content-security-policy':"script-src 'self'; object-src 'none'"});res.end('<!doctype html><body><script src="/fixture.js"></script></body>');}
  });
  await new Promise(resolve=>server.listen(18876,'127.0.0.1',resolve));
  // geckodriver is started separately; never attach to a real browser profile.
  let ready=false;for(let i=0;i<100;i++){try{await command('GET','/status');ready=true;break;}catch{await pause(100);}}
  if(!ready)throw Error('geckodriver did not start');
  const value=await command('POST','/session',{capabilities:{alwaysMatch:{browserName:'firefox','moz:firefoxOptions':{binary:process.env.FIREFOX_PATH||'/snap/firefox/current/usr/lib/firefox/firefox',args:['-headless'],prefs:{'browser.shell.checkDefaultBrowser':false,'extensions.logging.enabled':true}}}}});
  session=value.sessionId;
  await command('POST',`/session/${session}/moz/addon/install`,{path:xpi,temporary:true,allowPrivateBrowsing:true});
  await pause(500);
  const results={};
  for(const mode of ['broken','disabled','enabled']){
    await command('POST',`/session/${session}/url`,{url:`http://127.0.0.1:18876/?mode=${mode}`});
    let result;for(let i=0;i<100;i++){const text=await command('POST',`/session/${session}/execute/sync`,{script:'return document.body.dataset.result||null',args:[]});if(text){result=JSON.parse(text);break;}await pause(100);}
    if(!result)throw Error('No fixture result: '+mode);
    results[mode]=result;
  }
  assert.equal(results.broken.ok,false);assert.match(results.broken.error,/Permission denied/);
  for(const mode of ['disabled','enabled']){assert.equal(results[mode].addon,'running');assert.equal(results[mode].compatibility,'ready');assert.equal(results[mode].addonError,undefined);assert.equal(results[mode].ok,true);assert.equal(results[mode].pagePromise,true);assert.equal(results[mode].rejection,true);assert.equal(results[mode].sse,1);assert.deepEqual(results[mode].errors,[]);}
  assert.equal(results.disabled.events,0);assert(results.enabled.events>0);
  console.log(JSON.stringify({browserVersion:value.capabilities.browserVersion,realFirefox:true,strictCsp:true,results},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(session)await command('DELETE',`/session/${session}`).catch(()=>{});
  if(server)await new Promise(resolve=>server.close(resolve));
});
