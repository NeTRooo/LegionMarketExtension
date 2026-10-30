(() => {
  if(globalThis.__zmaHudController||window.top!==window)return;
  // The HUD is always available and starts collapsed on every page load.
  let prefs={enabled:true,collapsed:true,width:330,height:520,x:null,y:null},userId='guest',state=null,summary=null;
  let root,panel,body,header,connection,queue,sync,content,noticesBox,collapse,resizeHandle;
  let timer=null,inFlight=null,epoch=0,stateTimer=null,drag=null,connected=false,checkedAt=null,connectionError='';
  let renderFingerprint='',prefsChain=Promise.resolve(),notices=[];
  const blocks=new Map();let renderMode='';
  const send=message=>chrome.runtime.sendMessage(message);
  const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
  const button=(text,action,label)=>{const element=node('button',text);element.type='button';if(label)element.setAttribute('aria-label',label);element.addEventListener('click',action);return element;};
  const setText=(element,text)=>{if(element.textContent!==text)element.textContent=text;};
  const date=value=>value?new Date(value).toLocaleString('ru-RU'):'Ещё не было';
  const money=value=>value==null?'Нет данных':`${value.toLocaleString('ru-RU',{maximumFractionDigits:1})} мед.`;
  const active=()=>!prefs.collapsed&&!document.hidden;
  const settings=()=>globalThis.__zmaSettings?.open();
  function bounds(){const width=Math.min(prefs.width,Math.max(180,innerWidth-16)),height=prefs.collapsed?74:Math.min(prefs.height,Math.max(120,innerHeight-16));return {width,height,x:Math.max(8,Math.min(prefs.x??innerWidth-width-16,Math.max(8,innerWidth-width-8))),y:Math.max(8,Math.min(prefs.y??innerHeight-height-16,Math.max(8,innerHeight-height-8)))};}
  function geometry(){if(!panel)return;const b=bounds();Object.assign(panel.style,{left:`${b.x}px`,top:`${b.y}px`,width:`${b.width}px`,height:`${b.height}px`});body.hidden=prefs.collapsed;resizeHandle.hidden=prefs.collapsed;collapse.textContent=prefs.collapsed?'Развернуть':'Свернуть';collapse.setAttribute('aria-label',prefs.collapsed?'Развернуть HUD':'Свернуть HUD');collapse.setAttribute('aria-expanded',String(!prefs.collapsed));}
  function persist(changes){prefs={...prefs,...changes,enabled:true};geometry();const owner=userId,value={...prefs};prefsChain=prefsChain.catch(()=>{}).then(()=>send({type:'hud-preferences',userId:owner,preferences:value})).then(result=>{if(!result.ok&&owner===userId)notify(result.error,true);});return prefsChain;}
  function stop(){if(timer)clearInterval(timer);timer=null;epoch++;inFlight=null;}
  function schedule(){if(!active()||!state?.signedIn){stop();return;}if(timer)return;void load();timer=setInterval(()=>void load(),30000);}
  function toggle(){void persist({collapsed:!prefs.collapsed});if(prefs.collapsed)stop();else{renderFingerprint='';renderSummary();renderNotices();schedule();}renderStatus();}
  function notify(text,error=false,module='system'){
    if(document.hidden)return;
    notices=[{text:String(text).slice(0,400),error,module,at:new Date().toISOString()},...notices].slice(0,4);
    if(!prefs.collapsed)renderNotices();else renderStatus();
  }
  function renderNotices(){noticesBox?.replaceChildren(...notices.map(notice=>node('p',`${date(notice.at)} · ${notice.text}`,notice.error?'hud-error':'hud-notice')));}
  function renderStatus(){
    if(!panel)return;
    const label=prefs.collapsed?(state?`Сбор ${state.collector?'включён':'выключен'} · очередь ${state.queue}${notices.length?' · уведомлений '+notices.length:''}`:'Проверяем настройки…'):connectionError||(!state?.signedIn?'Войдите через настройки':connected?`Сервер подключён · ${date(checkedAt)}`:'Подключение не подтверждено');
    setText(connection,label);if(!state)return;
    setText(queue,`Очередь: ${state.queue} · сбор ${state.collector?'включён':'выключен'}`);
    setText(sync,`Последняя отправка: ${date(state.sync.lastSyncAt)}${state.sync.error?' · '+state.sync.error:''}`);
  }
  function renderSummary(){
    if(!active()||!content)return;
    const mode=!state?.signedIn?'guest':!summary?'empty':!summary.enabled?'disabled':'summary';
    const signals=(summary?.signals||[]).filter(signal=>!signal.expiresAt||signal.expiresAt>Date.now());
    const stable=summary?{...summary,serverTime:undefined,signals}:null;
    const fingerprint=JSON.stringify([mode,stable]);if(fingerprint===renderFingerprint)return;renderFingerprint=fingerprint;
    if(mode!==renderMode||!content.hasChildNodes()){content.replaceChildren();blocks.clear();renderMode=mode;}
    if(mode!=='summary'){
      content.replaceChildren(node('p',mode==='guest'?'Войдите через настройки для личной сводки. Аукцион доступен по сохранённым публичным снимкам.':mode==='empty'?'Сводка ещё не получена.':'Данные HUD отключены в настройках аккаунта.'));
      if(mode==='disabled')content.append(button('Включить данные HUD',async()=>{try{const result=await send({type:'hud-module',enabled:true});if(!result.ok)throw Error(result.error);await load();}catch(error){notify(error.message,true);}}));
      return;
    }
    function block(title,value,render){let area=blocks.get(title);if(!area){area=node('section');blocks.set(title,area);content.append(area);}const key=JSON.stringify(value);if(area.dataset.value===key)return;area.dataset.value=key;area.replaceChildren(node('h3',title));render(area);}
    block('Инвентарь',summary.inventory,area=>area.append(node('b',money(summary.inventory.value)),node('p',`Предметов: ${summary.inventory.quantity}; без оценки: ${summary.inventory.unknownQuantity}`),node('small',`${summary.inventory.note} Снимок: ${date(summary.inventory.updatedAt)}`)));
    block('Рыночные сигналы',[signals,summary.marketUpdatedAt],area=>{
      if(!signals.length)area.append(node('p','Нет подтверждённых сигналов.'));
      for(const signal of signals)area.append(button(`${signal.name} +${signal.enchant} · ${money(signal.unitPrice)} · скидка ${signal.discount.toFixed(1)}%`,()=>void globalThis.__zmaMarketShell.open('auction')));
      area.append(node('small',`Снимок рынка: ${date(summary.marketUpdatedAt)}`));
    });
  }
  async function load(){
    if(!active()||inFlight)return;const request={epoch};inFlight=request;
    try{
      const result=await send({type:'hud-data'});if(request.epoch!==epoch||!active())return;if(!result.ok)throw Error(result.error);if(result.userId!==userId)return;
      connected=true;connectionError='';checkedAt=new Date().toISOString();summary=result.data;renderSummary();renderStatus();
    }catch(error){if(request.epoch===epoch&&active()){connected=false;summary=null;connectionError=error.message||'Сервер недоступен';renderFingerprint='';renderSummary();renderStatus();}}
    finally{if(inFlight===request)inFlight=null;}
  }
  async function updateState(){
    try{
      const next=await send({type:'hud-state'});if(!next.ok)return;
      if(next.userId!==userId){stop();drag=null;summary=null;connected=false;connectionError='';checkedAt=null;notices=[];renderFingerprint='';blocks.clear();content?.replaceChildren();noticesBox?.replaceChildren();}
      userId=next.userId;state=next;
      if(!drag)prefs={...next.preferences,enabled:true,collapsed:prefs.collapsed};
      if(!panel)createPanel();geometry();renderStatus();if(!prefs.collapsed)renderNotices();renderSummary();schedule();
    }catch{if(connection)setText(connection,'Не удалось прочитать настройки. Обновите страницу игры.');}
  }
  function scheduleState(){if(stateTimer)return;stateTimer=setTimeout(()=>{stateTimer=null;void updateState();},200);}
  function startDrag(event,mode){if(event.button!==0||event.target.closest('button')&&mode==='move')return;drag={mode,x:event.clientX,y:event.clientY,b:bounds()};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();}
  function move(event){if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(drag.mode==='move'){prefs.x=drag.b.x+dx;prefs.y=drag.b.y+dy;}else{prefs.width=Math.max(240,drag.b.width+dx);prefs.height=Math.max(180,drag.b.height+dy);}geometry();}
  function end(){if(!drag)return;drag=null;const b=bounds();void persist({x:b.x,y:b.y,width:b.width,...(!prefs.collapsed?{height:b.height}:{})});}
  function createPanel(){
    panel=node('aside',undefined,'zma-hud');panel.setAttribute('aria-label','HUD Zakviel Market');
    header=node('div',undefined,'hud-header');header.tabIndex=0;header.setAttribute('aria-label','Переместить HUD стрелками');header.append(node('b','✦ Market'));
    collapse=button('Развернуть',toggle,'Развернуть HUD');header.append(collapse,button('⚙',settings,'Настройки расширения'));
    connection=node('div','Проверяем настройки…','hud-connection');connection.setAttribute('role','status');
    body=node('div',undefined,'hud-body');queue=node('p');sync=node('small');content=node('div');noticesBox=node('section',undefined,'hud-notices');noticesBox.setAttribute('aria-label','Уведомления HUD');
    const actions=node('div',undefined,'hud-actions');actions.append(button('Настройки',settings),button('Аукцион',()=>void globalThis.__zmaMarketShell.open('auction')),button('Игроки',()=>void globalThis.__zmaMarketShell.open('players')),button('Обновить HUD',()=>void load()),button('Открыть сайт',()=>void send({type:'hud-link',tab:'market'}).then(result=>{if(!result.ok)notify(result.error,true);})));body.append(queue,sync,actions,content,noticesBox);
    resizeHandle=button('↘',()=>{},'Изменить размер HUD стрелками');resizeHandle.className='hud-resize';
    for(const [element,mode] of [[header,'move'],[resizeHandle,'resize']]){
      element.addEventListener('pointerdown',event=>startDrag(event,mode));element.addEventListener('pointermove',move);element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);
      element.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||event.target!==element)return;event.preventDefault();event.stopPropagation();const b=bounds(),dx=event.key==='ArrowLeft'?-10:event.key==='ArrowRight'?10:0,dy=event.key==='ArrowUp'?-10:event.key==='ArrowDown'?10:0;if(mode==='move')void persist({x:b.x+dx,y:b.y+dy});else void persist({width:Math.max(240,b.width+dx),height:Math.max(180,b.height+dy)});});
    }
    panel.addEventListener('keydown',event=>event.stopPropagation());panel.addEventListener('keyup',event=>event.stopPropagation());panel.append(header,connection,body,resizeHandle);root.append(panel);geometry();
  }
  function install(){
    root=globalThis.__zmaMarketShell?.getRoot();if(!root)return;
    const style=node('style');style.textContent='.zma-hud{position:fixed;z-index:2147483645;display:flex;flex-direction:column;background:#101e2eee;color:#e0f4f1;border:1px solid #668c91;border-radius:12px;box-shadow:0 8px 30px #0008;font:12px/1.5 system-ui,sans-serif;overflow:hidden}.zma-hud [hidden]{display:none!important}.hud-header{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#213c49;cursor:move;touch-action:none;flex-shrink:0}.hud-header b{margin-right:auto;white-space:nowrap}.hud-header button{font-size:11px;padding:4px 6px;white-space:nowrap}.hud-connection{padding:6px 10px;font-size:11px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hud-body{overflow:auto;padding:0 12px 15px;min-height:0;flex:1;overscroll-behavior:contain}.hud-body p{margin:8px 0}.hud-body small{display:block;color:#a8c1cf;font-size:10px}.hud-body section{border-top:1px solid #68808c55;margin-top:12px;padding-top:8px}.hud-body h3{margin:0 0 8px;font-size:12px;color:#9fdfc8}.hud-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}.hud-body button{padding:6px 8px;font-size:11px;max-width:100%;white-space:normal;text-align:left;margin:2px}.hud-resize{position:absolute;right:1px;bottom:1px;padding:0 5px!important;cursor:nwse-resize;touch-action:none}.hud-notice{color:#b1f2d4}.hud-error{color:#ffc0cb}';
    root.append(style);createPanel();renderStatus();void updateState();
  }
  globalThis.__zmaHudController={notify,focus:()=>header?.focus()};
  chrome.runtime.onMessage.addListener(message=>{if(message.type==='hud-state-changed')scheduleState();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else scheduleState();});
  addEventListener('resize',()=>{geometry();const b=bounds();void persist({x:b.x,y:b.y});});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
