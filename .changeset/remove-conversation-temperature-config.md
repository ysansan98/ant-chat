---
"ant-chat": minor
"@ant-chat/desktop": minor
---

移除会话级 `temperature` 与 `maxOutputTokens` 配置：模型参数设置面板不再提供这两个滑块，调用模型时不再透传这两个参数，交厂商默认；上下文压缩摘要的内部 token 预算与提供商模型目录的对应字段保留。
