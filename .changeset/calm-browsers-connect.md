---
"@ant-chat/shared": minor
"@ant-chat/backend": minor
"ant-chat": minor
---

新增 agent-browser 工具与运行时集成。浏览器按 conversation 隔离 daemon、profile 和 session，并在多个 turn 间复用；runner 优先使用系统 PATH 中的外部 CLI，未找到时回退到 npx，并缓存发现结果，不随应用绑定 agent-browser 版本；补充受控页面读取能力，禁止通过 Bash 绕过浏览器工具。
