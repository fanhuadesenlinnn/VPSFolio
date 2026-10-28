import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeAccountConfig,encryptVault,decryptVault,normalizeKiwi,normalizeVirtFusionServers,applyVirtFusionTraffic,normalizeVirtFusionUserServer,percent,validateConfig} from '../src/core.js';
const kiwi={provider:'kiwivm',label:'搬瓦工',veid:'1234',token:'secret'};
const uuid='11111111-2222-4333-8444-555555555555';
const virt={provider:'virtfusion',label:'GreenCloud',origin:'https://cp.green.cloud',serverUuids:[uuid],token:'token'};
test('encrypted vault roundtrip and wrong password',async()=>{
  const input={accounts:[kiwi,virt],threshold:85};
  const vault=await encryptVault(input,'a-long-passphrase');
  assert.equal(JSON.stringify(vault).includes('secret'),false);
  const read=await decryptVault(vault,'a-long-passphrase');
  assert.deepEqual(read.accounts,input.accounts);
  await assert.rejects(()=>decryptVault(vault,'bad-password'));
});
test('KiwiVM data multiplier and reset',()=>{
  const s=normalizeKiwi({error:0,hostname:'abc',plan_monthly_data:1000,data_counter:200,monthly_data_multiplier:2,data_next_reset:1780000000,ip_addresses:['1.2.3.4']},kiwi);
  assert.equal(s.used,400);assert.equal(s.quota,2000);assert.equal(percent(s.used,s.quota),20);
  assert.equal(s.ip,'1.2.3.4');
});
test('VirtFusion current cycle and purchased blocks',()=>{
  const servers=normalizeVirtFusionServers({data:[{id:7,name:'JP',resources:{cpuCores:4}}]},'GreenCloud');
  assert.equal(servers.length,1);
  const row=applyVirtFusionTraffic(servers[0],{data:{trafficBytesPerGb:1000000000,monthly:[{start:'2026-10-01',end:'2026-12-01',rx:30,tx:70,total:100,limit:10,blocks:[{traffic:2}]}]}},Date.parse('2026-10-28'));
  assert.equal(row.quota,12000000000);assert.equal(row.used,100);
});
test('Reject unsafe GreenCloud origins and invalid UUIDs',()=>{
  assert.throws(()=>validateConfig({...virt,origin:'https://attacker.example'}));
  assert.throws(()=>validateConfig({...virt,serverUuids:['../api/v1/servers']}));
  assert.throws(()=>validateConfig({...virt,serverUuids:['../../evil']}));
  assert.throws(()=>validateConfig({...virt,quotaGb:-4}));
});
test('VirtFusion User API live traffic and optional manual quota',()=>{
  const cfg={...virt,quotaGb:4096};
  const s=normalizeVirtFusionUserServer({data:{name:'JP Storage',state:{status:'running',network:{primary:{traffic:{rx:100,tx:200,total:300}}}}}},cfg,uuid);
  assert.equal(s.used,300);assert.equal(s.rx,100);assert.equal(s.tx,200);
  assert.equal(s.quota,4096000000000);assert.equal(s.status,'running');
});
test('Legacy vault account can be updated without re-entering token',()=>{
  const legacy={provider:'virtfusion',label:'Old',origin:'https://cp.green.cloud',token:'secret',listPath:'/api/v1/servers',trafficPath:'/api/v1/servers/{id}/traffic'};
  assert.doesNotThrow(()=>validateConfig(legacy));
});


test('Edit GreenCloud config keeps its original identity, token and legacy fields',()=>{
  const previous={...virt,id:'original-account',token:'preserved-secret',listPath:'/old'};
  const out=mergeAccountConfig(previous,{label:'JP Tokyo',token:'',serverUuids:[uuid],quotaGb:'4096'});
  assert.equal(out.id,'original-account');
  assert.equal(out.provider,'virtfusion');
  assert.equal(out.token,'preserved-secret');
  assert.equal(out.label,'JP Tokyo');
  assert.equal(out.quotaGb,4096);
  assert.equal(out.listPath,'/old');
  assert.equal(previous.label,'GreenCloud');
});
test('Edit GreenCloud can replace token or clear a manual quota',()=>{
  const out=mergeAccountConfig({...virt,quotaGb:4096},{token:'rotated-secret',quotaGb:null});
  assert.equal(out.token,'rotated-secret');
  assert.equal(out.quotaGb,null);
});
test('Edit KiwiVM config updates VEID and label, keeps token if empty',()=>{
  const original={...kiwi,id:'stable',token:'old',veid:'12345'};
  const out=mergeAccountConfig(original,{label:'Repaired VPS',veid:'98765',token:' '});
  assert.equal(out.veid,'98765');
  assert.equal(out.token,'old');
  assert.equal(out.id,'stable');
});
test('Reject invalid edits and protected field changes',()=>{
  assert.throws(()=>mergeAccountConfig({...virt,id:'stable'},{id:'new'}));
  assert.throws(()=>mergeAccountConfig(virt,{provider:'kiwivm'}));
  assert.throws(()=>mergeAccountConfig(virt,{label:'  '}));
  assert.throws(()=>mergeAccountConfig(virt,{serverUuids:['incorrect']}));
  assert.throws(()=>mergeAccountConfig(kiwi,{veid:'xyz'}));
});
