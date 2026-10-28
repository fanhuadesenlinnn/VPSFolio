// Pure data model, validation and provider adapters. No credentials are logged.
export const VERSION = 1;
const enc = new TextEncoder();
const dec = new TextDecoder();
const bytes = n => Array.from(crypto.getRandomValues(new Uint8Array(n)));
const obj = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
const list = x => Array.isArray(x) ? x : [];
const number = x => (x === '' || x == null || !Number.isFinite(Number(x))) ? null : Number(x);
export function bytesText(x) {
  if (x === null || !Number.isFinite(x)) return '—';
  if (x < 1024) return `${Math.round(x)} B`;
  const n = Math.min(4, Math.floor(Math.log(x) / Math.log(1024)));
  return `${(x / 1024 ** n).toFixed(2)} ${['B','GiB','TiB','PiB','EiB'][n]}`;
}
export function percent(used, quota) {
  return used != null && quota != null && quota > 0 ? Math.round(1000 * used / quota) / 10 : null;
}
export function validateConfig(c) {
  if (!c || !['virtfusion', 'kiwivm'].includes(c.provider)) throw Error('不支持的服务商');
  if (!String(c.label || '').trim()) throw Error('请输入账户名称');
  if (!String(c.token || '').trim()) throw Error('请输入 API Key');
  if (c.provider === 'kiwivm' && !/^\d+$/.test(String(c.veid || ''))) throw Error('搬瓦工 VEID 必须为数字');
  if (c.provider === 'virtfusion') {
    if (c.origin !== 'https://cp.green.cloud') throw Error('当前 GreenCloud 仅允许 cp.green.cloud 域名');
    for (const path of [c.listPath, c.trafficPath]) {
      if (!/^\/(?!\/)[\w/{}.-]+$/.test(String(path || '')) || path.includes('..')) throw Error('API 路径须为安全的站内绝对路径');
    }
    if (!c.trafficPath.includes('{id}')) throw Error('流量接口路径需要包含 {id}');
  }
}
export async function encryptVault(data, passphrase) {
  if (!passphrase || passphrase.length < 10) throw Error('加密口令至少 10 个字符');
  const salt = bytes(16), iv = bytes(12);
  const key = await derive(passphrase, salt);
  const plain = enc.encode(JSON.stringify({version: VERSION, accounts: list(data.accounts), threshold: data.threshold ?? 80}));
  const buffer = await crypto.subtle.encrypt({name:'AES-GCM', iv:new Uint8Array(iv)}, key, plain);
  return {format:'vpsfolio-vault', version:VERSION, kdf:'PBKDF2-SHA256', rounds:250000, salt, iv, ciphertext:Array.from(new Uint8Array(buffer))};
}
async function derive(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt:new Uint8Array(salt), iterations:250000, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
export async function decryptVault(vault, passphrase) {
  if (!vault || vault.format !== 'vpsfolio-vault' || vault.version !== VERSION || vault.rounds !== 250000) throw Error('不支持的备份格式');
  for (const [name, size] of [['salt',16], ['iv',12]]) if (!Array.isArray(vault[name]) || vault[name].length !== size || vault[name].some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw Error('加密元数据格式不合法');
  if (!Array.isArray(vault.ciphertext) || vault.ciphertext.length > 5_000_000) throw Error('加密数据不合法或过大');
  try {
    const key = await derive(passphrase, vault.salt);
    const result = await crypto.subtle.decrypt({name:'AES-GCM', iv:new Uint8Array(vault.iv)}, key, new Uint8Array(vault.ciphertext));
    const data = JSON.parse(dec.decode(result));
    if (data.version !== VERSION || !Array.isArray(data.accounts)) throw Error('不兼容的配置');
    data.accounts.forEach(validateConfig);
    return data;
  } catch { throw Error('口令错误或备份数据已损坏'); }
}
export function unwrapItems(json) {
  if (Array.isArray(json)) return json;
  const v = obj(json);
  return [v.data, v.servers, v.results, v.items, obj(v.data).servers, obj(v.data).items].find(Array.isArray) || [];
}
function serverId(s) { return String(s.id ?? s.serverId ?? s.uuid ?? s.server_id ?? '').trim(); }
export function normalizeVirtFusionServers(json, label) {
  const rows = unwrapItems(json);
  if (!rows.length && !(Array.isArray(json) || Array.isArray(json?.data) || Array.isArray(json?.servers))) {
    throw Error('服务器接口返回结构未识别，请对照 VirtFusion 用户 API 文档检查列表路径');
  }
  return rows.filter(x => serverId(x)).map(s => {
    const resources = obj(s.resources);
    const network = obj(s.network);
    const addr = list(s.ip_addresses || s.ipv4 || network.ipv4);
    const ip = [s.primaryIPv4, s.primary_ipv4, s.ip, s.ipAddress, addr[0]?.address, typeof addr[0] === 'string' ? addr[0] : null].find(Boolean) || null;
    return {id:serverId(s), provider:'virtfusion', label, name:String(s.name || s.hostname || `Server ${serverId(s)}`),
      ip:String(ip || ''), location:String(s.location?.name || s.location || s.hypervisor?.name || ''),
      status:String(s.state || s.status || (s.suspended ? 'suspended' : 'unknown')),
      cpu:number(resources.cpuCores ?? s.cpuCores), memory:number(resources.memory ?? s.memory),
      used:null, quota:null, reset:null, rx:null, tx:null, error:null};
  });
}
export function applyVirtFusionTraffic(s, json, now = Date.now()) {
  const data = obj(json?.data ?? json);
  const months = list(data.monthly || data.periods);
  const current = months.find(p => {
    const a = Date.parse(String(p.start || '')), b = Date.parse(String(p.end || ''));
    return Number.isFinite(a) && Number.isFinite(b) && a <= now && now <= b;
  }) || months[0];
  if (!current) {
    // Only parse when byte semantics are explicit and verifiable.
    const p = obj(obj(data.traffic).currentPeriod || data.currentPeriod);
    if (number(p.total) !== null && number(p.limitBytes) !== null) {
      return {...s, used:number(p.total), quota:number(p.limitBytes), rx:number(p.rx), tx:number(p.tx), reset:p.end || null};
    }
    return {...s, error:'流量响应结构不受支持；请检查用户 API 文档'};
  }
  const unit = number(data.trafficBytesPerGb) || 1000000000; // VirtFusion documented default decimal GB
  const blocks = list(current.blocks).reduce((sum,b) => sum + (number(b.traffic) || 0),0);
  const limitGb = number(current.limit);
  return {...s, rx:number(current.rx), tx:number(current.tx),
    used:number(current.total) ?? (number(current.rx) !== null && number(current.tx) !== null ? number(current.rx) + number(current.tx) : null),
    quota:limitGb === null || limitGb === 0 ? null : (limitGb+blocks)*unit,
    reset:current.end || null};
}
export function normalizeKiwi(json, cfg) {
  if (json?.error && Number(json.error) !== 0) throw Error(String(json.message || 'KiwiVM API 请求失败').slice(0,180));
  const multiplier = number(json.monthly_data_multiplier) || 1;
  const rawUsed = number(json.data_counter), rawQuota = number(json.plan_monthly_data);
  const ip = list(json.ip_addresses).find(a=>typeof a === 'string' && a.includes('.')) || '';
  const reset = number(json.data_next_reset);
  return {id:String(cfg.veid), provider:'kiwivm', label:cfg.label, name:String(json.hostname || cfg.label),
    ip, location:String(json.node_location || ''), status:json.suspended ? 'suspended' : 'active', cpu:null,
    memory:number(json.plan_ram), used:rawUsed == null ? null : rawUsed * multiplier,
    quota:rawQuota == null ? null : rawQuota * multiplier,
    reset:reset == null ? null : new Date(reset * 1000).toISOString(), rx:null,tx:null,error:null};
}
