---
"@ant-chat/web": patch
"@ant-chat/backend": patch
"@ant-chat/shared": patch
---

AI 服务商设置优化：添加模型弹窗新增"推理强度"档位配置（reasoningLevels），布局改为两列紧凑排布并加宽弹窗，关闭时清空表单；移除"默认temperature"字段（保存默认 0.7）。添加服务商弹窗移除"产品集成"选择，统一按 API Key 集成提交（订阅/OAuth 服务商为内置，不走此入口）。models.dev 同步不再把空 modalities 写入 capabilities；OutputModalitiesSchema 枚举扩展为与 models.dev 对齐（text/image/video/audio/pdf），避免同步含视频/音频输出模型后 settings 校验失败。
