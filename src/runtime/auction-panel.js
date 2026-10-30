(() => {
  if (globalThis.__zmaAuctionPanel) return;
  globalThis.__zmaAuctionPanel = true;
  const channel = /^\/c\/([^/]+)/.exec(location.pathname)?.[1];
  if (!channel || window.top !== window) return;
  let host, shadow, launcher, dialog, app, status, refreshButton, title, activeView = 'auction', loading = false, refreshing = false, controller = null;
  const send = message => chrome.runtime.sendMessage(message);
  const viewLabel = view => view === 'players' ? 'Игроки' : view === 'priest' ? 'Жрец' : 'Аукцион';
  const button = (label, action) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.addEventListener('click', action); return node; };

  function install() {
    if (host?.isConnected) return;
    host = document.createElement('div'); host.id = 'zma-auction-host';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial;color-scheme:dark;font:14px system-ui,sans-serif}*{box-sizing:border-box}button{font:600 13px system-ui,sans-serif;cursor:pointer;border:1px solid #658b91;border-radius:9px;padding:9px 13px;background:#19313e;color:#dcfff2}button:focus-visible{outline:3px solid #b7f7d9;outline-offset:3px}button:disabled{opacity:.5;cursor:wait}.launcher{position:fixed;bottom:20px;right:20px;z-index:2147483646;box-shadow:0 4px 22px #0008;background:#173b35;border-color:#8be6c0}dialog{position:fixed;inset:0;width:min(1440px,96vw);height:92dvh;max-height:96dvh;max-width:96vw;margin:auto;padding:0;border:1px solid #658b91;border-radius:14px;background:#0d1726;color:#edf6ff;overflow:hidden}dialog::backdrop{background:#020a13bb}dialog[open]{display:flex;flex-direction:column}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;background:#192c3d;border-bottom:1px solid #425b70}.toolbar b{margin-right:auto;font:700 16px system-ui,sans-serif}.status{margin:0;padding:8px 16px;color:#b8ccdf;font:12px/1.5 system-ui,sans-serif}.status:empty{display:none}.app{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain} @media(max-width:600px){.launcher{bottom:12px;right:12px}dialog{width:98vw;max-width:98vw;height:96dvh}.toolbar{padding:10px}.toolbar b{flex-basis:100%}}';
    launcher = button('✦ Аукцион', () => void open()); launcher.className = 'launcher'; launcher.setAttribute('aria-label', 'Открыть аукцион Zakviel Market');
    dialog = document.createElement('dialog'); dialog.setAttribute('aria-label', 'Аукцион Zakviel Market');
    const toolbar = document.createElement('div'); toolbar.className = 'toolbar';
    title = document.createElement('b'); title.textContent = 'Zakviel Market';
    const auctionView = button('Аукцион', () => void open('auction'));
    const playersView = button('Игроки и друзья', () => void open('players'));
    refreshButton = button('Обновить из игры', () => void refresh());
    const close = button('Закрыть · Esc', () => dialog.close());
    toolbar.append(title, auctionView, playersView, button('Жрец',()=>void open('priest')), refreshButton, close);
    status = document.createElement('p'); status.className = 'status'; status.setAttribute('role', 'status');
    app = document.createElement('div'); app.className = 'app';
    const playersLauncher = button('♟ Игроки', () => void open('players')); playersLauncher.className = 'launcher'; playersLauncher.style.bottom = '66px'; playersLauncher.setAttribute('aria-label','Открыть игроков Zakviel Market');
    const priestLauncher=button('✚ Жрец',()=>void open('priest'));priestLauncher.className='launcher';priestLauncher.style.bottom='158px';priestLauncher.setAttribute('aria-label','Открыть помощника жреца');
    dialog.append(toolbar, status, app); shadow.append(style, launcher, playersLauncher, priestLauncher, dialog); document.documentElement.append(host);
    dialog.addEventListener('close', () => { controller?.abort(); globalThis.__zmaAuctionApp?.unmount(); app.replaceChildren(); launcher.focus(); });
    // Game keyboard shortcuts must not fire while typing inside the modal.
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('keyup', event => event.stopPropagation());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  }

  async function refresh() {
    if (refreshing || !dialog?.open) return;
    refreshing = true; refreshButton.disabled = true; controller = new AbortController();
    const timer = setTimeout(() => controller?.abort(), 15000);
    try {
      const [state, auth] = await Promise.all([send({ type: 'get-collector-state' }), send({ type: 'get-auth' })]);
      if (!state?.enabled) throw Error('Для свежего снимка включите сбор в popup расширения. Доступные серверные снимки показаны ниже.');
      if (!auth?.signedIn) throw Error('Для свежего снимка войдите в аккаунт через popup расширения.');
      controller.signal.throwIfAborted(); status.textContent = 'Получаем аукцион из игры…';
      // One explicit read, using the current game session. No purchase or navigation.
      const response = await fetch(`/c/${channel}/api/auction`, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw Error(`Игра вернула ошибку ${response.status}`);
      const snapshot = await response.json();
      controller.signal.throwIfAborted();
      const result = await send({ type: 'auction-import', response: snapshot });
      controller.signal.throwIfAborted();
      if (!result?.ok) throw Error(result?.error || 'Не удалось отправить снимок');
      status.textContent = 'Свежий снимок получен. Покупка доступна в обычном аукционе игры.';
      globalThis.__zmaAuctionApp?.refresh();
    } catch (error) {
      if (dialog.open && error.name !== 'AbortError') status.textContent = error.message || 'Не удалось обновить аукцион';
    } finally { clearTimeout(timer); refreshing = false; refreshButton.disabled = false; }
  }

  async function open(view = 'auction') {
    install();
    if (loading) return;
    activeView = ['players','priest'].includes(view) ? view : 'auction';
    title.textContent = 'Zakviel Market · '+viewLabel(activeView);
    dialog.setAttribute('aria-label', title.textContent);
    refreshButton.hidden = activeView !== 'auction'; status.textContent = '';
    if (dialog.open) { app.scrollTop = 0; globalThis.__zmaAuctionApp?.setView(activeView); return; }
    dialog.showModal(); loading = true; app.textContent = 'Загружаем интерфейс аукциона…'; status.textContent = '';
    try {
      if (!globalThis.__zmaAuctionApp) { const result = await send({ type: 'auction-load-ui' }); if (!result?.ok) throw Error(result?.error || 'Не удалось загрузить окно'); }
      if (!dialog.open) return;
      globalThis.__zmaAuctionApp.onViewChange = view => { activeView = view; app.scrollTop = 0; title.textContent = 'Zakviel Market · '+viewLabel(view); dialog.setAttribute('aria-label',title.textContent); refreshButton.hidden = view !== 'auction'; status.textContent = ''; };
      globalThis.__zmaAuctionApp.mount(app, channel, activeView);
      if (activeView === 'auction') void refresh();
    } catch (error) { if (dialog.open) app.textContent = `Ошибка: ${error.message}. Перезагрузите расширение и страницу игры.`; }
    finally { loading = false; }
  }
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'show-auction') void open(message.view); });
  globalThis.__zmaMarketShell = {getRoot:()=>{install();return shadow},open};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
