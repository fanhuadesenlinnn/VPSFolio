import {normalizeKiwi, normalizeVirtFusionServers, applyVirtFusionTraffic, normalizeVirtFusionUserServer, validateConfig} from './core.js';
async function readJson(url, headers = {}) {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, {method:'GET', headers:{Accept:'application/json', ...headers}, credentials:'omit', cache:'no-store', redirect:'error', signal:ctl.signal});
    if (!res.ok) {
      const msg = res.status === 401 ? '：Token 无效或过期' : res.status === 403 ? '：当前 Token 无权限访问该 API；确认使用普通用户 API 而非 /api/v1 管理接口' : '';
      throw Error(`HTTP ${res.status}${msg}`);
    }
    const text = await res.text();
    if (text.length > 2_000_000) throw Error('API 响应过大');
    try { return JSON.parse(text); } catch { throw Error('API 未返回 JSON，请检查接口路径'); }
  } finally { clearTimeout(timeout); }
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
