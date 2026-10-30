export function priestPreferences(raw={}) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};
  const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(value);
  return {enabled:raw.enabled===true,sound:raw.sound===true,threshold:typeof raw.threshold==='number'&&Number.isFinite(raw.threshold)?Math.max(1,Math.min(99,raw.threshold)):25,
    watched:[...new Set((Array.isArray(raw.watched)?raw.watched:[]).filter(valid).map(value=>value.toLowerCase()))].slice(0,50)};
}
export function briefQuestTelemetry(event) {
  if(!event||typeof event.response!=='object'||event.response===null||Array.isArray(event.response))return event;
  const brief=q=>q&&typeof q==='object'?Object.fromEntries(Object.entries(q).filter(([key,value])=>key==='on'&&typeof value==='boolean'||['k','party'].includes(key)&&typeof value==='string'&&value.length<=40)):null;
  const path=event.path?.replace(/^\/c\/[^/]+/,'');
  if(path==='/api/live'&&event.eventType==='q')return {...event,response:brief(event.response)};
  if('ql'in event.response)return {...event,response:{...event.response,ql:brief(event.response.ql)}};
  return event;
}
