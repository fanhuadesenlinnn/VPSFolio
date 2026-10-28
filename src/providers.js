import {normalizeKiwi, normalizeVirtFusionUserServer, validateConfig} from './core.js';
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
    if (res.headers.get('cf-mitigated') === 'challenge' ||
        (type.includes('text/html') && /challenge-platform|<title>Just a moment\.\.\.<\/title>/i.test(body))) {
      const rawRay = res.headers.get('cf-ray') || '';
      const ray = /^[a-f0-9]{16}-[a-z]{3}$/i.test(rawRay) ? rawRay : '';
      const e = new Error(`Cloudflare 拦截了 API 请求（尚未验证 Token）；请联系 GreenCloud 核查此 API 的验证策略${ray ? '；Ray ID: '+ray : ''}。此请求仅使用 Bearer Token，不依赖登录 Cookie。`);
      e.httpStatus = res.status;
      throw e;
    }
    if (!res.ok) throw apiError(res.status,url,type,body.slice(0,20000));
    try { return JSON.parse(body); } catch { throw Error(`API ${new URL(url).pathname} 未返回 JSON，请检查接口路径`); }
  } finally { clearTimeout(timeout); }
}
// Official end-user API uses Bearer authorization, independent of browser login.
function readGreenCloud(cfg, path, headers) {
  return readJson(`${cfg.origin}${path}`, {'Content-Type':'application/json',...headers});
}
/** Read-only staged diagnostics: account authentication first, server ownership second. */
export async function diagnoseGreenCloud(cfg) {
  validateConfig(cfg);
  if (cfg.provider !== 'virtfusion') throw Error('仅支持诊断 GreenCloud');
  const headers = {Authorization:`Bearer ${cfg.token}`, 'Content-Type':'application/json'};
  const uuid = cfg.serverUuids?.[0];
  const checks = [['账户认证','/api/account']];
  if (uuid) {
    const server = `/api/server/${encodeURIComponent(uuid)}`;
    checks.push(['服务器详情',server], ['实时状态',server+'?state=true']);
  }
  const result = [];
  for (const [name,path] of checks) {
    try {
      await readGreenCloud(cfg,path,headers);
      result.push({test:name,httpStatus:200,message:'请求成功（敏感响应内容未显示）'});
    } catch (e) {
      result.push({test:name,httpStatus:e.httpStatus||0,message:String(e.message||e).slice(0,260)});
      if (name==='账户认证' || e.httpStatus===429) break;
    }
  }
  if (!uuid && result[0]?.httpStatus===200) result.push({
    test:'服务器 UUID',httpStatus:0,message:'请配置服务器 UUID 后再检测资源访问权限'
  });
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
    const json = await readGreenCloud(cfg,`/api/server/${encodeURIComponent(uuid)}?state=true`,headers);
    return normalizeVirtFusionUserServer(json,cfg,uuid);
  }));
}
