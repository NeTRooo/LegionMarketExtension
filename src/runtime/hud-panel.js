(() => {
  if(globalThis.__zmaHudController||window.top!==window)return;
  let prefs={enabled:false,collapsed:false,width:330,height:520,x:null,y:80,buildToken:'',planId:''},userId='guest',state=null,summary=null;
  let root,panel,body,header,connection,queue,sync,content,noticesBox,launcher,collapse,resizeHandle;
  let timer=null,inFlight=null,epoch=0,stateTimer=null,drag=null,connected=false,checkedAt=null,initialized=false,previousFavorites=new Set(),notices=[];
  let renderFingerprint='',prefsChain=Promise.resolve();
  const blocks=new Map();let renderMode='';
  let connectionError='';
  let priestUnsubscribe=null;
  function bindPriest(){if(active()&&summary?.enabled&&!priestUnsubscribe&&globalThis.__zmaPriest)priestUnsubscribe=globalThis.__zmaPriest.subscribe(()=>renderSummary(),'hud')}
  const send=message=>chrome.runtime.sendMessage(message);
  const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element};
  const button=(text,action,label)=>{const element=node('button',text);element.type='button';if(label)element.setAttribute('aria-label',label);element.addEventListener('click',action);return element};
  const setText=(element,text)=>{if(element.textContent!==text)element.textContent=text};
  const date=value=>value?new Date(value).toLocaleString('ru-RU'):'Ещё не было';
  const money=value=>value==null?'Нет данных':`${value.toLocaleString('ru-RU',{maximumFractionDigits:1})} мед.`;
  const active=()=>prefs.enabled&&!prefs.collapsed&&!document.hidden;

  function bounds(){const width=Math.min(prefs.width,Math.max(180,innerWidth-16)),height=prefs.collapsed?74:Math.min(prefs.height,Math.max(120,innerHeight-16));return {width,height,x:Math.max(8,Math.min(prefs.x??innerWidth-width-16,Math.max(8,innerWidth-width-8))),y:Math.max(8,Math.min(prefs.y,Math.max(8,innerHeight-height-8)))}}
  function geometry(){if(!panel)return;const b=bounds();Object.assign(panel.style,{left:`${b.x}px`,top:`${b.y}px`,width:`${b.width}px`,height:prefs.collapsed?'74px':`${b.height}px`});body.hidden=prefs.collapsed;resizeHandle.hidden=prefs.collapsed;collapse.textContent=prefs.collapsed?'Развернуть':'Свернуть';collapse.setAttribute('aria-expanded',String(!prefs.collapsed))}
  function persist(changes){prefs={...prefs,...changes};geometry();const current=userId,value={...prefs};prefsChain=prefsChain.catch(()=>{}).then(()=>send({type:'hud-preferences',userId:current,preferences:value})).then(result=>{if(!result.ok&&current===userId)notify(result.error,true,'system')});return prefsChain}
  function stop(){if(timer)clearInterval(timer);timer=null;epoch++;inFlight=null;priestUnsubscribe?.();priestUnsubscribe=null}
  function schedule(){if(!active()||!state?.signedIn){stop();return}bindPriest();if(timer)return;void load();timer=setInterval(()=>void load(),30000)}
  function notify(text,error=false,module='system'){
    if(!prefs.enabled||document.hidden)return;
    notices=[{text:String(text).slice(0,400),error,module,at:new Date().toISOString()},...notices].slice(0,4);
    if(!prefs.collapsed)renderNotices();
    else setText(connection,`HUD свёрнут · уведомлений: ${notices.length}`);
  }
  function renderNotices(){noticesBox.replaceChildren(...notices.map(notice=>node('p',`${date(notice.at)} · ${notice.text}`,notice.error?'hud-error':'hud-notice')))}
  function renderStatus(){
    if(!panel||!state)return;
    const label=prefs.collapsed?'HUD свёрнут · сводка приостановлена':connectionError||(!state.signedIn?'Войдите для проверки связи':connected?`Сервер подключён · ${date(checkedAt)}`:'Подключение не подтверждено');
    setText(connection,label);setText(queue,`Очередь: ${state.queue} · сбор ${state.collector?'включён':'выключен'}`);
    setText(sync,`Последняя отправка: ${date(state.sync.lastSyncAt)}${state.sync.error?' · '+state.sync.error:''}`);
  }
  function renderSummary(){
    if(!active()||!content)return;
    const mode=!state?.signedIn?'guest':!summary?'empty':!summary.enabled?'disabled':'summary';
    const liveSignals=(summary?.signals||[]).filter(signal=>!signal.expiresAt||signal.expiresAt>Date.now());
    const liveFavorites=(summary?.favorites||[]).filter(person=>Date.parse(person.onlineUntil)>Date.now());
    const stable=summary?{...summary,serverTime:undefined,signals:liveSignals,favorites:liveFavorites}:null;
    const priest=globalThis.__zmaPriest?.getSnapshot(),priestPreview=priest?{reason:!priest.preferences.enabled?'Включите помощника в окне «Жрец»':!priest.collector?'Включите сбор в расширении':!priest.moduleEnabled?'Модуль жреца выключен':priest.view.reason||(priest.view.canAct?'Можно выбрать лечащий ход в игре':'Ожидание фазы'),urgent:priest.view.urgent.slice(0,3).map(ally=>`${ally.name} ${Math.round(ally.hp)}%`),at:priest.view.battle?.at}:null;
    const fingerprint=JSON.stringify([mode,stable,prefs.buildToken,prefs.planId,priestPreview]);
    if(fingerprint===renderFingerprint)return;renderFingerprint=fingerprint;
    if(mode!==renderMode||!content.hasChildNodes()){content.replaceChildren();blocks.clear();renderMode=mode}
    if(mode!=='summary'){
      content.replaceChildren(node('p',mode==='guest'?'Войдите через popup расширения для личной сводки.':mode==='empty'?'Сводка ещё не получена.':'Данные HUD отключены в настройках аккаунта.'));
      if(mode==='disabled')content.append(button('Включить данные HUD',async()=>{try{const result=await send({type:'hud-module',enabled:true});if(!result.ok)throw Error(result.error);await load()}catch(e){notify(e.message,true)}}));
      return;
    }
    function block(title,value,render){
      let area=blocks.get(title);if(!area){area=node('section');blocks.set(title,area);content.append(area)}
      const key=JSON.stringify(value);if(area.dataset.value===key)return;
      area.dataset.value=key;area.replaceChildren(node('h3',title));render(area);
    }
    block('Инвентарь',summary.inventory,area=>area.append(node('b',money(summary.inventory.value)),node('p',`Предметов: ${summary.inventory.quantity}; без оценки: ${summary.inventory.unknownQuantity}`),node('small',`${summary.inventory.note} Снимок: ${date(summary.inventory.updatedAt)}`)));
    block('Рыночные сигналы',[liveSignals,summary.marketUpdatedAt],area=>{
      if(!liveSignals.length)area.append(node('p','Нет подтверждённых сигналов.'));
      for(const signal of liveSignals)area.append(button(`${signal.name} +${signal.enchant} · ${money(signal.unitPrice)} · скидка ${signal.discount.toFixed(1)}%`,()=>void globalThis.__zmaMarketShell.open('auction')));
      area.append(node('small',`Снимок рынка: ${date(summary.marketUpdatedAt)}`));
    });
    block('Билд и заточка',[summary.builds,summary.plans,prefs.buildToken,prefs.planId],area=>{
      function select(label,options,value,key){
        const wrapper=node('label',label),select=node('select');select.setAttribute('aria-label',label);
        const empty=node('option','Не выбрано');empty.value='';select.append(empty);
        for(const option of options){const item=node('option',option.name);item.value=option.id;select.append(item)}
        select.value=options.some(option=>option.id===value)?value:'';
        select.addEventListener('change',()=>{void persist({[key]:select.value});renderSummary()});wrapper.append(select);area.append(wrapper);
      }
      select('Выбранный билд',summary.builds.map(build=>({id:build.token,name:build.name})),prefs.buildToken,'buildToken');
      select('Цель заточки',summary.plans.map(plan=>({id:plan.id,name:plan.name})),prefs.planId,'planId');
      const plan=summary.plans.find(plan=>plan.id===prefs.planId);if(plan){const modes={ideal:'Идеальные попытки',expected:'Ожидаемые расходы',budget:'По бюджету',target:'Целевой шанс'};area.append(node('p',`${plan.itemName}: +${plan.current??'?'} → +${plan.target??'?'} · ${modes[plan.mode]||'Режим не указан'}`))}
    });
    block('Избранные игроки',liveFavorites,area=>{area.append(node('p',liveFavorites.length?liveFavorites.map(person=>person.name).join(', '):'Нет свежих наблюдений избранных.'))});
    block('Помощник жреца',priestPreview,area=>{area.append(node('p',priestPreview?.reason||'Перезагрузите расширение для локальных данных боя'));if(priestPreview?.urgent.length)area.append(node('p',priestPreview.urgent.join(', '),'hud-notice'));area.append(button('Открыть жреца',()=>void globalThis.__zmaMarketShell.open('priest')))});
    block('Сайт',true,area=>{for(const [tab,label] of [['market','Аукцион'],['players','Игроки'],['build','Билды'],['enchant','Заточка'],['settings','Настройки']])area.append(button(label,()=>void send({type:'hud-link',tab}).then(result=>{if(!result.ok)notify(result.error,true)})))});
  }
  async function load(){
    if(!active()||inFlight)return;const request={epoch};inFlight=request;
    try{
      const result=await send({type:'hud-data'});
      if(request.epoch!==epoch||!active())return;
      if(!result.ok)throw Error(result.error);
      if(result.userId!==userId)return;
      connected=true;connectionError='';checkedAt=new Date().toISOString();summary=result.data;
      if(summary.enabled&&summary.priest){globalThis.__zmaPriest?.acceptContext(summary.priest,userId);bindPriest()}else{priestUnsubscribe?.();priestUnsubscribe=null}
      const favorites=new Set((summary.favorites||[]).filter(person=>Date.parse(person.onlineUntil)>Date.now()).map(person=>person.id));
      if(summary.enabled){if(initialized){const appeared=(summary.favorites||[]).filter(person=>favorites.has(person.id)&&!previousFavorites.has(person.id));if(appeared.length)notify(`Избранные появились: ${appeared.map(person=>person.name).join(', ')}`,false,'players')}initialized=true;previousFavorites=favorites}
      else{initialized=false;previousFavorites.clear()}
      renderSummary();renderStatus();
    }catch(error){if(request.epoch===epoch&&active()){connected=false;summary=null;connectionError=error.message||'Сервер недоступен';renderFingerprint='';renderSummary();renderStatus()}}
    finally{if(inFlight===request)inFlight=null}
  }
  async function updateState(){
    try{
      const next=await send({type:'hud-state'});if(!next.ok)return;
      if(next.userId!==userId){stop();summary=null;connected=false;connectionError='';checkedAt=null;initialized=false;previousFavorites.clear();notices=[];renderFingerprint='';blocks.clear();content?.replaceChildren();noticesBox?.replaceChildren()}
      userId=next.userId;state=next;
      if(!drag)prefs=next.preferences;
      if(!prefs.enabled){stop();drag=null;panel?.replaceChildren();panel?.remove();panel=null;summary=null;blocks.clear();notices=[];initialized=false;previousFavorites.clear();renderFingerprint='';return}
      if(!panel)createPanel();geometry();renderStatus();if(!prefs.collapsed)renderNotices();renderSummary();schedule();
    }catch{if(connection)setText(connection,'Расширение перезагружено. Обновите страницу игры.')}
  }
  function scheduleState(){if(stateTimer)return;stateTimer=setTimeout(()=>{stateTimer=null;void updateState()},200)}
  function startDrag(event,mode){
    if(event.button!==0||event.target.closest('button')&&mode==='move')return;
    const b=bounds();drag={mode,x:event.clientX,y:event.clientY,b};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
  }
  function move(event){if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(drag.mode==='move'){prefs.x=drag.b.x+dx;prefs.y=drag.b.y+dy}else{prefs.width=Math.max(240,drag.b.width+dx);prefs.height=Math.max(180,drag.b.height+dy)}geometry()}
  function end(){if(!drag)return;drag=null;const b=bounds();void persist({x:b.x,y:b.y,width:b.width,...(!prefs.collapsed?{height:b.height}:{})})}
  function createPanel(){
    renderFingerprint='';
    panel=node('aside',undefined,'zma-hud');panel.setAttribute('aria-label','HUD Zakviel Market');
    header=node('div',undefined,'hud-header');header.tabIndex=0;header.setAttribute('aria-label','Переместить HUD стрелками');header.append(node('b','✦ Market HUD'));
    collapse=button(prefs.collapsed?'Развернуть':'Свернуть',()=>{void persist({collapsed:!prefs.collapsed});if(prefs.collapsed)stop();else{renderFingerprint='';renderSummary();schedule()}renderStatus()});
    header.append(collapse,button('×',()=>void persist({enabled:false}).then(()=>updateState()),'Отключить HUD'));
    connection=node('div','Подключение…','hud-connection');connection.setAttribute('role','status');
    body=node('div',undefined,'hud-body');queue=node('p');sync=node('small');content=node('div');noticesBox=node('section',undefined,'hud-notices');noticesBox.setAttribute('aria-label','Уведомления HUD');
    const actions=node('div',undefined,'hud-actions');actions.append(button('Аукцион',()=>void globalThis.__zmaMarketShell.open('auction')),button('Игроки',()=>void globalThis.__zmaMarketShell.open('players')),button('Обновить HUD',()=>void load()));
    body.append(queue,sync,actions,content,noticesBox);
    resizeHandle=button('↘',()=>{},'Изменить размер HUD стрелками');resizeHandle.className='hud-resize';
    for(const [element,mode] of [[header,'move'],[resizeHandle,'resize']]){
      element.addEventListener('pointerdown',event=>startDrag(event,mode));element.addEventListener('pointermove',move);element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);
      element.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||event.target!==element)return;event.preventDefault();event.stopPropagation();const b=bounds(),dx=event.key==='ArrowLeft'?-10:event.key==='ArrowRight'?10:0,dy=event.key==='ArrowUp'?-10:event.key==='ArrowDown'?10:0;if(mode==='move')void persist({x:b.x+dx,y:b.y+dy});else void persist({width:Math.max(240,b.width+dx),height:Math.max(180,b.height+dy)})});
    }
    panel.addEventListener('keydown',event=>event.stopPropagation());panel.addEventListener('keyup',event=>event.stopPropagation());panel.append(header,connection,body,resizeHandle);root.append(panel);
  }
  function install(){
    root=globalThis.__zmaMarketShell?.getRoot();if(!root)return;
    const style=node('style');style.textContent='.zma-hud{position:fixed;z-index:2147483645;display:flex;flex-direction:column;background:#101e2eee;color:#e0f4f1;border:1px solid #668c91;border-radius:12px;box-shadow:0 8px 30px #0008;font:12px/1.5 system-ui,sans-serif;overflow:hidden}.zma-hud [hidden]{display:none!important}.hud-header{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#213c49;cursor:move;touch-action:none;flex-shrink:0}.hud-header b{margin-right:auto}.hud-header button{font-size:11px;padding:4px 6px}.hud-connection{padding:6px 10px;font-size:11px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hud-body{overflow:auto;padding:0 12px 15px;min-height:0;flex:1;overscroll-behavior:contain}.hud-body p{margin:8px 0}.hud-body small{display:block;color:#a8c1cf;font-size:10px}.hud-body section{border-top:1px solid #68808c55;margin-top:12px;padding-top:8px}.hud-body h3{margin:0 0 8px;font-size:12px;color:#9fdfc8}.hud-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}.hud-body button{padding:6px 8px;font-size:11px;max-width:100%;white-space:normal;text-align:left;margin:2px}.hud-body label{display:grid;gap:4px;margin:8px 0}.hud-body select{width:100%;min-width:0;color:#e4f7f3;background:#192d40;border:1px solid #63818c;border-radius:6px;padding:6px;font:inherit}.hud-resize{position:absolute;right:1px;bottom:1px;padding:0 5px!important;cursor:nwse-resize;touch-action:none}.hud-notice{color:#b1f2d4}.hud-error{color:#ffc0cb}';
    launcher=button('◉ HUD',async()=>{if(!state)await updateState();void persist({enabled:!prefs.enabled}).then(()=>updateState())},'Показать или скрыть HUD');launcher.className='launcher';launcher.style.bottom='112px';root.append(style,launcher);void updateState();
  }
  globalThis.__zmaHudController={notify};
  chrome.runtime.onMessage.addListener(message=>{if(message.type==='hud-state-changed'&&(prefs.enabled||message.configuration))scheduleState()});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else scheduleState()});
  addEventListener('resize',()=>{if(prefs.enabled){geometry();const b=bounds();void persist({x:b.x,y:b.y})}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
