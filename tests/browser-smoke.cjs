// Run with PLAYWRIGHT_MODULE and TAMPERMONKEY_EXTENSION pointing to local installs.
// Uses only synthetic game/API data on a private fixture port. A profile-local
// proxy isolates the hardcoded API origin from a running real market server.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const userScript=path.join(root,'dist/ZakvielMarket.user.js');
const user={id:'tm-smoke-user',login:'tm-smoke'};
const imported=[],requests=[],errors=[];let context,server;
const fixturePort=Number(process.env.ZMA_TEST_API_PORT||18173);
const now=()=>new Date().toISOString();
const analysis=()=>({channel:'test',updatedAt:now(),computedAt:now(),stale:false,periodDays:7,lots:[],groups:{},channels:[{id:'test',updatedAt:now()}],cities:[],historyNote:'Test fixture',historyTruncated:false,methodVersion:'fixture'});
(async()=>{
  server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1:4173');
    if(url.pathname==='/__zma_fixture_probe'){res.writeHead(200,{'content-type':'text/plain'});res.end('zma-isolated-test-api');return;}
    if(url.origin!=='http://127.0.0.1:4173'||!url.pathname.startsWith('/api/')){req.resume();res.writeHead(404);res.end('{}');return;}
    req.url=url.pathname+url.search;
    const buffers=[];for await(const buffer of req)buffers.push(buffer);
    const body=buffers.length?JSON.parse(Buffer.concat(buffers)):null;
    requests.push({path:req.url,method:req.method,authorization:req.headers.authorization});
    let data={};
    if(req.url==='/api/auth/login')data={token:'tm-fixture-token',user};
    else if(req.url==='/api/import'){imported.push(...body.events);data={ok:true};}
    else if(req.url.startsWith('/api/auction/analysis'))data=analysis();
    else if(req.url.startsWith('/api/players'))data={enabled:true,people:[],channels:['test'],retentionHours:24,onlineSeconds:90,sources:{}};
    else if(req.url.startsWith('/api/hud'))data={enabled:true,serverTime:now(),inventory:{value:100,quantity:1,unknownQuantity:0,note:'fixture',updatedAt:now()},signals:[],favorites:['REMOVED_FAVORITE'],builds:['REMOVED_BUILD'],plans:['REMOVED_PLAN'],priest:{reason:'REMOVED_PRIEST'}};
    else if(req.url==='/api/settings')data={modules:{hud:true,players:true},privacy:{presenceRetentionHours:24}};
    else{res.writeHead(404);res.end('{}');return;}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));
  });
  server.on('connect',(_req,socket)=>{socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');});
  await new Promise((resolve,reject)=>server.listen(fixturePort,'127.0.0.1',resolve).once('error',reject));
  const managerFixture=process.env.GM_FIXTURE==='1';
  const extension=process.env.TAMPERMONKEY_EXTENSION;if(!extension&&!managerFixture)throw Error('Set TAMPERMONKEY_EXTENSION');
  context=await chromium.launchPersistentContext(process.env.TAMPERMONKEY_PROFILE||path.join(root,'.data/tampermonkey-smoke'),{
    executablePath:process.env.CHROMIUM_PATH||'/snap/bin/chromium',headless:process.env.BROWSER_HEADLESS!=='0',ignoreDefaultArgs:['--disable-extensions'],
    args:['--no-sandbox',`--proxy-server=http://127.0.0.1:${fixturePort}`,'--proxy-bypass-list=<-loopback>',...(managerFixture?[]:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`])],
  });
  context.on('page',page=>page.on('dialog',dialog=>void dialog.accept()));
  if(managerFixture){
    // Explicit test double for browsers whose automation mode refuses loading
    // extensions. This validates browser functionality, not manager isolation.
    await context.exposeBinding('__fixtureGMRequest',async(_source,request)=>{
      const url=new URL(request.url);
      if(url.origin!=='http://127.0.0.1:4173'||!url.pathname.startsWith('/api/'))throw Error('Fixture URL rejected');
      const target=new URL(url.pathname+url.search,`http://127.0.0.1:${fixturePort}`);
      const response=await fetch(target,{method:request.method,headers:request.headers,body:request.data,redirect:'error'});
      return {status:response.status,responseText:await response.text(),finalUrl:url.href};
    });
    const fixture=`(()=>{
      const key='test-only-gm-storage',tabKey='test-only-gm-tab';
      const get=()=>JSON.parse(localStorage.getItem(key)||'{}');
      Object.assign(window,{
        unsafeWindow:window,
        GM_getValue:(name,fallback)=>{const values=get();return name in values?values[name]:fallback;},
        GM_setValue:(name,value)=>{const values=get();values[name]=value;localStorage.setItem(key,JSON.stringify(values));},
        GM_deleteValue:name=>{const values=get();delete values[name];localStorage.setItem(key,JSON.stringify(values));},
        GM_listValues:()=>Object.keys(get()),GM_addValueChangeListener:()=>1,
        GM_getTab:callback=>callback(JSON.parse(sessionStorage.getItem(tabKey)||'{}')),
        GM_saveTab:value=>sessionStorage.setItem(tabKey,JSON.stringify(value)),
        GM_getTabs:callback=>callback({current:JSON.parse(sessionStorage.getItem(tabKey)||'{}')}),
        GM_openInTab:()=>{},GM_registerMenuCommand:()=>{},
        GM_xmlhttpRequest:options=>{let aborted=false;window.__fixtureGMRequest({url:options.url,method:options.method,headers:options.headers,data:options.data}).then(response=>{if(!aborted)options.onload(response);},()=>{if(!aborted)options.onerror();});return {abort(){aborted=true;options.onabort?.();}};}
      });
    })();`;
    await context.addInitScript({content:fixture+'\n'+fs.readFileSync(userScript,'utf8')});
  }else{
  // Yandex has built-in service workers. Select the loaded manager by its
  // manifest, never whichever background worker happened to start first.
  const expected=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));
  let worker;
  for(let attempt=0;attempt<100&&!worker;attempt++){
    for(const candidate of context.serviceWorkers()){
      const matches=await candidate.evaluate(expected=>{const manifest=chrome.runtime.getManifest();return manifest.version===expected.version&&manifest.options_page===expected.options_page&&manifest.action?.default_popup===expected.action?.default_popup;},expected).catch(()=>false);
      if(matches){worker=candidate;break;}
    }
    if(!worker)await new Promise(resolve=>setTimeout(resolve,100));
  }
  const probe=await context.newPage();await probe.goto('http://127.0.0.1:4173/__zma_fixture_probe');
  assert.equal(await probe.locator('body').innerText(),'zma-isolated-test-api','Test browser must be isolated from the real API');await probe.close();
  if(!worker){console.error('Workers',await Promise.all(context.serviceWorkers().map(async candidate=>({url:candidate.url(),manifest:await candidate.evaluate(()=>{const value=chrome.runtime.getManifest();return {name:value.name,version:value.version,popup:value.action?.default_popup,options:value.options_page};}).catch(()=>null)}))));throw Error('Tampermonkey service worker did not start');}
  const id=worker.url().split('/')[2];
  const permission=await context.newPage();await permission.goto(`chrome://extensions/?id=${id}`);
  await permission.evaluate(async id=>chrome.developerPrivate.updateExtensionConfiguration({extensionId:id,userScriptsAccess:true}),id);
  const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
  await options.locator('input[type=file]').setInputFiles({name:'ZakvielMarket.user.js',mimeType:'text/javascript',buffer:fs.readFileSync(userScript)});
  const ask=await context.waitForEvent('page',{predicate:page=>page.url().includes('/ask.html')}).catch(()=>null);
  const installer=ask||context.pages().find(page=>page.url().includes('/ask.html'));
  await Promise.all([installer.waitForEvent('close'),installer.locator('input[value="Установить"],input[value="Переустановить"],input[value="Install"],input[value="Reinstall"]').first().click()]).catch(async error=>{
    if(!installer.isClosed())console.error('Installer controls',await installer.locator('input,button').evaluateAll(nodes=>nodes.map(node=>({type:node.type,value:node.value,text:node.textContent,disabled:node.disabled}))));
    throw error;
  });
  }
  const gameRequests=[];
  await context.route('https://play.multidonate.ru/**',async route=>{
    const url=new URL(route.request().url());gameRequests.push({path:url.pathname,method:route.request().method()});
    if(url.pathname.endsWith('/api/me'))return route.fulfill({json:{ok:true,hero:{login:'my_priest',role:'priest',sk:{c:'priest'},money:42},ql:{on:false},chat:[{text:'PRIVATE_CHAT'}]}});
    if(url.pathname.endsWith('/api/auction'))return route.fulfill({json:{ok:true,lots:[],items:{},vals:{},hist:[],cfg:{}}});
    if(url.pathname.endsWith('/api/live'))return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'});
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'; style-src \'self\' \'unsafe-inline\'; object-src \'none\'"></head><body>Mock game</body></html>'});
  });
  const game=await context.newPage();game.on('pageerror',error=>errors.push(error.message));
  game.on('console',message=>{if(message.type()==='error'&&message.text().includes('Zakviel'))errors.push(message.text());});
  await game.goto('https://play.multidonate.ru/c/test/');
  const host=game.locator('#zma-auction-host');await host.waitFor({state:'attached'});
  const hud=game.getByRole('complementary',{name:'HUD Zakviel Market'});
  await hud.getByRole('button',{name:'Развернуть HUD',exact:true}).waitFor();
  assert.equal(await host.count(),1);assert.equal(await host.locator('.launcher').count(),0);
  assert.equal(await hud.locator('.hud-body').isVisible(),false);
  assert(!requests.some(request=>request.path.startsWith('/api/hud')));
  await hud.getByRole('button',{name:'Настройки расширения',exact:true}).click();
  const settings=game.getByRole('dialog',{name:'Настройки Zakviel Market',exact:true});
  await settings.getByRole('button',{name:'Включить сбор',exact:true}).waitFor();
  if(await settings.getByRole('button',{name:'Выйти',exact:true}).isVisible()){
    await settings.getByRole('button',{name:'Выйти',exact:true}).click();
    await settings.getByRole('button',{name:'Войти',exact:true}).waitFor();
  }
  await settings.getByLabel('Логин или почта').fill('tm-smoke');await settings.getByLabel('Пароль',{exact:true}).fill('fixture-password');
  await settings.getByRole('button',{name:'Войти',exact:true}).click();await settings.getByText('Аккаунт: tm-smoke',{exact:true}).waitFor();
  assert.equal(await settings.getByLabel('Пароль',{exact:true}).inputValue(),'');
  await settings.getByLabel('Период отправки').selectOption('immediate');
  await settings.getByRole('button',{name:'Включить сбор',exact:true}).click();await settings.getByRole('button',{name:'Выключить сбор',exact:true}).waitFor();
  await settings.getByRole('button',{name:'Закрыть',exact:true}).click();
  await game.evaluate(()=>fetch('/c/test/api/me'));
  await game.waitForTimeout(1500);
  assert(imported.some(event=>event.path==='/api/me'));assert(!JSON.stringify(imported).includes('PRIVATE_CHAT'));
  assert(!requests.some(request=>request.path.startsWith('/api/hud')));
  fs.mkdirSync(path.join(root,'.data'),{recursive:true});
  await game.screenshot({path:path.join(root,'.data/hud-collapsed.png')});
  await hud.getByRole('button',{name:'Развернуть HUD',exact:true}).click();
  await hud.getByRole('heading',{name:'Инвентарь',exact:true}).waitFor();
  for(const text of ['Билд и заточка','Избранные игроки','Помощник жреца','REMOVED_FAVORITE','REMOVED_BUILD','REMOVED_PLAN','REMOVED_PRIEST'])assert(!((await hud.innerText()).includes(text)));
  await game.screenshot({path:path.join(root,'.data/hud-expanded.png')});
  await hud.getByRole('button',{name:'Аукцион',exact:true}).click();
  await game.getByRole('heading',{name:'Аукцион',exact:true}).waitFor();
  await game.getByRole('button',{name:'Zakviel Market',exact:true}).click();
  await game.getByLabel('Канал аукциона',{exact:true}).getByRole('option',{name:'test',exact:true}).waitFor({state:'attached'});
  await game.getByRole('button',{name:'Игроки и друзья',exact:true}).click();await game.getByRole('heading',{name:'Игроки и друзья',exact:true}).waitFor();
  const players=game.getByRole('dialog',{name:'Zakviel Market · Игроки',exact:true});
  assert(!/избран/i.test(await players.innerText()));
  assert.equal(await game.getByRole('button',{name:'Жрец',exact:true}).count(),0);
  await game.getByRole('button',{name:'Закрыть · Esc',exact:true}).click();
  await hud.getByRole('button',{name:'Игроки',exact:true}).click();await game.getByRole('heading',{name:'Игроки и друзья',exact:true}).waitFor();
  await game.getByRole('button',{name:'Закрыть · Esc',exact:true}).click();
  assert.equal(gameRequests.filter(request=>request.path.endsWith('/api/live')).length,0);
  await game.evaluate(async()=>{const stream=new EventSource('/c/test/api/live');stream.addEventListener('q',()=>{});stream.addEventListener('dm',()=>{});stream.addEventListener('fr',()=>{});window.__fixtureStream=stream;});
  await game.evaluate(()=>{
    window.__fixtureStream.dispatchEvent(new MessageEvent('q',{data:JSON.stringify({on:true,party:'in',b:{low:[['ally','Ally',.1]]}})}));
    window.__fixtureStream.dispatchEvent(new MessageEvent('dm',{data:'{"m":{"text":"PRIVATE_DM"}}'}));
    window.__fixtureStream.dispatchEvent(new MessageEvent('fr',{data:'{"login":"PRIVATE_FRIEND"}'}));window.__fixtureStream.close();
  });
  await game.waitForTimeout(800);
  assert(!JSON.stringify(imported).includes('PRIVATE_DM'));assert(!JSON.stringify(imported).includes('PRIVATE_FRIEND'));
  assert(!imported.some(event=>event.response?.b?.low));assert(!requests.some(request=>request.path.startsWith('/api/priest/')));
  assert.equal(await game.evaluate(()=>!!window.__zmaPriest||!!window.__zmaAuctionApp||!!window.authToken),false);
  await hud.getByRole('button',{name:'Свернуть HUD',exact:true}).click();
  const summaryCount=requests.filter(request=>request.path.startsWith('/api/hud')).length;
  await game.waitForTimeout(700);assert.equal(requests.filter(request=>request.path.startsWith('/api/hud')).length,summaryCount);
  await game.setViewportSize({width:390,height:844});
  assert(await hud.evaluate(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=390;}));
  await hud.getByRole('button',{name:'Настройки расширения',exact:true}).click();
  assert(await settings.evaluate(node=>node.getBoundingClientRect().width<=390));
  await game.screenshot({path:path.join(root,'.data/hud-settings-mobile.png')});
  await settings.getByRole('button',{name:'Выключить сбор',exact:true}).click();await settings.getByRole('button',{name:'Включить сбор',exact:true}).waitFor();
  await game.waitForTimeout(700);const before=imported.length;await game.evaluate(()=>fetch('/c/test/api/me'));await game.waitForTimeout(700);assert.equal(imported.length,before);
  await settings.getByRole('button',{name:'Закрыть',exact:true}).click();
  // Save an expanded preference, then verify a fresh page still starts collapsed.
  await hud.getByRole('button',{name:'Развернуть HUD',exact:true}).click();await game.waitForTimeout(500);
  await game.reload();await hud.getByRole('button',{name:'Развернуть HUD',exact:true}).waitFor();
  assert.equal(await hud.locator('.hud-body').isVisible(),false);assert.equal(await host.locator('.launcher').count(),0);
  await hud.getByRole('button',{name:'Настройки расширения',exact:true}).click();
  await settings.getByRole('button',{name:'Включить сбор',exact:true}).waitFor();await settings.getByText('Аккаунт: tm-smoke',{exact:true}).waitFor();
  await settings.getByRole('button',{name:'Выйти',exact:true}).click();await settings.getByRole('button',{name:'Войти',exact:true}).waitFor();
  assert(gameRequests.filter(request=>request.path.endsWith('/api/live')).length<=1);assert(!gameRequests.some(request=>request.method!=='GET'));assert.deepEqual(errors,[]);
  console.log(JSON.stringify({browserVersion:context.browser()?.version(),realTampermonkey:!managerFixture,gmFixture:managerFixture,strictCsp:true,singleCollapsedHud:true,noLaunchers:true,hudNavigation:true,removedModulesAbsent:true,collapsedSummaryPaused:true,login:true,gmTransport:!managerFixture,import:true,auction:true,players:true,privateEventsExcluded:true,mobile:true,disable:true,reloadCollapsed:true,noGameActions:true,errors},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await context?.close();await new Promise(resolve=>server?server.close(resolve):resolve());});
