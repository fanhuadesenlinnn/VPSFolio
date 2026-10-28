import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptVault,decryptVault,normalizeKiwi,normalizeVirtFusionServers,applyVirtFusionTraffic,percent,validateConfig} from '../src/core.js';
const kiwi={provider:'kiwivm',label:'搬瓦工',veid:'1234',token:'secret'};
const virt={provider:'virtfusion',label:'GreenCloud',origin:'https://cp.green.cloud',listPath:'/api/v1/servers',trafficPath:'/api/v1/servers/{id}/traffic',token:'token'};
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
test('Reject unsafe GreenCloud origins and paths',()=>{
  assert.throws(()=>validateConfig({...virt,origin:'https://attacker.example'}));
  assert.throws(()=>validateConfig({...virt,listPath:'//evil.example/foo'}));
  assert.throws(()=>validateConfig({...virt,trafficPath:'/a/../b/{id}'}));
});
