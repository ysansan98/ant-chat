---
'@ant-chat/desktop': patch
'@ant-chat/backend': patch
---

修复 Ctrl+C 退出开发环境时的错误日志与应用残留

- 移除 Electron 主进程中不生效的 `process.on('SIGINT'/'SIGTERM'/'SIGHUP')` 处理器（Electron 40 中 Node 信号处理器不会执行，Chromium 会将信号转换为应用退出序列）
- 退出序列增加兜底超时：renderer 被信号销毁导致窗口关闭握手挂起时强制退出，避免应用残留
- MCP 传输层主动关闭（dispose/删除）时 `onclose` 降级为 info，不再误报 error
- 应用退出过程中的 Runtime RPC 失败不再记 error 日志（关闭流程预期噪音）
- 新增窗口首次加载耗时统计日志（主窗口与设置窗口首次加载完成时记录）
- 优化开发环境首次加载白屏（约 4 秒 → 约 1.9 秒）：
  - Vite `optimizeDeps` 预构建 `@ant-chat/shared` 与 `@workspace/ui` 子路径模块（含 `.tsx` 扩展声明）
  - `@workspace/ui` 补充根入口 `src/index.ts` 与 package.json `exports["."]`
  - dev server 启动时 warmup 预热首屏模块（`server.warmup`）
