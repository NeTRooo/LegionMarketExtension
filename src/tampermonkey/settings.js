function installSettings(platform) {
  const root=globalThis.__zmaMarketShell.getRoot();
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Настройки Zakviel Market');
  dialog.style.cssText='width:min(480px,94vw);height:auto;max-height:92dvh;overflow:auto;padding:20px';
  const form=document.createElement('form');form.method='dialog';
  const title=document.createElement('h2');title.textContent='Zakviel Market · Tampermonkey';
  const status=document.createElement('p');status.setAttribute('role','status');
  const account=document.createElement('p');
  const identity=document.createElement('input');identity.autocomplete='username';identity.placeholder='Логин или почта';identity.setAttribute('aria-label','Логин или почта');
  const password=document.createElement('input');password.type='password';password.autocomplete='current-password';password.placeholder='Пароль';password.setAttribute('aria-label','Пароль');
  const send=async message=>{const reply=await platform.settings(message);if(reply?.ok===false)throw Error(reply.error);return reply;};
  const run=action=>async()=>{try{status.textContent='';await action();await refresh();}catch(error){status.textContent=error.message;}};
  const button=(text,action)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.addEventListener('click',run(action));return node;};
  const login=button('Войти',async()=>{await send({type:'login',identity:identity.value,password:password.value});password.value='';});
  const logout=button('Выйти',()=>send({type:'logout'}));
  let enabled=false,userId='guest';
  const toggle=button('Включить сбор',()=>send({type:'set-enabled',enabled:!enabled}));
  const label=document.createElement('label'),hud=document.createElement('input');hud.type='checkbox';hud.style.width='auto';label.append(hud,document.createTextNode(' Показывать HUD'));hud.addEventListener('change',run(()=>send({type:'hud-preferences',userId,preferences:{enabled:hud.checked}})));
  const sync=document.createElement('select');sync.setAttribute('aria-label','Период отправки');
  for(const [value,text] of [['immediate','Сразу'],['15s','Через 15 секунд'],['30s','Через 30 секунд'],['1m','Через минуту'],['5m','Через 5 минут']]){const option=document.createElement('option');option.value=value;option.textContent=text;sync.append(option);}
  sync.addEventListener('change',run(()=>send({type:'set-sync-mode',mode:sync.value})));
  const queue=document.createElement('p');
  async function refresh(){
    const [auth,state,settings,journal,hudState]=await Promise.all(['get-auth','get-state','get-sync-settings','get-journal-count','hud-state'].map(type=>send({type})));
    enabled=!!state.enabled;userId=hudState.userId;hud.checked=!!hudState.preferences.enabled;
    account.textContent=auth.signedIn?`Аккаунт: ${auth.user.login}`:'Войдите в аккаунт локального сайта';
    identity.hidden=password.hidden=login.hidden=auth.signedIn;logout.hidden=!auth.signedIn;
    toggle.textContent=enabled?'Выключить сбор':'Включить сбор';sync.value=settings.mode;queue.textContent=`В очереди этой вкладки: ${journal.count}`;
  }
  const hint=document.createElement('p');hint.textContent='Сервер: http://127.0.0.1:4173. Отправка работает, пока открыта страница игры. Сбор выключен при каждой загрузке страницы.';
  form.append(title,account,identity,password,login,logout,toggle,label,sync,queue,button('Очистить очередь этой вкладки',()=>send({type:'clear-journal'})),hint,status,button('Закрыть',()=>{password.value='';dialog.close();}));
  form.addEventListener('submit',event=>{event.preventDefault();if(!login.hidden)login.click();});
  form.addEventListener('keydown',event=>event.stopPropagation());form.addEventListener('keyup',event=>event.stopPropagation());
  dialog.addEventListener('close',()=>{password.value='';});
  dialog.append(form);root.append(dialog);
  const open=()=>{if(!dialog.open)dialog.showModal();void run(async()=>{})();};
  const launcher=button('⚙ Market',open);launcher.className='launcher';launcher.style.bottom='204px';launcher.setAttribute('aria-label','Открыть настройки Zakviel Market');root.append(launcher);
  GM_registerMenuCommand('Zakviel Market — настройки',open);
}
