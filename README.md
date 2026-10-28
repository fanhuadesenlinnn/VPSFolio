# VPSFolio

**多服务商 VPS 流量聚合 Chrome 扩展**：GreenCloud VirtFusion + 搬瓦工 KiwiVM；本地 AES-256-GCM 加密、阈值通知、手动/每 15 分钟刷新、Google Drive 加密备份与恢复。

> v0.3.1：修复 v0.1.0 的 GreenCloud 403：原版错误调用管理员 `/api/v1/servers`；本版改为 VirtFusion 普通用户 API `GET /api/server/{UUID}?state=true`。已完成本地测试，真实账户联调仍需确认。

## 安装

1. 从 [GitHub Actions](../../actions/workflows/ci.yml) 最近一次成功的 `Build Chrome Extension` 任务，下载 `VPSFolio-Chrome-Extension` artifact（或运行 `npm run build`）。
2. 解压 `VPSFolio-Chrome-Extension.zip` 到固定目录。**不要直接将 ZIP 拖入扩展页面**。
3. Chrome 打开 `chrome://extensions`，开启开发者模式，点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的目录。
4. 点击工具栏图标，创建一个 **至少 10 字符**的保险库口令。点击「管理」进入完整配置页。

## 配置服务商

### 搬瓦工 (BandwagonHost / KiwiVM)

在 KiwiVM 控制面板的 API 页面取得 VEID 与该 VPS 的 API Key。进入插件添加 `搬瓦工 KiwiVM`，填写备注、Key、VEID。每台 VPS 分别添加。

官方 API `GET https://api.64clouds.com/v1/getServiceInfo?veid=...&api_key=...`，读取 `plan_monthly_data`、`data_counter`、`monthly_data_multiplier`、`data_next_reset`。**API Key 可能具有高权限，即使此插件只调用只读接口也请妥善保管。**

### GreenCloud (VirtFusion)

在 https://cp.green.cloud/account 创建**普通用户 API Key**，可查看账户文档 https://cp.green.cloud/account/api 。不要将管理员 API 与用户 API 混用。

1. 打开 GreenCloud VPS 管理页面 `https://cp.green.cloud/server/<UUID>`，复制最后的 UUID（不是 WHMCS 账单 ID）。
2. 添加 GreenCloud 账号时填写 Key 和服务器 UUID。多个 UUID 用逗号分隔。
3. **从旧版升级不用删除原有账户**：在「已添加账户」中点击「设置 UUID」并填写 UUID，之前加密保存的 Key 保留。
4. 可选填「配额 GB」（若 API 没有提供）。当前解析用户 API 的 `data.state.network.primary.traffic.rx/tx/total` 字节值；若缺少重置日期，则显示空值，不会编造。

参考第三方公开示例中的 `GET /api/server/{uuid}?state=true`。用户 API 返回的网络计数**未必等于计费周期已用流量**，应对照控制面板核实。仅使用 GET，不执行开关机、重装。

### API 诊断
若仍显示 401/403，请在「已添加账户」点击「诊断 API」：插件分别测试 `GET /api/server/{UUID}` 和 `GET /api/server/{UUID}?state=true`，显示 HTTP 状态码及脱敏的服务端错误原因。它不公开 Token、不进行管理操作。若需要更换已经暴露或过期的 Key，在对应账户的密码输入框输入新 Key，点击「替换密钥」即可保留现有 UUID 和设置。

注意：403 可能来自 Token 权限、UUID 关联或代理安全策略，不能根据单一状态码认定是管理员 API 调用。请将诊断文字（检查不含凭据后）用于后续定位，不要公开旧密钥。

### GreenCloud 官方 OpenAPI 文档核对（2026-10-28）

已从实际登录的 `https://cp.green.cloud/account/api#description/introduction` 页面读取终端用户 API：Base URL 为 `https://cp.green.cloud/api`，使用 `Authorization: Bearer <token>`，`Accept: application/json`，其中 `GET /api/account` 是官方已明确提供的账户请求。官方列明无效或过期 Token 返回 401、限流返回 429、服务不可用返回 503；服务器管理请求仅允许服务器所有者。

v0.3.1 的「诊断 API」首先请求 `GET /api/account`，确认密钥是否能完成普通用户认证；只有成功才测试服务器详情和实时状态。诊断不输出账户资料和 Token。**目前尚未读取 Server 分组展开后的全部官方请求和响应定义**，因此 `/api/server/{UUID}` 的查询及流量字段仍需与该分组核对，不能把前期第三方示例视为 GreenCloud 官方已验证接口。

