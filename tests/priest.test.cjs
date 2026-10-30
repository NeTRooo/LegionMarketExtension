const test=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../src/ui/priest-core.ts');
const now=1793275200000;
const hero={login:'healer',role:'priest'};
const quest=(changes={})=>({on:true,party:'in',b:{id:'battle-1',round:3,st:'party',hp:.8,me:0,form:[['healer','priest'],['friend','mage'],['unknown','archer']],low:[['friend','Друг',.12],['dead','Пал',0],['bad','Ошибка',25]],sk:[['свет',0,'heal'],['реген',2,'heal'],['удар',0,'melee'],['неизвестно','0','heal']],until:now+10000,...changes}});
test('priest normalizes fractions only, deduplicates allies and preserves unknown HP',async()=>{
 const core=await load(),battle=core.priestBattle(quest({low:[['friend','Друг',.2],['FRIEND','Друг',.1],['bad','Ошибка',25],['healer','Я',.1]]}),hero,now);
 const view=core.priestView(battle,core.priestPreferences({enabled:true,watched:['unknown']}),['friend'],now,hero);
 assert.equal(view.allies.find(x=>x.login==='friend').hp,10);assert(view.allies.find(x=>x.login==='friend').friend);assert(view.allies.find(x=>x.login==='unknown').selected);assert.equal(view.allies.find(x=>x.login==='bad').hp,null);assert(!view.allies.some(x=>x.login==='healer'));assert.equal(view.allies[0].login,'friend');
});
test('priest readiness uses party phase, turns not seconds, and strict numeric cooldown',async()=>{
 const core=await load(),prefs=core.priestPreferences({enabled:true});
 const view=core.priestView(core.priestBattle(quest(),hero,now),prefs,[],now,hero);
 assert(view.canAct);assert.equal(view.battle.skills.length,3);assert.equal(view.battle.skills[0].cooldown,0);assert.equal(view.battle.skills[1].cooldown,2);assert.equal(view.battle.skills[2].cooldown,null);assert.deepEqual(view.urgent.map(x=>x.login),['friend']);
 const key=core.priestAlertKey(view);assert(key);assert.equal(key,core.priestAlertKey(core.priestView(view.battle,prefs,[],now+5000,hero)));
 for(const change of [{st:'hit'},{st:'tele'},{turn:'heal'},{until:now-1},{gb:{forbid:true}}]){const changed=core.priestView(core.priestBattle(quest(change),hero,now),prefs,[],now,hero);assert(!changed.canAct);assert.equal(core.priestAlertKey(changed),null)}
});
test('stale, wrong class, dead, outside party or unknown membership never report readiness',async()=>{
 const core=await load(),prefs=core.priestPreferences({enabled:true});
 for(const [q,h,time] of [[quest(),hero,now+20000],[quest(),{...hero,role:'mage'},now],[quest({hp:0}),hero,now],[quest({hp:null}),hero,now],[quest({hp:100}),hero,now],[{...quest(),party:'out'},hero,now],[quest({st:'end'}),hero,now]]){const view=core.priestView(core.priestBattle(q,h,now),prefs,[],time,h);assert(!view.eligible);assert(!view.canAct);assert.equal(view.urgent.length,0)}
 assert.equal(core.priestBattle({on:false},hero,now),null);
});
test('prefs, telemetry and identity are bounded and contain no actions or allied HP',async()=>{
 const core=await load(),{briefQuestTelemetry,priestPreferences}=await import('../src/runtime/priest-state.mjs');
 const prefs=priestPreferences({enabled:true,sound:'yes',threshold:1000,watched:['Friend','friend','bad<script>']});assert.deepEqual(prefs,core.priestPreferences(prefs));assert.equal(prefs.threshold,99);assert.equal(prefs.sound,false);assert.deepEqual(prefs.watched,['friend']);
 const event={path:'/api/me',response:{hero:{role:'priest'},ql:quest()}};const brief=briefQuestTelemetry(event);assert.deepEqual(brief.response.ql,{on:true,party:'in'});assert(!JSON.stringify(brief).includes('Друг'));assert(event.response.ql.b);
 assert.deepEqual(briefQuestTelemetry({path:'/api/live',eventType:'q',response:quest()}).response,{on:true,party:'in'});
});
