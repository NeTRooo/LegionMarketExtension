export function playersRequest(message) {
  const method = message.method || 'GET';
  if (typeof message.path !== 'string' || message.path.length > 1500 || !message.path.startsWith('/api/')) throw Error('Недопустимый запрос игроков');
  const url = new URL(message.path, 'http://127.0.0.1:4173');
  const routes = {'/api/players':['GET'], '/api/players/contacts':['PUT','DELETE'], '/api/players/observations':['DELETE'], '/api/settings':['GET','PUT']};
  if (url.origin !== 'http://127.0.0.1:4173' || url.hash || !routes[url.pathname]?.includes(method)) throw Error('Недопустимый маршрут игроков');
  const allowed = new Set(url.pathname === '/api/players' ? ['channel'] : method === 'DELETE' ? ['channel','login'] : []);
  for (const [key,value] of url.searchParams) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1 || value.length > 100 || /[\x00-\x1f]/.test(value)) throw Error('Недопустимый параметр игроков');
  if (method === 'PUT') {
    if (typeof message.body !== 'string' || message.body.length > 10000) throw Error('Недопустимые данные игроков');
    const value = JSON.parse(message.body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Недопустимые данные игроков');
  } else if (message.body !== undefined) throw Error('Тело запроса не допускается');
  return {path:url.pathname+url.search, method, ...(method==='PUT'?{body:message.body}:{})};
}
