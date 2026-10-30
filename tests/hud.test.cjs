const test=require('node:test');
const assert=require('node:assert/strict');
test('HUD preferences use strict flags, finite geometry and bounded account-specific selections',async()=>{
 const {hudPreferences,hudBounds}=await import('../src/runtime/hud-state.mjs');
 assert.equal(hudPreferences().enabled,false);
 const prefs=hudPreferences({enabled:true,collapsed:'true',x:NaN,y:Infinity,width:10000,height:-1,buildToken:'x'.repeat(200),planId:42,token:'secret'});
 assert.equal(prefs.enabled,true);assert.equal(prefs.collapsed,false);assert.equal(prefs.x,null);assert.equal(prefs.y,80);assert.equal(prefs.width,900);assert.equal(prefs.height,180);assert.equal(prefs.buildToken.length,100);assert.equal(prefs.planId,'');assert(!('token'in prefs));
 const bounds=hudBounds({...prefs,x:9999,y:9999},390,844);assert(bounds.x+bounds.width<=390);assert(bounds.y+bounds.height<=844);
});
test('HUD quick links are pinned to the dashboard and a fixed set of tabs',async()=>{
 const {dashboardLink}=await import('../src/runtime/hud-state.mjs');
 assert.equal(dashboardLink('players'),'http://127.0.0.1:4173/?tab=players');
 for(const value of ['https://example.org','../api/auth','admin','build&token=x',undefined])assert.throws(()=>dashboardLink(value));
});
