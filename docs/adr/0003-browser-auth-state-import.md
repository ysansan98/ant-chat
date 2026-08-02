# ADR-0003：浏览器登录态导入与 Browser 身份运行时

## 背景

Browser 工具原来只使用应用自己的空 Profile，用户在本地 Chrome、Edge、Chromium 或 Brave 中已经建立的登录状态无法复用。直接复制 Chromium Cookies 数据库不可靠：加密数据可能绑定操作系统、用户和浏览器进程，且会把密码、历史和扩展带入应用边界。

## 决策

- 设置页自动发现已知 Chromium 浏览器的 Profile，并在桌面端提供原生目录选择器。
- 首版只通过源浏览器 CDP 和 `agent-browser state save` 导入 cookies、localStorage、sessionStorage 等认证状态；关闭源浏览器时由源浏览器自身以受控 CDP 进程打开原 Profile，绝不复制 Cookies 数据库。不导入密码、历史、扩展、完整 Profile、IndexedDB 或 Service Worker。
- 导入状态保存在 App Runtime 数据根目录的 `browser/` 下。认证状态文件由 `agent-browser` 使用 Keychain 中的密钥加密，元数据与状态文件采用临时文件和原子替换；导入失败保留旧状态。
- Browser Runner 只从内部 `BrowserAuthStateProvider` 注入 `AGENT_BROWSER_STATE` 和 `AGENT_BROWSER_ENCRYPTION_KEY`。模型输入不能传递 `--state`、`--auto-connect`、`--user-data-dir` 等参数。
- 每个 Browser 会话捕获创建 Turn 时的认证状态 generation。导入不会中断当前 Turn，新 Turn 使用新 generation，旧会话在关闭或 Runtime 释放时清理。
- 系统原始 Chrome Profile 仍是 `outside`，自动化拒绝；应用托管认证状态随 Browser 的 `external` 访问使用，仍受 `allowBrowser` 与 Browser hostname 规则约束。

## 非目标

- 不写回、删除或锁定用户的源浏览器 Profile。
- 不把认证状态、密钥、Cookie、Token 或本地路径通过 RPC 返回给前端或模型。
- 不改变 Browser 能力默认关闭的自动化权限模型。
