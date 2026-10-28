import {encryptVault,decryptVault,percent,validateConfig} from './core.js';
import {fetchAccount} from './providers.js';
import {backupVault,restoreVault} from './drive.js';
const ALARM='vpsfolio-refresh';
const getLocal = async()=>chrome.storage.local.get(['vault','snapshot','errors','updatedAt']);
async function getSettings(){
  const {vault}=await getLocal();
  if(!vault) return null;
  const {password}=await chrome.storage.session.get('password');
  if(!password) throw Error('保险库已锁定，请先输入加密口令');
  return decryptVault(vault,password);
}
async function saveSettings(data){
  data.accounts.forEach(validateConfig);
  const {password}=await chrome.storage.session.get('password');
  if(!password) throw Error('保险库未解锁');
  await chrome.storage.local.set({vault:await encryptVault(data,password)});
}
function sanitized(data){return (data?.accounts||[]).map(({token,...safe})=>safe);}
async function getState(){
  const v=await getLocal();
  const {password}=await chrome.storage.session.get('password');
  let data=null, unlocked=false;
  if(v.vault && password) {
    try{data=await decryptVault(v.vault,password);unlocked=true;}
    catch { await chrome.storage.session.remove('password'); }
  }
  return {hasVault:!!v.vault,unlocked,accounts:sanitized(data),threshold:data?.threshold??80,
    snapshot:v.snapshot||[],errors:v.errors||[],updatedAt:v.updatedAt||null};
}
async function refresh(){
  const data=await getSettings();
  if(!data) return getState();
  const previous=await getLocal();
  const results=await Promise.all(data.accounts.map(async cfg=>{
    try {
      const servers=await fetchAccount(cfg);
      return {servers:servers.map(s=>({...s,accountId:cfg.id})),error:null};
    } catch(e) {return {servers:[],error:{accountId:cfg.id,label:cfg.label,message:String(e.message||e).slice(0,220)}};}
  }));
  const snapshot=results.flatMap(x=>x.servers),errors=results.map(x=>x.error).filter(Boolean);
  const old=new Map((previous.snapshot||[]).map(s=>[`${s.accountId}:${s.id}`,s]));
  for(const s of snapshot){
    const p=percent(s.used,s.quota),last=old.get(`${s.accountId}:${s.id}`),before=last?percent(last.used,last.quota):null;
    const threshold=Number(data.threshold)||80;
    if(p!==null && p>=threshold && (before===null||before<threshold) && s.quota!==null){
      await chrome.notifications.create(`vpsfolio-${s.accountId}-${s.id}`,{type:'basic',iconUrl:'icons/128.png',title:'VPSFolio 流量预警',message:`${s.name} 已使用 ${p}% 配额`});
    }
  }
  await chrome.storage.local.set({snapshot,errors,updatedAt:new Date().toISOString()});
  return getState();
}
async function dispatch(message){
  switch(message?.type){
    case 'STATE':return getState();
    case 'CREATE':{
      if((await getLocal()).vault) throw Error('保险库已经存在');
      const password=String(message.password||'');
      await chrome.storage.local.set({vault:await encryptVault({accounts:[],threshold:80},password)});
      await chrome.storage.session.set({password}); return getState();
    }
    case 'UNLOCK':{
      const {vault}=await getLocal();
      if(!vault) throw Error('保险库不存在');
      const password=String(message.password||'');
      await decryptVault(vault,password);
      await chrome.storage.session.set({password});return getState();
    }
    case 'LOCK':await chrome.storage.session.remove('password');return getState();
    case 'ADD_ACCOUNT':{
      const data=await getSettings();
      const c={...message.account,id:crypto.randomUUID()};
      validateConfig(c);data.accounts.push(c);await saveSettings(data);return getState();
    }
    case 'DELETE_ACCOUNT':{
      const data=await getSettings();
      data.accounts=data.accounts.filter(x=>x.id!==message.id);
      await saveSettings(data);return getState();
    }
    case 'SET_THRESHOLD':{
      const data=await getSettings(),n=Number(message.threshold);
      if(!Number.isInteger(n)||n<1||n>100) throw Error('阈值应为 1–100');
      data.threshold=n;await saveSettings(data);return getState();
    }
    case 'REFRESH':return refresh();
    case 'EXPORT':{
      const {vault}=await getLocal();if(!vault) throw Error('尚无保险库');return vault;
    }
    case 'IMPORT':{
      const incoming=message.vault;
      await decryptVault(incoming, String(message.password||''));
      await chrome.storage.local.set({vault:incoming,snapshot:[],errors:[],updatedAt:null});
      await chrome.storage.session.set({password:String(message.password)});return getState();
    }
    case 'BACKUP':{
      const {vault}=await getLocal();if(!vault) throw Error('尚无保险库');
      await backupVault(vault);return {ok:true};
    }
    case 'RESTORE':{
      const incoming=await restoreVault();
      // Validate after download, BEFORE replacing the local vault.
      await decryptVault(incoming,String(message.password||''));
      await chrome.storage.local.set({vault:incoming,snapshot:[],errors:[],updatedAt:null});
      await chrome.storage.session.set({password:String(message.password)});return getState();
    }
    default:throw Error('未知操作');
  }
}
chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  dispatch(message).then(data=>sendResponse({ok:true,data})).catch(e=>sendResponse({ok:false,error:String(e.message||e)}));
  return true;
});
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create(ALARM,{periodInMinutes:15}));
chrome.runtime.onStartup.addListener(()=>chrome.alarms.create(ALARM,{periodInMinutes:15}));
chrome.alarms.onAlarm.addListener(async a=>{if(a.name===ALARM){try{await refresh();}catch{/* vault locked: skip */}}});
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
