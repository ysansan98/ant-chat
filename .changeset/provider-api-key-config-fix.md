---
'ant-chat': patch
'@ant-chat/desktop': patch
---

服务商 API Key 配置修复与体验调整：

- 修复失焦误删密钥：API Key 输入框在聚焦后失焦（含点击「显示密码」按钮导致的失焦）会提交空值，而后端把空 `apiKey` 视为"删除密钥"，导致已保存的 Key 被清掉。现在输入过程与失焦都不落盘，编辑后才出现「保存 / 取消」，Enter 保存、Esc 取消，清空后按钮显示「清除密钥」。
- 占位符明确显示「已配置，输入新 Key 可替换」/「未配置」，不再用 `••••••••` 表示状态；移除右侧「显示密码」入口，输入框始终掩码。
- `hasApiKey` 改为以 Keychain 中实际存在密钥为准：内置 Provider 预置的 `apiKeySecretId` 只表示密钥存放位置，此前被误当成"已配置"，导致从未配置过的服务商也显示已配置（`ant-chat provider list` 的 KEY 列同步修正）。
