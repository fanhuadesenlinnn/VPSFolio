// Drive appDataFolder: only this app's invisible space. Never uploads plaintext settings.
const FILE = 'vpsfolio-vault-v1.json';
const api = 'https://www.googleapis.com/drive/v3/files';
function ensureConfigured() {
  const cid = chrome.runtime.getManifest().oauth2?.client_id || '';
  if (!cid || cid.includes('REPLACE_WITH')) throw Error('Google Drive 尚未配置 OAuth Client ID；请参阅 README 的 Google Drive 设置');
}
async function token(interactive) {
  ensureConfigured();
  const result = await chrome.identity.getAuthToken({interactive});
  const access = typeof result === 'string' ? result : result?.token;
  if (!access) throw Error('Google 授权未返回访问令牌');
  return access;
}
async function request(url, {method='GET', body, type, interactive=false} = {}) {
  const access = await token(interactive);
  const headers = {Authorization:`Bearer ${access}`};
  if (type) headers['Content-Type'] = type;
  const res = await fetch(url,{method,headers,body,credentials:'omit'});
  if (!res.ok) {
    if (res.status === 401) await chrome.identity.removeCachedAuthToken({token:access});
    throw Error(`Google Drive HTTP ${res.status}：请确认 Google API 已启用及 OAuth 权限`);
  }
  return res;
}
async function findFile(interactive) {
  const q = new URLSearchParams({spaces:'appDataFolder',fields:'nextPageToken,files(id,name,modifiedTime)',page_size:'100',pageSize:'100',q:`name = '${FILE}' and trashed = false`});
  const result = await (await request(`${api}?${q}`,{interactive})).json();
  return (result.files || []).sort((a,b)=>String(b.modifiedTime||'').localeCompare(String(a.modifiedTime||'')))[0] || null;
}
export async function backupVault(vault) {
  const existing = await findFile(true);
  const content = JSON.stringify(vault);
  if (existing) {
    const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=media`;
    await request(url,{method:'PATCH',body:content,type:'application/json',interactive:true});
  } else {
    const meta = JSON.stringify({name:FILE,parents:['appDataFolder'],mimeType:'application/json'});
    const boundary = 'vpsfolio-' + crypto.randomUUID().replaceAll('-','');
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',{method:'POST',body,type:`multipart/related; boundary=${boundary}`,interactive:true});
  }
  return {updated:true};
}
export async function restoreVault() {
  const existing = await findFile(true);
  if (!existing) throw Error('Google Drive 中没有 VPSFolio 备份');
  const res = await request(`${api}/${encodeURIComponent(existing.id)}?alt=media`,{interactive:true});
  const text = await res.text();
  if (text.length > 5_000_000) throw Error('云端备份过大');
  const vault = JSON.parse(text);
  if (vault.format !== 'vpsfolio-vault' || vault.version !== 1) throw Error('云端文件不是受支持的 VPSFolio 加密备份');
  return vault;
}
