---
'ant-chat': minor
'@ant-chat/desktop': patch
'@ant-chat/backend': patch
'@ant-chat/web': patch
'@ant-chat/shared': patch
---

支持工作区技能（`.agents/skills`）：工作区目录内的技能存在即启用、免安装管理，同名时覆盖全局技能，随工作区切换。

- Turn 技能可见性与 `use_skill` 读取按来源（全局/工作区）分别解析；自动化 `allowedSkills` 与受信路径同样支持工作区技能（backend）。
- Sender 的 `/` 技能面板与发送链路的已知技能解析均合并工作区技能，同名工作区版本优先（web）。
- 新增 `skills.listWorkspaceSkills` RPC、`SkillReader.listWorkspaceSkills` / `readWorkspaceSkillMarkdown` 接口，`SkillSource` 新增 `workspace`（shared）。
- 安全：realpath 校验防 symlink 逃逸、跳过隐藏与构建目录、名称白名单、扫描深度上限 4。
