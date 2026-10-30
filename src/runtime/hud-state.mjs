const finite=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
export function hudPreferences(raw={}) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};
  return {enabled:true,collapsed:raw.collapsed!==false,
    x:finite(raw.x,null),y:finite(raw.y,null),width:Math.max(240,Math.min(900,finite(raw.width,330))),height:Math.max(180,Math.min(1000,finite(raw.height,520)))};
}
export function hudSummary(raw={}) {
  const inventory=raw.inventory||{};
  return {enabled:raw.enabled===true,serverTime:raw.serverTime,marketUpdatedAt:raw.marketUpdatedAt,
    inventory:{value:finite(inventory.value,null),quantity:finite(inventory.quantity,0),unknownQuantity:finite(inventory.unknownQuantity,0),note:typeof inventory.note==='string'?inventory.note:'',updatedAt:inventory.updatedAt||null},
    signals:Array.isArray(raw.signals)?raw.signals.slice(0,20):[]};
}
export function hudBounds(raw,width,height) {
  const prefs=hudPreferences(raw),w=Math.min(prefs.width,Math.max(180,width-16)),h=prefs.collapsed?74:Math.min(prefs.height,Math.max(120,height-16));
  return {x:Math.max(8,Math.min(prefs.x??width-w-16,Math.max(8,width-w-8))),y:Math.max(8,Math.min(prefs.y??height-h-16,Math.max(8,height-h-8))),width:w,height:h};
}
export function dashboardLink(tab) {
  if(!['market','players','settings'].includes(tab))throw Error('Недопустимый раздел');
  return `http://127.0.0.1:4173/?tab=${tab}`;
}
