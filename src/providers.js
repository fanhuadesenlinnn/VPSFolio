import {normalizeKiwi, normalizeVirtFusionServers, applyVirtFusionTraffic, normalizeVirtFusionUserServer, validateConfig} from './core.js';
function apiError(status, url, contentType, body) {
  const path = new URL(url).pathname; // Never expose query strings containing KiwiVM credentials.
  let serverMessage = '';
  if (contentType.includes('application/json')) {
    try {
      const json = JSON.parse(body);
      const raw = json?.msg ?? json?.message ?? (typeof json?.error === 'string' ? json.error : null) ??
        (Array.isArray(json?.errors) ? json.errors.find(x => typeof x === 'string') : null);
      if (typeof raw === 'string') serverMessage = raw.replace(/[A-Za-z0-9_+/=-]{32,}/g,'[REDACTED]').replace(/[\r\n\t]/g,' ').slice(0,140);
    } catch { /* invalid error format */ }
  }
  const hint = status === 401 ? 'Token 无效、过期或认证格式不对' :
    status === 403 ? (contentType.includes('json') ? '服务器拒绝授权：请核查 Token、UUID 归属及用户 API 权限' : '服务端拒绝请求，可能由反向代理或安全策略拦截') :
    status === 404 ? '接口或服务器 UUID 未找到' : 'API 请求失败';
  const e = new Error(`HTTP ${status} ${path}：${hint}${serverMessage ? '；服务端信息：'+serverMessage : ''}`);
  e.httpStatus = status;
  return e;
}
async function readJson(url, headers = {}) {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, {method:'GET', headers:{Accept:'application/json', ...headers}, credentials:'omit', cache:'no-store', redirect:'error', signal:ctl.signal});
    const type = res.headers.get('content-type') || '';
    const body = await res.text();
    if (body.length > 2_000_000) throw Error('API 响应过大');
    if (!res.ok) throw apiError(res.status,url,type,body.slice(0,20000));
    try { return JSON.parse(body); } catch { throw Error(`API ${new URL(url).pathname} 未返回 JSON，请检查接口路径`); }
  } finally { clearTimeout(timeout); }
}
export async function diagnoseGreenCloud(cfg) {
  validateConfig(cfg);
  if (cfg.provider !== 'virtfusion') throw Error('仅支持诊断 GreenCloud');
  const uuid = cfg.serverUuids?.[0];
  if (!uuid) throw Error('请先填写 GreenCloud 服务器 UUID');
  const headers = {Authorization:`Bearer ${cfg.token}`};
  const path = `/api/server/${encodeURIComponent(uuid)}`;
  const result = [];
  for (const [name,suffix] of [['服务器详情',''],['实时状态','?state=true']]) {
    try {
      const data=await readJson(`${cfg.origin}${path}${suffix}`, headers);
      const root=data?.data ?? data;
      result.push({test:name,httpStatus:200,message:`成功（包含 ${Object.keys(root||{}).length} 个顶层字段）`});
    } catch (e) {
      result.push({test:name,httpStatus:e.httpStatus||0,message:String(e.message||e).slice(0,260)});
      if (e.httpStatus===429) break;
    }
  }
  return result;
}
export async function fetchAccount(cfg) {
  validateConfig(cfg);
  if (cfg.provider === 'kiwivm') {
    const url = new URL('https://api.64clouds.com/v1/getServiceInfo');
    url.searchParams.set('veid', cfg.veid);
    url.searchParams.set('api_key', cfg.token);
    const json = await readJson(url.toString());
    return [normalizeKiwi(json,cfg)];
  }
  const ids = cfg.serverUuids || [];
  if (!ids.length) throw Error('GreenCloud 需要填写服务器 UUID：打开 cp.green.cloud/server/...，复制 /server/ 后面的 UUID，并在账户中点击「设置 UUID」');
  const headers = {Authorization:`Bearer ${cfg.token}`};
  return Promise.all(ids.map(async uuid => {
    const json = await readJson(`${cfg.origin}/api/server/${encodeURIComponent(uuid)}?state=true`,headers);
    return normalizeVirtFusionUserServer(json,cfg,uuid);
  }));
}
