---
'ant-chat': patch
'@ant-chat/desktop': patch
---

服务商模型列表支持过滤与批量启停：新增按模型名称/ID 搜索、全选 checkbox（作用于当前筛选结果，一次落盘）与行内启停开关；模型名称后展示能力标签（工具调用、推理、图片、PDF、视频、音频）。配套新增 `provider.setModelsEnabledStatus` 批量 RPC，避免逐个模型重复写设置文件。
