---
"@ant-chat/shared": patch
"@ant-chat/backend": patch
"@ant-chat/web": patch
"@ant-chat/control-client": patch
---

为 MCP server 增加启用/禁用开关：禁用后不再随应用启动自动连接并立即停止；MCP 配置页回填真实连接状态，不再误显示为已停止。
MCP 配置页改为左右分栏：左侧服务器列表、右侧展示选中服务器的工具列表，并移除 MCP server 的 icon 字段。
修复 MCP OAuth server 认证失效后无法重新授权的问题：McpModule 现在会把回调地址注入连接管理器，
401 或 refresh token 失效时自动清除旧凭据并重新发起浏览器授权，而不是直接报 Unauthorized。
应用启动的自动连接不再弹交互式 OAuth 授权窗口：需要重新授权时保持未运行，
由用户在 MCP 设置页点击启动按钮时再发起授权。
