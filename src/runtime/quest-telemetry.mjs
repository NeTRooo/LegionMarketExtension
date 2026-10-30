// Keep battle rosters and HP out of durable telemetry even without a battle UI.
export function isPublicTelemetry(event) {
  if(!event||typeof event.path!=='string')return false;
  const path=event.path.replace(/^\/c\/[^/]+/,'');
  return !/^\/api\/(?:chat(?:\/|$)|city\/(?:say|chat)(?:\/|$)|mine\/chat(?:\/|$)|dm(?:\/|$)|friends(?:\/|$))/.test(path)&&!['dm','fr','friends'].includes(event.eventType);
}
export function briefQuestTelemetry(event) {
  if(!isPublicTelemetry(event))return null;
  if(!event||typeof event.response!=='object'||event.response===null||Array.isArray(event.response))return event;
  const brief=q=>q&&typeof q==='object'?Object.fromEntries(Object.entries(q).filter(([key,value])=>key==='on'&&typeof value==='boolean'||['k','party'].includes(key)&&typeof value==='string'&&value.length<=40)):null;
  const path=event.path?.replace(/^\/c\/[^/]+/,'');
  if(path==='/api/live'&&event.eventType==='q')return {...event,response:brief(event.response)};
  if('ql'in event.response)return {...event,response:{...event.response,ql:brief(event.response.ql)}};
  return event;
}
export function scrubJournal(events) {return Array.isArray(events)?events.filter(isPublicTelemetry).map(briefQuestTelemetry):[];}
