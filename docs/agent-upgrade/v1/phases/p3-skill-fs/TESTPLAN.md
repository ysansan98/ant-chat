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
- 步骤：触发一个需要该 skill 的复杂任务。
- 期望：Agent task 能调用 skill 并获得结果。

### TC-P3-5：skill 执行边界
- 对应验收：AC-P3-5
- 步骤：构造超时、越权路径、超大输出的 skill。
- 期望：受工作区、超时和输出限制约束。
