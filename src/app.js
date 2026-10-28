import {bytesText,percent} from './core.js';
const $=sel=>document.querySelector(sel);
const app=$('#app'), isPopup=document.body.classList.contains('popup');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null;
let editingId=null;
async function send(type,extra={}){
  const res=await chrome.runtime.sendMessage({type,...extra});
  if(!res?.ok)throw Error(res?.error||'未知错误');
  return res.data;
}
function notice(s,bad=false){
  const box=$('#feedback');if(!box)return;
  box.className='notice'+(bad?' error':'');box.textContent=s;box.hidden=false;
}
async function action(fn,success){
  try{const result=await fn();if(result?.hasVault!==undefined)state=result;else state=await send('STATE');render();if(success)notice(success);}
  catch(e){notice(e.message,true);}
}
function card(s){
  const p=percent(s.used,s.quota),isWarn=p!==null&&p>=state.threshold;
  const status=/^(running|active|online|up)$/i.test(s.status)?'运行中':s.status;
  return `<article class="server"><div class="meta"><div><div class="name">${esc(s.name)}</div><div class="small">${esc(s.label)} · ${s.provider==='kiwivm'?'BandwagonHost':'GreenCloud'}</div></div><span class="pill ${status==='运行中'?'':'err'}">${esc(status||'未知')}</span></div>
    <div class="detail"><span>IP / 地区</span><b>${esc(s.ip||'—')} · ${esc(s.location||'—')}</b></div>
    <div class="bar"><i class="${isWarn?'warn':''}" style="width:${Math.max(0,Math.min(100,p??0))}%"></i></div>
    <div class="detail"><span>已用流量</span><b>${bytesText(s.used)}${p!==null?' · '+p+'%':''}</b></div>
    <div class="detail"><span>总配额 / 剩余</span><b>${bytesText(s.quota)} / ${s.quota===null?'—':bytesText(Math.max(0,s.quota-(s.used||0)))}</b></div>
    <div class="detail"><span>重置时间</span><b>${s.reset?esc(new Date(s.reset).toLocaleString('zh-CN')):'—'}</b></div>
    ${s.error?`<div class="notice error">${esc(s.error)}</div>`:''}</article>`;
}
function head(){return `<header class="top"><div class="brand"><div class="logo">V</div><div><h1>VPSFolio</h1><div class="small">Your VPS, one dashboard</div></div></div><div class="actions"><button id="refresh" ${!state?.unlocked?'disabled':''}>↻ 刷新</button>${isPopup?'<button id="openDashboard" class="primary">管理</button>':'<button id="lock">锁定</button>'}</div></header>`;}
function summary(){
  const sv=state.snapshot||[],bad=sv.filter(s=>(percent(s.used,s.quota)||0)>=state.threshold).length;
  const updated=state.updatedAt?new Date(state.updatedAt).toLocaleString('zh-CN'):'尚未同步';
  return `<section class="statgrid"><div class="stat"><span class="small">VPS 总数</span><strong>${sv.length}</strong></div><div class="stat"><span class="small">服务商账户</span><strong>${state.accounts.length}</strong></div><div class="stat"><span class="small">流量预警</span><strong>${bad}</strong></div><div class="stat"><span class="small">最近刷新</span><strong style="font-size:13px">${esc(updated)}</strong></div></section>`;
}
function editAccountForm(a) {
  return `<form class="edit-account-form" data-id="${esc(a.id)}">
    <h3>编辑配置 · ${esc(a.label)}</h3>
    <div class="fields">
      <div><label>服务商（不可修改）</label><input value="${a.provider==='virtfusion'?'GreenCloud · VirtFusion':'搬瓦工 · KiwiVM'}" disabled></div>
      <div><label>显示名称</label><input name="label" maxlength="70" required value="${esc(a.label)}" autocomplete="off"></div>
      <div class="wide"><label>替换 API Key（留空保留原密钥）</label><input name="token" type="password" placeholder="不修改请留空" autocomplete="new-password"></div>
      ${a.provider==='virtfusion'
       ? `<div class="wide"><label>服务器 UUID（多个以逗号或空格分隔）</label><input name="serverUuids" value="${esc((a.serverUuids||[]).join(', '))}" placeholder="服务器页面 /server/ 后的 UUID" autocomplete="off"></div><div><label>流量配额 GB（可选）</label><input name="quotaGb" type="number" min="1" max="10000000" step="any" value="${a.quotaGb==null?'':esc(a.quotaGb)}" placeholder="留空使用 API 返回值"></div>`
       : `<div><label>VEID</label><input name="veid" inputmode="numeric" pattern="[0-9]+" required value="${esc(a.veid||'')}" autocomplete="off"></div>`}
    </div>
    <div class="form-actions"><button class="primary" type="submit">保存修改</button><button class="cancelEdit" type="button">取消</button></div>
    <div class="small">原账户 ID 保留，密钥留空不会修改；保存后需刷新才能重新查询。</div>
  </form>`;
}
function mainView(){
  const sv=state.snapshot||[];
  let html=head()+summary();
  if(state.errors.length){html+=`<div class="warning-list">${state.errors.map(e=>`<div class="notice error"><span>${esc(e.label)}：${esc(e.message)}</span>${state.accounts.some(a=>a.id===e.accountId)?` <button class="tiny editAccount" data-id="${esc(e.accountId)}">编辑配置</button>`:''}</div>`).join('')}</div>`;}
  html+=`<section class="panel"><div class="paneltitle"><h2>服务器 · ${sv.length}</h2><span class="small">流量阈值 ${state.threshold}%</span></div>`;
  html+=sv.length?`<div class="servergrid">${sv.map(card).join('')}</div>`:'<div class="empty">还没有服务器数据。添加账户并点击「刷新」即可查询。</div>';
  html+='</section>';
  if(isPopup) return html+'<div id="feedback" class="notice" hidden></div><div class="foot">自动刷新每 15 分钟（浏览器打开且保险库已解锁时）</div>';
  html+=`<section class="panel"><div class="paneltitle"><h2>已添加账户</h2></div>`;
  html+=state.accounts.length?state.accounts.map(a=>`<div class="account-group"><div class="account"><div><strong>${esc(a.label)}</strong><div class="small">${a.provider==='kiwivm'?'搬瓦工 KiwiVM · VEID '+esc(a.veid):'GreenCloud VirtFusion · '+esc((a.serverUuids||[]).length)+' 台 VPS'}</div></div><div class="actions"><button class="tiny editAccount" data-id="${esc(a.id)}">编辑配置</button>${a.provider==='virtfusion'?`<button class="tiny diagnoseGreen" data-id="${esc(a.id)}">诊断 API</button>`:''}<button class="tiny danger remove" data-id="${esc(a.id)}">移除</button></div></div>${editingId===a.id?editAccountForm(a):''}</div>`).join(''):'<div class="small">当前没有账号。</div>';
  html+='</section>';
  html+=`<section class="panel"><h2>添加服务商账户</h2><form id="accountForm"><div class="fields"><div><label>服务商</label><select name="provider" id="provider"><option value="virtfusion">GreenCloud · VirtFusion</option><option value="kiwivm">搬瓦工 · KiwiVM</option></select></div><div><label>显示名称</label><input name="label" required maxlength="70" placeholder="例如 JP Softbank" autocomplete="off"></div><div class="wide"><label>API Key / Bearer Token</label><input name="token" type="password" required autocomplete="off" placeholder="仅加密保存在本机"></div></div>
   <div id="virtFields"><div class="fields"><div class="wide"><label>服务器 UUID（多个以逗号分隔）</label><input name="serverUuids" placeholder="复制 https://cp.green.cloud/server/ 后的 UUID" autocomplete="off" required></div><div><label>流量配额 GB（可选，若 API 不提供）</label><input name="quotaGb" type="number" min="1" step="1" placeholder="如 4096"></div></div><div class="notice">使用 VirtFusion 终端用户 API：GET /api/server/{uuid}?state=true。不要使用 /api/v1/servers 管理员接口。流量配额无法从 API 确认时可手动填入。</div></div>
   <div id="kiwiFields" class="hidden"><label>VEID（VPS ID）</label><input name="veid" placeholder="例如 123456" inputmode="numeric" autocomplete="off"><div class="small" style="margin-top:6px">每台搬瓦工 VPS 需分别配置 VEID 和对应的 API Key。</div></div>
   <div class="form-actions"><button class="primary" type="submit">保存账户</button></div></form></section>`;
  html+=`<section class="panel"><h2>设置与备份</h2><div class="inline"><div><label>流量告警阈值（%）</label><input id="threshold" type="number" min="1" max="100" value="${state.threshold}"></div><button id="saveThreshold">保存阈值</button></div><hr><div class="actions"><button id="export">导出加密备份</button><button id="import">导入本地备份</button><button id="cloudBackup">备份至 Google Drive</button><button id="cloudRestore">从 Google Drive 恢复</button></div><input id="backupFile" type="file" accept="application/json,.json" hidden><div class="notice">备份包含服务商密钥，但仅以 AES-256-GCM 密文保存。恢复时必须使用创建备份时的加密口令。Google Drive 使用 appDataFolder；首次使用需配置 OAuth Client ID，具体见 README。</div></section>`;
  html+='<div id="feedback" class="notice" hidden></div><div class="foot">VPSFolio · 只读 API · 不采集任何账户密码 · 开源 Chrome Extension</div>';
  return html;
}
function render(){
  let html='';
  if(!state) {app.textContent='正在读取…';return;}
  if(!state.hasVault){html=`${head()}<section class="panel"><h2>首次使用 · 创建加密保险库</h2><div class="notice">你的 API Key 会通过 PBKDF2 + AES-GCM 加密后储存在本机。请记住加密口令，遗失后无法恢复密钥。</div><form id="initForm"><label>加密口令（至少 10 字符）</label><input type="password" name="password" required minlength="10" autocomplete="new-password"><button class="primary" style="margin-top:14px">创建保险库</button></form></section><div id="feedback" class="notice" hidden></div>`;}
  else if(!state.unlocked){html=`${head()}<section class="panel"><h2>解锁保险库</h2><form id="unlockForm"><label>加密口令</label><input type="password" name="password" required autocomplete="current-password"><button class="primary" style="margin-top:14px">解锁</button></form>${!isPopup?'<div class="notice">口令只保存在当前浏览器会话中。锁定状态下不会自动查询 API。</div>':''}</section><div id="feedback" class="notice" hidden></div>`;}
  else html=mainView();
  app.innerHTML=`<div class="shell">${html}</div>`;
  bind();
}
function bind(){
  $('#openDashboard')?.addEventListener('click',()=>chrome.runtime.openOptionsPage());
  $('#lock')?.addEventListener('click',()=>action(()=>send('LOCK')));
  $('#refresh')?.addEventListener('click',()=>action(()=>send('REFRESH'),'查询完成'));
  for(const id of ['init','unlock']){
    $(`#${id}Form`)?.addEventListener('submit',e=>{
      e.preventDefault();const pass=new FormData(e.currentTarget).get('password');
      action(()=>send(id==='init'?'CREATE':'UNLOCK',{password:String(pass)}));
    });
  }
  $('#provider')?.addEventListener('change',e=>{
    $('#virtFields').classList.toggle('hidden',e.target.value!=='virtfusion');
    $('#kiwiFields').classList.toggle('hidden',e.target.value!=='kiwivm');
  });
  $('#accountForm')?.addEventListener('submit',e=>{
    e.preventDefault();const f=new FormData(e.currentTarget),provider=String(f.get('provider'));
    const account={provider,label:String(f.get('label')||'').trim(),token:String(f.get('token')||'').trim()};
    if(provider==='kiwivm')account.veid=String(f.get('veid')||'').trim();
    else Object.assign(account,{origin:'https://cp.green.cloud',serverUuids:String(f.get('serverUuids')||'').split(/[\s,;]+/).filter(Boolean),quotaGb:f.get('quotaGb')?Number(f.get('quotaGb')):null});
    action(()=>send('ADD_ACCOUNT',{account}),'账户已加密保存，请点击刷新');
  });
  document.querySelectorAll('.editAccount').forEach(b=>b.addEventListener('click',()=>{
    editingId=b.dataset.id;
    render();
    document.querySelector('.edit-account-form')?.scrollIntoView({block:'nearest'});
  }));
  document.querySelectorAll('.cancelEdit').forEach(b=>b.addEventListener('click',()=>{
    editingId=null;render();
  }));
  document.querySelectorAll('.edit-account-form').forEach(form=>form.addEventListener('submit',e=>{
    e.preventDefault();
    const a=state.accounts.find(x=>x.id===form.dataset.id);
    if(!a){notice('账户不存在',true);return;}
    const f=new FormData(form);
    const changes={label:String(f.get('label')||'').trim(),token:String(f.get('token')||'').trim()};
    if(a.provider==='kiwivm') changes.veid=String(f.get('veid')||'').trim();
    else {
      changes.serverUuids=String(f.get('serverUuids')||'').split(/[\\s,;]+/).filter(Boolean);
      changes.quotaGb=f.get('quotaGb')===''?null:String(f.get('quotaGb'));
    }
    action(async()=>{
      const result=await send('UPDATE_ACCOUNT',{id:a.id,changes});
      editingId=null;
      return result;
    },'配置已保存，请点击刷新重新查询');
  }));
  document.querySelectorAll('.diagnoseGreen').forEach(b=>b.addEventListener('click',async()=>{
    try {
      notice('正在检测账户认证、服务器详情及实时状态…');
      const report=await send('DIAGNOSE_GREEN',{id:b.dataset.id});
      notice(report.map(x=>`${x.test}：${x.httpStatus || '网络错误'}；${x.message}`).join(' | '),report.some(x=>x.httpStatus!==200));
    } catch(e) {notice(e.message,true);}
  }));
  document.querySelectorAll('.remove').forEach(b=>b.addEventListener('click',()=>{
    if(confirm('确定移除这个服务商账户和 API Key？'))action(()=>send('DELETE_ACCOUNT',{id:b.dataset.id}),'账户已移除');
  }));
  $('#saveThreshold')?.addEventListener('click',()=>action(()=>send('SET_THRESHOLD',{threshold:$('#threshold').value}),'告警阈值已保存'));
  $('#export')?.addEventListener('click',()=>action(async()=>{
    const data=await send('EXPORT');
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`vpsfolio-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  },'加密备份已导出'));
  $('#import')?.addEventListener('click',()=>$('#backupFile').click());
  $('#backupFile')?.addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    if(file.size>5_000_000){notice('文件超过 5 MB',true);return;}
    if(!confirm('导入将覆盖本机现有账户和配置。确定继续？'))return;
    const password=prompt('输入此备份的加密口令');if(!password)return;
    await action(async()=>send('IMPORT',{vault:JSON.parse(await file.text()),password}),'已恢复本地备份');
  });
  $('#cloudBackup')?.addEventListener('click',()=>action(()=>send('BACKUP'),'已将加密备份上传到 Google Drive'));
  $('#cloudRestore')?.addEventListener('click',()=>{
    if(!confirm('云端恢复将覆盖本机现有配置。继续？'))return;
    const password=prompt('输入云端备份的加密口令（不能使用新口令）');if(!password)return;
    action(()=>send('RESTORE',{password}),'已从 Google Drive 恢复加密备份');
  });
}
async function boot(){try{state=await send('STATE');render();}catch(e){app.textContent=e.message;}}
boot();
