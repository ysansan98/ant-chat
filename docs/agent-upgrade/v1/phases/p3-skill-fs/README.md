# P3：Skill FS-first

## 目标

- 在 Runtime 和 Tool Router 已稳定的基础上，接入本地 Skill。

## 范围

- `~/.ant-chat/skills` 目录。
- `skill.sh metadata --json`。
- `skill.sh run`。
- Skill 导入。
- Skill Tool Adapter。
- Skill 执行受工作区、超时、输出限制约束。

## 交付物

- Skill 管理能力。
- Skill 导入流程。
- Skill 执行适配器。

## 实现要点

### 文件结构

Skill 本体以文件系统为准，不入库。

```text
~/.ant-chat/skills/
  <skill-name>/
    SKILL.md
    skill.sh
    manifest.json
    templates/
~/.ant-chat/skills/.index.json
```

`.index.json` 可重建，只作为本地缓存。

### `skill.sh` 协议

- `skill.sh metadata --json`
- `skill.sh run --input '<json>' --context '<json>'`

导入流程：

1. 用户选择 `skill.sh`。
2. 校验可执行权限与 metadata。
3. 复制到 `~/.ant-chat/skills/<skill-name>/`。
4. 更新 `.index.json`。
5. Tool Router 立即可见。

### 上下文载入

Skill 不在启动时全文注入 system prompt。Runtime 只把已启用 Skill 的名称、描述和输入 schema 注册成工具。

Agent 需要某个 Skill 时先调用 `use_skill` 或对应的 `skill_<name>` 工具，工具读取 `SKILL.md` 并把完整说明作为 observation 返回。Runtime 会把已载入 Skill 内容记录在当前 task state 中，后续 planning prompt 会携带这些说明，避免 `trimLoopMessages` 裁剪后丢失上下文。

内置 `skill-installer` 作为 protected Skill 初始化到本地 Skill 目录，同时提供 `install_skill_from_github` 工具，安装目标固定为 `~/.ant-chat/skills`。

### Tool Adapter

Skill 作为 `AgentTool` 接入：

- `source = 'skill'`
- 风险等级由 metadata、输入和执行动作共同推断。
- 执行受工作区、超时、输出截断约束。

错误码：

- `AGENT_SKILL_INVALID`
- `AGENT_TOOL_EXEC_FAILED`
- `AGENT_POLICY_BLOCKED`

## 验收标准

- AC-P3-1：合法 `skill.sh` 可导入。
- AC-P3-2：非法 metadata 会被拒绝并提示原因。
- AC-P3-3：导入后 skill 可被列出。
- AC-P3-4：Agent task 可调用已导入 skill。
- AC-P3-5：skill 执行受工作区、超时和输出限制约束。

## 测试

见 [TESTPLAN.md](./TESTPLAN.md)。
