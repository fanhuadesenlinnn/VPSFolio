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
    assert.equal(options.credentials,'include');
    assert.equal(options.redirect,'error');
    if(url.endsWith('?state=true'))return new Response(JSON.stringify({msg:'not permitted to access state'}),{status:403,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({data:{name:'Example'}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const results=await diagnoseGreenCloud(cfg);
    assert.deepEqual(results.map(x=>x.httpStatus),[200,200,403]);
    assert.ok(results[2].message.includes('/api/server/'));
    assert.ok(results[2].message.includes('not permitted to access state'));
    assert.ok(!JSON.stringify(results).includes('a-private-value'));
    assert.equal(urls.length,3);
    assert.ok(urls[0].endsWith('/api/account'));
  } finally {globalThis.fetch=previous;}
});

test('Cloudflare HTML challenge has an actionable message, not a token error',async()=>{
  const original=globalThis.fetch;
  for (const headers of [
    {'content-type':'text/html','cf-mitigated':'challenge'},
    {'content-type':'text/html'}
  ]) {
    globalThis.fetch=async()=>new Response('<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/test"></script>',{status:403,headers});
    try {
      const report=await diagnoseGreenCloud(cfg);
      assert.equal(report.length,1);
      assert.equal(report[0].httpStatus,403);
      assert.match(report[0].message,/Cloudflare.*尚未验证 Token/);
      assert.ok(!JSON.stringify(report).includes(cfg.token));
    } finally {globalThis.fetch=original;}
  }
});

test('KiwiVM never receives browser cookies',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.equal(new URL(url).hostname,'api.64clouds.com');
    assert.equal(options.credentials,'omit');
    assert.equal(options.headers.Authorization,undefined);
    return new Response(JSON.stringify({error:0}),{headers:{'content-type':'application/json'}});
  };
  try {await fetchAccount({provider:'kiwivm',label:'Kiwi',veid:'123',token:'private'});}
  finally {globalThis.fetch=original;}
});

test('Both configured GreenCloud servers are fetched and normalized',async()=>{
  const original=globalThis.fetch;
  const ids=[uuid,'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'];
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push(url);
    assert.equal(options.credentials,'include');
    return new Response(JSON.stringify({data:{name:'VPS',network:{primary:{limit:'4096 GB',ipv4:[{address:'192.0.2.1'}]}},currentMonthlyPeriod:{end:'2026-11-25T23:59:59Z'},state:{status:'running',network:{primary:{traffic:{rx:10,tx:20,total:30}}}}}}),{headers:{'content-type':'application/json'}});
  };
  try {
    const rows=await fetchAccount({...cfg,serverUuids:ids});
    assert.deepEqual(rows.map(r=>r.id),ids);
    assert.deepEqual(rows.map(r=>r.used),[30,30]);
    assert.equal(rows[0].quota,4096e9);
    assert.equal(rows[0].ip,'192.0.2.1');
    assert.equal(calls.length,2);
    assert.ok(calls.every(url=>url.endsWith('?state=true')));
  } finally {globalThis.fetch=original;}
});
test('Diagnostics redact token-looking values from returned API errors',async()=>{
  const previous=globalThis.fetch;
  const fakeSecret='AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  globalThis.fetch=async ()=>new Response(JSON.stringify({message:`Access denied ${fakeSecret}`}),{status:403,headers:{'content-type':'application/json'}});
  try {
    const result=await diagnoseGreenCloud(cfg);
    assert.equal(result.length,1);
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

test('Official account endpoint detects an invalid token before server calls',async()=>{
  const original=globalThis.fetch, calls=[];
  globalThis.fetch=async url=>{
    calls.push(url);return new Response('',{status:401,headers:{'content-type':'application/json'}});
  };
  try{
    const report=await diagnoseGreenCloud(cfg);
    assert.deepEqual(report.map(x=>x.httpStatus),[401]);
    assert.equal(calls.length,1);
    assert.ok(calls[0].endsWith('/api/account'));
  }finally{globalThis.fetch=original;}
});
test('Account API response never exposes personal details',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{
    assert.ok(url.endsWith('/api/account'));
    return new Response(JSON.stringify({data:{name:'Private',email:'hidden@example.com'}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const report=await diagnoseGreenCloud({...cfg,serverUuids:[]});
    assert.equal(report[0].httpStatus,200);
    assert.equal(report[1].test,'服务器 UUID');
    assert.ok(!JSON.stringify(report).includes('Private'));
    assert.ok(!JSON.stringify(report).includes('hidden@example.com'));
  }finally{globalThis.fetch=original;}
});
