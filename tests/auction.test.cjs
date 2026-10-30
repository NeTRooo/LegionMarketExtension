const test = require('node:test');
const assert = require('node:assert/strict');

test('auction bridge accepts only the two public GET routes and bounded parameters', async () => {
  const {auctionRequestPath} = await import('../src/runtime/auction-api.mjs');
  assert.equal(auctionRequestPath('/api/auction/analysis?channel=alpha&days=7'), '/api/auction/analysis?channel=alpha&days=7');
  assert.equal(auctionRequestPath('/api/auction/seller?seller=user&city=fair&days=1'), '/api/auction/seller?seller=user&city=fair&days=1');
  for (const input of ['http://example.org/api/auction/analysis','//example.org/api/auction/analysis','/api/auction/buy','/api/auction/../auth/me','/api/auction/analysis?days=2','/api/auction/analysis?token=secret','/api/auction/analysis?days=1&days=7','/api/auction/seller','/api/auction/seller?seller=%0a','/api/auction/analysis#foo']) assert.throws(() => auctionRequestPath(input), input);
});

test('only public auction fields leave the explicit refresh; oversized books are rejected intact', async () => {
  const {publicAuctionPayload} = await import('../src/runtime/auction-api.mjs');
  const payload = publicAuctionPayload({lots:[],items:{blade:{name:'Меч'}},vals:{blade:42},hist:{blade:[[10,0]]},ench:{bonus:[0]},hero:{name:'private'},token:'secret',chat:['private']});
  assert.deepEqual(Object.keys(payload).sort(), ['ench','hist','items','lots','vals']);
  assert.throws(() => publicAuctionPayload({ok:false,lots:[]}));
  assert.throws(() => publicAuctionPayload({lots:Array(2001).fill({id:1})}));
  assert.throws(() => publicAuctionPayload({hero:{}}));
});
