---
"@ant-chat/backend": patch
"@ant-chat/shared": patch
"@ant-chat/desktop": patch
---

修复打包版 macOS 桌面端浏览器工具找不到 agent-browser CLI 的问题：打包版 GUI 由 launchd 启动，进程 PATH 不含用户 shell 注入的目录（nvm/homebrew 等），浏览器工具解析外部 CLI 时未使用与 execute_command 相同的合并 PATH。现在宿主注入的 commandEnvironment（login shell PATH + 应用自带目录）会透传到浏览器工具的命令解析与子进程环境，打包版也能找到全局安装的 agent-browser；同时 browserRunner 测试改为不依赖真实 node bin 目录，避免被全局安装的 agent-browser 干扰。
