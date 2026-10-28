import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseGreenCloud,fetchAccount} from '../src/providers.js';
const uuid='11111111-2222-4333-8444-555555555555';
const cfg={provider:'virtfusion',origin:'https://cp.green.cloud',serverUuids:[uuid],label:'Test',token:'a-private-value'};
test('GreenCloud diagnostic distinguishes 403 from successful basic server API',async()=>{
  const previous=globalThis.fetch;
  const urls=[];
  globalThis.fetch=async (url,options)=>{
    urls.push(url);
    assert.equal(options.headers.Authorization,'Bearer a-private-value');
    if(url.endsWith('?state=true'))return new Response(JSON.stringify({msg:'not permitted to access state'}),{status:403,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({data:{name:'Example'}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const results=await diagnoseGreenCloud(cfg);
    assert.deepEqual(results.map(x=>x.httpStatus),[200,403]);
    assert.ok(results[1].message.includes('/api/server/'));
    assert.ok(results[1].message.includes('not permitted to access state'));
    assert.ok(!JSON.stringify(results).includes('a-private-value'));
    assert.equal(urls.length,2);
  } finally {globalThis.fetch=previous;}
});
test('Diagnostics redact token-looking values from returned API errors',async()=>{
  const previous=globalThis.fetch;
  const fakeSecret='AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  globalThis.fetch=async ()=>new Response(JSON.stringify({message:`Access denied ${fakeSecret}`}),{status:403,headers:{'content-type':'application/json'}});
  try {
    const result=await diagnoseGreenCloud(cfg);
    assert.equal(result.length,2);
    assert.ok(!JSON.stringify(result).includes(fakeSecret));
    assert.ok(JSON.stringify(result).includes('[REDACTED]'));
  } finally {globalThis.fetch=previous;}
});
test('GreenCloud fetch retains 403 detail without logging authorization',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async ()=>new Response(JSON.stringify({msg:'server access denied'}),{status:403,headers:{'content-type':'application/json'}});
  try {
    await assert.rejects(()=>fetchAccount(cfg),e=>e.message.includes('server access denied')&&!e.message.includes('a-private-value'));
  } finally {globalThis.fetch=previous;}
});
