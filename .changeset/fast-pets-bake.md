---
"ant-chat": minor
"@ant-chat/desktop": minor
---

统一 execute_command 并拆分 Bash/Windows 命令适配器。将 bash 工具重命名为 execute_command，新增启动期命令宿主探测（Windows 按 pwsh → powershell → cmd 优先级），引入命令风险三级分类和跨平台底线保护，权限规则和自动化配置同步迁移。