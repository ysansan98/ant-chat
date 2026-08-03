# ADR-0003：浏览器 Cookies 导入与 Browser 身份运行时

## 背景

Browser 工具使用应用自己的 Profile。用户在本机 Chrome、Edge、Chromium 或 Brave 中已经建立的登录状态无法直接复用。

## 决策

- 设置页自动发现已知 Chromium 浏览器的 Profile，并在桌面端提供原生目录选择器。
- 首版只导入 Cookies。导入器直接读取源 Profile 的 `Cookies` 或 `Network/Cookies` SQLite 数据库，用 macOS Keychain 中对应浏览器的 Safe Storage 密钥解密 v10/v11 Cookie；不启动源浏览器、不连接 CDP、不执行 `agent-browser state save`。
- 数据库只复制到权限为 `0700` 的临时目录，读取完成后删除数据库、WAL、SHM 和临时明文文件。源浏览器即使已经卸载，只要 Profile 和 Keychain 仍然存在，也可以导入。
- 应用使用自己的 Keychain 密钥，以 AES-256-GCM 加密保存 Cookies。`identity.json` 保存浏览器类型、Profile 名称、来源标识、时间、generation 以及仅供主进程更新导入使用的源目录定位信息；这些路径不会通过 RPC 返回。Cookies 文件及 generation 快照使用 `0600` 权限。导入事务失败时保留旧 Cookies 和旧来源记录。
- Browser Runner 在每个新 generation 的应用 Profile 中按目标页面域名懒启动 agent-browser 的 batch 会话，只把匹配当前目标域名的 Cookies 使用完整属性写入应用 Profile；后续导航到新域名时继续按需注入。模型输入仍不能传递 `--state` 或其他内部参数。这样保留 domain、path、SameSite、Secure、HttpOnly 和过期时间，不依赖只支持 `name/value` 的 `--curl` JSON 形状，也不产生明文状态文件。
- 每个 Browser 会话捕获创建 Turn 时的 Cookies generation。导入不会中断当前 Turn；新 Turn 使用新 generation，旧会话和旧 Profile 延迟清理，不会被新 Cookies 覆盖。
- 模型输入仍不能传递 `--state`、`--auto-connect`、`--user-data-dir` 等参数。显式系统 Chrome Profile 仍是 `outside`，自动化拒绝且不会混入应用 Cookies；普通 Browser 网页仍是 `external`，受 `allowBrowser` 和 hostname 规则约束。

## 非目标

- 不导入密码、历史记录、扩展、localStorage、sessionStorage、IndexedDB 或 Service Worker。
- 不写回、删除、锁定或替换用户的源浏览器 Profile。
- 不把 Cookie、密钥、Token、源路径或 Cookies 文件内容通过 RPC 返回给前端或模型。
- 不改变 Browser 能力默认关闭的自动化权限模型。
- 当前实现只支持 macOS 的 Chromium Safe Storage 解密；其他平台返回明确的不支持错误，后续单独适配平台加密方案。