## Google Drive 加密备份（一次性 OAuth 设置）

> 纯本地安装的 Chrome 扩展不能继承 ChatGPT 或 Tampermonkey 的 Google 认证，也不能直接使用别人的 OAuth Client ID。**必须创建自己的 Google Cloud OAuth 客户端**。在没有配置之前，本地导出/导入完全可用，云端按钮会给出明确错误。

1. 前往 [Google Cloud Console](https://console.cloud.google.com/apis/dashboard) 创建/选择项目，启用 **Google Drive API**，配置 OAuth consent screen，加入测试用户（如处于 Testing）。
2. 安装该扩展后在 `chrome://extensions` 复制 **扩展 ID**。在 Google Cloud 创建 OAuth 2.0 客户端，应用类型选 **Chrome Extension**，填写该扩展 ID，得到 `...apps.googleusercontent.com` Client ID。请不要创建 Client Secret 或提交任何 API Key。
3. 在 GitHub 仓库 Settings → Secrets and variables → Actions → **Variables** 中新增 `GOOGLE_OAUTH_CLIENT_ID`，值为上述 Client ID。重新运行 Actions 构建，下载安装带 OAuth Client ID 的 ZIP，并在**同一固定目录**替换文件后刷新扩展。OAuth 客户端必须和扩展 ID 匹配；如果扩展 ID 改变，需更新 OAuth 客户端并重新打包。
4. 在扩展中点击「备份至 Google Drive」，授权 **drive.appdata** 权限；恢复同理。

本应用使用 Google Drive 隐藏的 `appDataFolder`，文件名为 `vpsfolio-vault-v1.json`，只上传加密保险库 JSON。仅该 OAuth 应用可见，普通 Google Drive 文件列表中不显示。恢复会覆盖本地设置，需先确认并输入**备份原始口令**。不上传实时监控历史数据。备份中的密钥不会上传明文。

### 注意

- `chrome.storage.local` 存储 AES-GCM 密文；口令留在 `chrome.storage.session`，关闭浏览器会话后需重新解锁。
- 自动刷新依赖浏览器运行且保险库解锁；**不是无人值守 24/7 服务**。
- 只有在流量使用率跨越阈值时才发出通知；阈值默认 80%。
- 为保护 API Key，请勿把本地配置、API Key、带凭据的网络日志上传 GitHub。
- 此 MVP 没有云端自动备份；主动点击云端备份按钮进行同步。

## 开发与 CI

```bash
npm test
npm run build
npm run validate
```

无第三方运行时依赖，适合审计。构建产物：`dist/unpacked`（直接加载）和 `dist/VPSFolio-Chrome-Extension.zip`。所有到 `main` 的 push、PR、Tag 以及手动运行均触发 GitHub Actions：Node 单测 → ZIP 构建 → 包结构校验 → artifact 上传。

源码：`src/core.js`（归一化/加密）、`src/providers.js`（只读 API）、`src/drive.js`（Google Drive）、`src/background.js`（调度与消息）、`src/app.js`（界面）。新增服务商优先新增 Provider 适配器而不是在 UI 写抓取逻辑。

## 安全原则

- 扩展只拥有指定 API 域名与 Google Drive API 的 host permissions，不执行远程 JavaScript。
- 不支持重装、关机等改变服务器状态的 API。
- Key 使用浏览器本地 AES-256-GCM 加密，PBKDF2-SHA256 25 万轮；云端保存的只有密文。
- 所有服务商请求不携带浏览器 Cookie，且 `redirect:'error'`，避免在异常重定向中泄露凭据。
- 仅供个人/可信设备使用，浏览器本地遭恶意扩展或系统级入侵时仍可能泄露会话密钥。

## 资料

- [VirtFusion 6.1 终端用户 API 发布说明](https://docs.virtfusion.com/releases/v6/)
- [VirtFusion Global API 流量示例（非用户 API 承诺）](https://docs.virtfusion.com/api/getServerTraffic/)
- [KiwiVM API 介绍](https://github.com/dhslegen/bandwagon-dashboard/blob/main/Bandwagon%20Host%20REST%20API.md)
- [Google Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Chrome identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
