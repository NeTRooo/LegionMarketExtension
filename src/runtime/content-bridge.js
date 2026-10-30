(() => {
  if (globalThis.__zakvielMarketBridge) return;
  globalThis.__zakvielMarketBridge = true;
  const MESSAGE_SOURCE = 'zakviel-market-addon';
  let enabled = false;
  window.addEventListener('message', (event) => {
    if (!enabled || event.source !== window || !event.data || event.data.source !== MESSAGE_SOURCE) return;
    if (event.data.type === 'network-event') {
      globalThis.__zmaPriest?.ingest(event.data.event);
      chrome.runtime.sendMessage({ type: 'network-event', event: event.data.event });
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'collector-state') setEnabled(!!message.enabled);
  });
  let lastAssets = '';
  const publishAssets = () => {
    const urls = [...document.querySelectorAll('img[src], image[href], use[href]')].map((node) => node.getAttribute('src') || node.getAttribute('href')).filter((value) => typeof value === 'string').map((value) => new URL(value, location.href).href).filter((value) => value.startsWith('https://play.multidonate.ru/') && /\.(?:svg|png|webp|jpe?g)(?:$|[?#])/i.test(value)).slice(0, 500);
    const fingerprint = urls.join('|');
    if (urls.length && fingerprint !== lastAssets) { lastAssets = fingerprint; chrome.runtime.sendMessage({ type: 'asset-urls', assets: urls }); }
  };
  let lastArt = '';
  const publishArt = () => {
    const art = [...document.querySelectorAll('svg.art')].map((svg) => {
      const auctionRow = svg.closest('.au-row');
      const slot = svg.closest('.lgi-slot');
      const holder = svg.closest('[data-item-id],[data-item],[data-id],[data-ig],[data-k]');
      if (!auctionRow && !slot && !holder) return null;
      const data = holder ? Object.fromEntries(Object.entries(holder.dataset).filter(([key]) => /item|id/i.test(key))) : {};
      const itemKey = holder?.dataset.k?.split('|')[1];
      if (itemKey) data.itemId = itemKey;
      const name = auctionRow?.querySelector('.au-ri > b')?.textContent?.trim() || slot?.querySelector('.lgi-sn')?.textContent?.trim() || holder?.querySelector('b,strong,.ig-n,.cy-n')?.textContent?.trim() || holder?.getAttribute('aria-label') || '';
      return { svg: svg.outerHTML.slice(0, 50_000), classes: svg.getAttribute('class') || '', name: name.slice(0, 180), data, item: true };
    }).filter(x => x && (x.svg.includes('<path') || x.svg.includes('<g'))).slice(0, 250);
    const fingerprint = art.map(x => x.svg).join('|');
    if (art.length && fingerprint !== lastArt) { lastArt = fingerprint; chrome.runtime.sendMessage({ type: 'svg-art', art }); }
  };
  let lastDoll = '';
  const publishDoll = () => {
    const root = document.querySelector('.inv2-doll'); if (!root) return;
    const slots = [...root.querySelectorAll('.lgi-slot')].map((button) => {
      const bits = (button.dataset.k || '').split('|');
      return { slot: button.dataset.slot || '', empty: !!button.dataset.empty, itemId: bits[1] || '', rarity: button.dataset.r || bits[2] || '', enchant: Number(bits[3] || 0), name: button.querySelector('.lgi-sn')?.textContent?.trim() || button.getAttribute('aria-label') || 'пусто', svg: button.querySelector('svg.art')?.outerHTML?.slice(0, 50_000) || '' };
    });
    const doll = { slots, figure: root.querySelector('.lgi-ped svg')?.outerHTML?.slice(0, 50_000) || '' }, fingerprint = JSON.stringify(doll);
    if (fingerprint !== lastDoll) { lastDoll = fingerprint; chrome.runtime.sendMessage({ type: 'doll-snapshot', doll }); }
  };
  // The only browser state needed by the addon is the game's current town.
  // No cookies or unrelated local/session storage values leave the page.
  let lastCity = null;
  const publishCity = () => {
    let cityKey = null;
    try { const value = sessionStorage.getItem('lgCityTown'); if (value && /^[A-Za-z0-9_-]{1,80}$/.test(value)) cityKey = value; } catch { /* Storage may be disabled. */ }
    if (cityKey !== lastCity) { lastCity = cityKey; chrome.runtime.sendMessage({ type: 'city-context', cityKey }); }
  };
  let scanTimer = 0;
  const scheduleScan = () => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = 0; publishAssets(); publishArt(); publishDoll(); }, 1200);
  };
  let observer = null, cityTimer = null;
  function startObservation() {
    if (!enabled || !document.documentElement) return;
    observer?.disconnect();
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] });
    scheduleScan();
  }
  function setEnabled(value) {
    enabled = value;
    globalThis.__zmaPriest?.setCollector(enabled);
    window.postMessage({ source: MESSAGE_SOURCE, type: 'collector-state', enabled }, location.origin);
    observer?.disconnect();
    if (cityTimer) clearInterval(cityTimer);
    if (scanTimer) clearTimeout(scanTimer);
    cityTimer = null; scanTimer = 0;
    if (!enabled) return;
    lastAssets = ''; lastArt = ''; lastDoll = ''; lastCity = null;
    publishCity(); startObservation(); cityTimer = setInterval(publishCity, 2000);
  }
  addEventListener('storage', () => { if (enabled) publishCity(); });
  document.addEventListener('DOMContentLoaded', startObservation, { once: true });
  chrome.runtime.sendMessage({ type: 'get-collector-state' }).then(data => setEnabled(!!data?.enabled)).catch(() => {});
})();
