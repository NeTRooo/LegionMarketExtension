// Run with PLAYWRIGHT_MODULE and TAMPERMONKEY_EXTENSION pointing to local installs.
// Uses only synthetic game/API data. Port 4173 must be free.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const userScript=path.join(root,'dist/ZakvielMarket.user.js');
const user={id:'tm-smoke-user',login:'tm-smoke'};
const imported=[],requests=[],errors=[];let context,server;
const now=()=>new Date().toISOString();
const contextData=()=>({available:true,enabled:true,channel:'test',serverTime:now(),friends:['friend'],reason:''});
const analysis=()=>({channel:'test',updatedAt:now(),computedAt:now(),stale:false,periodDays:7,lots:[],groups:{},channels:[{id:'test',updatedAt:now()}],cities:[],historyNote:'Test fixture',historyTruncated:false,methodVersion:'fixture'});
(async()=>{
  server=http.createServer(async(req,res)=>{
    const buffers=[];for await(const buffer of req)buffers.push(buffer);
    const body=buffers.length?JSON.parse(Buffer.concat(buffers)):null;
    requests.push({path:req.url,method:req.method,authorization:req.headers.authorization});
    let data={};
    if(req.url==='/api/auth/login')data={token:'tm-fixture-token',user};
    else if(req.url==='/api/import'){imported.push(...body.events);data={ok:true};}
    else if(req.url.startsWith('/api/auction/analysis'))data=analysis();
    else if(req.url.startsWith('/api/priest/context'))data=contextData();
    else if(req.url.startsWith('/api/players'))data={enabled:true,people:[],channels:['test'],retentionHours:24,onlineSeconds:90,sources:{}};
    else if(req.url.startsWith('/api/hud'))data={enabled:true,serverTime:now(),inventory:{value:100,quantity:1,unknownQuantity:0,note:'fixture',updatedAt:now()},signals:[],favorites:[],builds:[],plans:[],priest:contextData()};
    else if(req.url==='/api/settings')data={modules:{priest:true,hud:true,players:true},privacy:{presenceRetentionHours:24}};
    else{res.writeHead(404);res.end('{}');return;}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));
  });
  await new Promise((resolve,reject)=>server.listen(4173,'127.0.0.1',resolve).once('error',reject));
  const extension=process.env.TAMPERMONKEY_EXTENSION;if(!extension)throw Error('Set TAMPERMONKEY_EXTENSION');
  context=await chromium.launchPersistentContext(process.env.TAMPERMONKEY_PROFILE||path.join(root,'.data/tampermonkey-smoke'),{
    executablePath:process.env.CHROMIUM_PATH||'/snap/bin/chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],
    args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
  });
  context.on('page',page=>page.on('dialog',dialog=>void dialog.accept()));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
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
  console.log('Userscript started in Tampermonkey');
  assert.equal(await host.count(),1);
  await game.getByRole('button',{name:'Открыть настройки Zakviel Market',exact:true}).click();
  const settings=game.getByRole('dialog',{name:'Настройки Zakviel Market',exact:true});
  await settings.getByText('Включить сбор',{exact:true}).waitFor();
  if(await settings.getByRole('button',{name:'Выйти',exact:true}).isVisible()){
    await settings.getByRole('button',{name:'Выйти',exact:true}).click();
    await settings.getByRole('button',{name:'Войти',exact:true}).waitFor();
  }
  await settings.getByLabel('Логин или почта').fill('tm-smoke');await settings.getByLabel('Пароль',{exact:true}).fill('fixture-password');
  await settings.getByRole('button',{name:'Войти',exact:true}).click();await settings.getByText('Аккаунт: tm-smoke',{exact:true}).waitFor();
  console.log('GM login passed');
  assert.equal(await settings.getByLabel('Пароль',{exact:true}).inputValue(),'');
  await settings.getByLabel('Период отправки').selectOption('immediate');
  await settings.getByRole('button',{name:'Включить сбор',exact:true}).click();await settings.getByRole('button',{name:'Выключить сбор',exact:true}).waitFor();
  await settings.getByRole('checkbox',{name:'Показывать HUD'}).check();
  await settings.getByRole('button',{name:'Закрыть',exact:true}).click();
  await game.evaluate(()=>fetch('/c/test/api/me'));
  await game.waitForTimeout(1800);
  assert(imported.some(event=>event.path==='/api/me'));
  assert(!JSON.stringify(imported).includes('PRIVATE_CHAT'));
  await game.getByRole('button',{name:'Открыть аукцион Zakviel Market',exact:true}).click();
  await game.getByRole('heading',{name:'Аукцион',exact:true}).waitFor();
  await game.getByRole('button',{name:'Zakviel Market',exact:true}).click();
  await game.getByLabel('Канал аукциона',{exact:true}).getByRole('option',{name:'test',exact:true}).waitFor({state:'attached'});
  assert(requests.some(request=>request.path.startsWith('/api/auction/analysis')));
  await game.getByRole('button',{name:'Игроки и друзья',exact:true}).click();await game.getByRole('heading',{name:'Игроки и друзья',exact:true}).waitFor();
  await game.getByRole('button',{name:'Жрец',exact:true}).click();await game.getByRole('heading',{name:'Помощник жреца',exact:true,level:1}).waitFor();
  await game.getByLabel('Включить помощника на этом канале').check();
  assert.equal(gameRequests.filter(request=>request.path.endsWith('/api/live')).length,0);
  await game.evaluate(async()=>{await fetch('/c/test/api/me');const stream=new EventSource('/c/test/api/live');stream.addEventListener('q',()=>{});stream.addEventListener('dm',()=>{});stream.addEventListener('fr',()=>{});window.__fixtureStream=stream;});
  await game.evaluate(()=>window.__fixtureStream.dispatchEvent(new MessageEvent('q',{data:JSON.stringify({on:true,party:'in',b:{id:'battle',round:1,st:'party',hp:1,me:0,form:[['my_priest','priest'],['friend','mage']],low:[['friend','Друг',.12]],sk:[['Лечение',0,'heal']],until:Date.now()+60000}})})));
  await game.getByText('Ранены: Друг 12%',{exact:true}).waitFor();
  await game.evaluate(()=>{window.__fixtureStream.dispatchEvent(new MessageEvent('dm',{data:'{"m":{"text":"PRIVATE_DM"}}'}));window.__fixtureStream.dispatchEvent(new MessageEvent('fr',{data:'{"login":"PRIVATE_FRIEND"}'}));window.__fixtureStream.close();});
  await game.waitForTimeout(1400);
  assert(!JSON.stringify(imported).includes('PRIVATE_DM'));assert(!JSON.stringify(imported).includes('PRIVATE_FRIEND'));
  assert(!imported.some(event=>event.response?.b?.low));
  assert.equal(await game.evaluate(()=>!!window.__zmaPriest||!!window.__zmaAuctionApp||!!window.authToken),false);
  await game.getByRole('button',{name:'Закрыть · Esc',exact:true}).click();
  await game.getByRole('complementary',{name:'HUD Zakviel Market'}).waitFor();
  await game.setViewportSize({width:390,height:844});await game.getByRole('button',{name:'Открыть настройки Zakviel Market',exact:true}).click();
  assert(await settings.evaluate(node=>node.getBoundingClientRect().width<=390));
  await settings.getByRole('button',{name:'Выключить сбор',exact:true}).click();await settings.getByRole('button',{name:'Включить сбор',exact:true}).waitFor();
  await game.waitForTimeout(700);const before=imported.length;await game.evaluate(()=>fetch('/c/test/api/me'));await game.waitForTimeout(700);assert.equal(imported.length,before);
  await game.reload();await game.getByRole('button',{name:'Открыть настройки Zakviel Market',exact:true}).click();
  await settings.getByRole('button',{name:'Включить сбор',exact:true}).waitFor();await settings.getByText('Аккаунт: tm-smoke',{exact:true}).waitFor();
  await settings.getByRole('button',{name:'Выйти',exact:true}).click();await settings.getByRole('button',{name:'Войти',exact:true}).waitFor();
  assert(gameRequests.filter(request=>request.path.endsWith('/api/live')).length<=1);
  assert(!gameRequests.some(request=>request.method!=='GET'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({realTampermonkey:true,strictCsp:true,login:true,gmTransport:true,import:true,auction:true,players:true,hud:true,priestHp:true,privateEventsExcluded:true,sandboxSecrets:true,mobile:true,disable:true,reload:true,noGameActions:true,errors},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await context?.close();await new Promise(resolve=>server?server.close(resolve):resolve());});
