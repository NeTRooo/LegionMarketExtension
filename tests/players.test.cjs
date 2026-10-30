const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

test('players proxy accepts only private module methods and rejects unrelated writes',async()=>{
  const {playersRequest}=await import('../src/runtime/players-api.mjs');
  assert.equal(playersRequest({path:'/api/players?channel=alpha'}).method,'GET');
  assert.equal(playersRequest({path:'/api/players/contacts',method:'PUT',body:JSON.stringify({channel:'alpha',login:'friend',favorite:true})}).method,'PUT');
  assert.equal(playersRequest({path:'/api/players/observations',method:'DELETE'}).method,'DELETE');
  for(const message of [{path:'/api/auction/buy',method:'POST'},{path:'/api/auth/me'},{path:'https://example.org/api/players'},{path:'/api/players',method:'POST'},{path:'/api/settings?token=secret'},{path:'/api/players?channel=a&channel=b'},{path:'/api/players/contacts',method:'PUT',body:'null'},{path:'/api/players',body:'{}'}])assert.throws(()=>playersRequest(message));
});

test('collector exposes only public author metadata, with original time, without DM or text',async()=>{
  let listener;const sent=[];const at=1793275200000;
  const raw={a:[{l:'actor',x:1}],chat:[{l:'public',n:'Имя',k:'g',at,t:'PUBLIC_TEXT'},{l:'trade',k:'tr',at,t:'TRADE_TEXT'},{l:'private',k:'dm',at,to:'target',t:'DM_TEXT'},{l:'hidden_dm',k:'g',tb:'dm',at,t:'DM_TEXT'},{l:'unknown',at,t:'TEXT'}],mchat:{chat:[{l:'miner',k:'g',at,t:'MINE_TEXT'}]}};
  const sandbox={URL,URLSearchParams,performance,Date,location:{href:'https://play.multidonate.ru/c/test/',origin:'https://play.multidonate.ru'},document:{addEventListener(){}},XMLHttpRequest:function(){}};
  sandbox.XMLHttpRequest.prototype={open(){},send(){}};
  sandbox.window={fetch:async()=>({status:200,headers:{get:()=>''},clone:()=>({text:async()=>JSON.stringify(raw)})}),addEventListener(type,fn){if(type==='message')listener=fn},postMessage(value){sent.push(value)}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','src','runtime','collector-main.js'),'utf8'),sandbox);
  listener({source:sandbox.window,data:{source:'zakviel-market-addon',type:'collector-state',enabled:true}});
  await sandbox.window.fetch('/api/city/state');await new Promise(setImmediate);
  const response=JSON.parse(JSON.stringify(sent[0].event.response));
  assert.deepEqual(response._publicAuthors,[{l:'public',n:'Имя',at},{l:'trade',n:'trade',at},{l:'miner',n:'miner',at}]);
  assert.equal(response.chat,undefined);assert.equal(response.mchat,undefined);
  for(const value of ['PUBLIC_TEXT','TRADE_TEXT','DM_TEXT','MINE_TEXT','hidden_dm','private','target'])assert(!JSON.stringify(response).includes(value));
});
