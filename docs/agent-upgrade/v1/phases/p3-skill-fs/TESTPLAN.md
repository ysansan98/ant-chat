# P3 测试计划：Skill FS-first

### TC-P3-1：合法 skill 导入

- 对应验收：AC-P3-1
- 步骤：导入包含合法 `skill.sh metadata --json` 的 skill。
- 期望：导入成功，写入 `.ant/skills/<name>/` 或配置索引。

### TC-P3-2：非法 metadata 拒绝

- 对应验收：AC-P3-2
- 步骤：导入 metadata 缺失或格式错误的 skill。
- 期望：导入失败并显示原因。

### TC-P3-3：导入后可列出

- 对应验收：AC-P3-3
- 步骤：导入 skill 后查询 skill 列表。
- 期望：skill 可见。

### TC-P3-4：Agent 调用 skill

- 对应验收：AC-P3-4
- 步骤：触发一个需要该 skill 的复杂任务，让模型先调用 `use_skill` 或对应 `skill_<name>` 工具。
- 期望：Agent task 能读取 `SKILL.md`，后续 planning prompt 带有已载入 Skill 说明，并继续调用 native tools 完成任务。

### TC-P3-5：skill 执行边界

- 对应验收：AC-P3-5
- 步骤：构造超时、越权路径、超大输出的 skill。
- 期望：受工作区、超时和输出限制约束。

### TC-P3-6：内置 skill-installer

- 对应验收：AC-P3-1、AC-P3-3、AC-P3-4
- 步骤：启动应用后查看 Skill 列表，并通过 Agent 调用 `install_skill_from_github` 安装 GitHub Skill。
- 期望：`skill-installer` 默认存在且不可删除，GitHub Skill 安装到 `~/.ant-chat/skills` 后可在设置页看到。
