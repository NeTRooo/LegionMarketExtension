const finite=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
export function hudPreferences(raw={}) {
  return {enabled:raw.enabled===true,collapsed:raw.collapsed===true,
    x:finite(raw.x,null),y:finite(raw.y,80),width:Math.max(240,Math.min(900,finite(raw.width,330))),height:Math.max(180,Math.min(1000,finite(raw.height,520))),
    buildToken:typeof raw.buildToken==='string'?raw.buildToken.slice(0,100):'',planId:typeof raw.planId==='string'?raw.planId.slice(0,100):''};
}
export function hudBounds(raw,width,height) {
  const prefs=hudPreferences(raw),w=Math.min(prefs.width,Math.max(180,width-16)),h=prefs.collapsed?74:Math.min(prefs.height,Math.max(120,height-16));
  return {x:Math.max(8,Math.min(prefs.x??width-w-16,Math.max(8,width-w-8))),y:Math.max(8,Math.min(prefs.y,Math.max(8,height-h-8))),width:w,height:h};
}
export function dashboardLink(tab) {
  if(!['data','market','players','build','enchant','settings'].includes(tab))throw Error('Недопустимый раздел');
  return `http://127.0.0.1:4173/?tab=${tab}`;
}
