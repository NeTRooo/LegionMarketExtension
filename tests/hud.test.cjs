const test=require('node:test');
const assert=require('node:assert/strict');
test('HUD always remains reachable, defaults to collapsed and migrates old hidden/target preferences',async()=>{
 const {hudPreferences,hudBounds}=await import('../src/runtime/hud-state.mjs');
 assert.equal(hudPreferences().enabled,true);assert.equal(hudPreferences().collapsed,true);
 const prefs=hudPreferences({enabled:true,collapsed:'true',x:NaN,y:Infinity,width:10000,height:-1,buildToken:'x'.repeat(200),planId:42,token:'secret'});
 assert.equal(prefs.enabled,true);assert.equal(prefs.collapsed,true);assert.equal(prefs.x,null);assert.equal(prefs.y,null);assert.equal(prefs.width,900);assert.equal(prefs.height,180);assert(!('buildToken'in prefs));assert(!('planId'in prefs));assert(!('token'in prefs));assert.equal(hudPreferences({enabled:false}).enabled,true);
 const bounds=hudBounds({...prefs,x:9999,y:9999},390,844);assert(bounds.x+bounds.width<=390);assert(bounds.y+bounds.height<=844);
});
test('HUD quick links are pinned to the dashboard and a fixed set of tabs',async()=>{
 const {dashboardLink}=await import('../src/runtime/hud-state.mjs');
 assert.equal(dashboardLink('players'),'http://127.0.0.1:4173/?tab=players');
 for(const value of ['https://example.org','../api/auth','admin','build','enchant','build&token=x',undefined])assert.throws(()=>dashboardLink(value));
});
test('HUD read model contains only remaining modules even when the server returns old features',async()=>{
 const {hudSummary}=await import('../src/runtime/hud-state.mjs');
 const result=hudSummary({enabled:true,inventory:{value:123,quantity:4,unknownQuantity:1,note:'snapshot'},signals:[],favorites:['hidden'],builds:['hidden'],plans:['hidden'],priest:{enabled:true}});
 assert.equal(result.inventory.value,123);assert.deepEqual(result.signals,[]);
 for(const key of ['favorites','builds','plans','priest'])assert(!Object.hasOwn(result,key));
});
