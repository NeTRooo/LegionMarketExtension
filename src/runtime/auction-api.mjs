// Public read-only endpoints. Never proxy an arbitrary URL or a game action.
export function auctionRequestPath(value) {
  if (typeof value !== 'string' || value.length > 1500 || !value.startsWith('/api/auction/')) throw Error('Недопустимый запрос аукциона');
  const url = new URL(value, 'http://127.0.0.1:4173');
  const seller = url.pathname === '/api/auction/seller';
  if (url.origin !== 'http://127.0.0.1:4173' || !['/api/auction/analysis', '/api/auction/seller'].includes(url.pathname) || url.hash) throw Error('Недопустимый адрес аукциона');
  const allowed = new Set(['channel', 'city', 'days', ...(seller ? ['seller'] : [])]);
  for (const [key, entry] of url.searchParams) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1 || entry.length > 200 || /[\x00-\x1f]/.test(entry)) throw Error('Недопустимые параметры аукциона');
    if (key === 'days' && !['1', '7', '30'].includes(entry)) throw Error('Недопустимый период');
  }
  if (seller && !url.searchParams.get('seller')?.trim()) throw Error('Не указан продавец');
  return url.pathname + url.search;
}

export function publicAuctionPayload(raw) {
  if (!raw || raw.ok === false || !Array.isArray(raw.lots)) throw Error('Игра не вернула снимок аукциона');
  // Reject an oversized book instead of silently treating truncated lots as disappeared.
  if (raw.lots.length > 2000) throw Error('Снимок превышает лимит 2000 лотов');
  return Object.fromEntries(['lots', 'items', 'vals', 'hist', 'cfg', 'ench'].filter(key => raw[key] !== undefined).map(key => [key, raw[key]]));
}
