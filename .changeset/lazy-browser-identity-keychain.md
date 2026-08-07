---
"@ant-chat/backend": patch
"@ant-chat/shared": patch
---

浏览器身份改为惰性加载：应用启动不再预热读取钥匙串中的 Cookie 加密密钥，只有真正执行浏览器工具或打开浏览器设置页时才访问钥匙串；首次执行浏览器工具前会补读 Turn 创建时的空快照。同时移除旧版 settings.json 明文 API Key 的启动迁移，明文 apiKey 不再是合法持久化状态，凭据只通过 apiKeySecretId 引用 Keychain。

浏览器托管会话不再创建或使用独立 profile 目录：命令不再传 `--profile`，依赖 agent-browser 的 `--session` 临时隔离实例，会话关闭即失效、磁盘不保留登录态；显式系统 Chrome Profile 能力保留。`browser_navigate` 新增 `injectCookies` 参数（默认 true），agent 可显式关闭托管 Cookies 注入，以未登录状态访问页面。
