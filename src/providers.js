import {normalizeKiwi, normalizeVirtFusionServers, applyVirtFusionTraffic, validateConfig} from './core.js';
async function readJson(url, headers = {}) {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, {method:'GET', headers:{Accept:'application/json', ...headers}, credentials:'omit', cache:'no-store', redirect:'error', signal:ctl.signal});
    if (!res.ok) throw Error(`HTTP ${res.status}${res.status===401||res.status===403 ? '：API 权限不足或 Key 错误' : ''}`);
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
  const headers = {Authorization:`Bearer ${cfg.token}`};
  const listUrl = cfg.origin + cfg.listPath;
  const list = await readJson(listUrl,headers);
  const servers = normalizeVirtFusionServers(list,cfg.label);
  return Promise.all(servers.map(async s => {
    const path = cfg.trafficPath.replace('{id}', encodeURIComponent(s.id));
    try { return applyVirtFusionTraffic(s,await readJson(cfg.origin+path,headers)); }
    catch (e) { return {...s,error:`流量获取失败：${e.message}`}; }
  }));
}
