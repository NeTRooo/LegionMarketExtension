const test=require('node:test');
const assert=require('node:assert/strict');
test('battle HP and roster stay out of durable telemetry after removing battle UI',async()=>{
  const {briefQuestTelemetry}=await import('../src/runtime/quest-telemetry.mjs');
  const battle={on:true,k:'boss',party:'in',b:{low:[['ally','Name',.2]],form:[['ally','mage']],sk:[['heal',0,'heal']]}};
  const event={path:'/c/test/api/live',eventType:'q',response:battle};
  assert.deepEqual(briefQuestTelemetry(event).response,{on:true,k:'boss',party:'in'});
  assert.equal(event.response,battle);assert(battle.b.low);
  assert.deepEqual(briefQuestTelemetry({path:'/api/me',response:{hero:{money:42},ql:battle}}).response,{hero:{money:42},ql:{on:true,k:'boss',party:'in'}});
});
test('journal migration preserves public snapshots and removes unified chat routes and private SSE',async()=>{
  const {scrubJournal}=await import('../src/runtime/quest-telemetry.mjs');
  const book={path:'/api/auction',response:{lots:[]}},events=[book,{path:'/c/test/api/chat/say',request:{line:'private'}},{path:'/api/chat/feed',response:{messages:['private']}},{path:'/api/live',eventType:'dm',response:{text:'private'}},{path:'/api/me',response:{ql:{on:true,b:{low:['private']}}}}];
  const result=scrubJournal(events);assert.equal(result.length,2);assert.equal(result[0],book);assert.deepEqual(result[1].response.ql,{on:true});assert.equal(events.length,5);
});
