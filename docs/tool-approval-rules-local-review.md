# 工具权限规则本地实现复审

## 范围

- 基线：`HEAD`（`92868ce7`）
- 对象：当前完整工作区，包括 staged、unstaged 和 untracked 文件
- 规格：
  - `docs/adr/0001-tool-approval-rules.md`
  - `docs/adr/agent-tool-permission-architecture.md`
- 复审日期：2026-07-26

## 结论

上一轮识别的权限语义问题已按真实 owner 收口。权限文件读取失败的 fail-closed 实现复审确认有效，并补齐了基础策略原本为 `allow` 的交互与 Automation 回归测试。

## 已处理项

### 1. 权限文件读取失败 fail-closed

`toolAuthorization` 读取权限规则失败时：

- 交互 Turn：基础 `allow` 降级为 `require_approval`；
- Automation：基础 `allow` 降级为 `block`；
- 失败原因写入独立 Policy span。

损坏文件仍由 `PermissionsFileStore` 隔离并原子恢复为空文件，但存储恢复不会被误认为“已验证不存在 deny 规则”。

### 2. Bash 完整命令一次执行

`parseBashCommand()` 仍按引号外的 `&&` 生成 segments，供 scope、硬阻断、只读判定和权限规则匹配使用。segments 不再是执行计划。

`runPreparedBashTool()` 把 LLM 提交的完整原始命令一次交给受控 shell：

```ts
spawn(originalCommand, {
  cwd,
  shell: true,
  env: controlledEnvironment,
})
```

因此 `git status && node script.js` 只启动一个 shell，不再拆成两次 `spawn(shell: false)`。短路、shell builtin、`cd`、环境状态、输出顺序和 timeout 都由同一个 shell 负责。

非法 `&&`（前置、后置或连续空段）会作为无效输入拒绝，不再静默改写。

当前 parser 无法可靠抽取子 shell、命令替换、动态变量展开、命令名引号拼接或 glob、分组、控制结构和未引用反斜杠中的全部 command node，因此这些结构直接硬阻断；简单管道、重定向和分号仍可在单次审批后原样执行。

### 3. 删除通用 env，建立 Bash SecretRef 专用通道

公开 Bash 合同删除 `env`，改为：

```ts
secretEnv?: Record<string, SecretRef>
```

约束：

- 只接受当前 Turn 的 SecretRef；
- SecretStore 按当前 runId 校验引用归属，拒绝其他并发 Turn 的临时引用；
- 拒绝普通字符串和 persistent SecretRef；
- 环境变量名必须合法；
- 明确拒绝 `PATH`；
- 旧 `env` 输入直接返回校验错误，不提供兼容旁路。
- 命令文本中的 `NAME=value command` 与 `env NAME=value command` 同样硬阻断，不能绕回通用环境通道。

SecretRef 只在权限放行后的 Bash owner 内解析并注入子进程。`ToolRegistry` 不再递归解析任意工具、任意字段中的 SecretRef，因此秘密不能被注入 command、cwd、文件路径或 MCP 参数。Bash 在结果离开模块前脱敏解析出的真实秘密。

带 `secretEnv` 或复杂 shell 语法的调用：

- deny 规则仍优先匹配；
- 不能命中已有 allow 规则；
- 不生成持久规则候选；
- 交互 Turn 只能单次审批；
- Automation 因没有人工审批而阻断。

### 4. 其余审查项

- 工作区与权限分组删除采用应用层补偿事务；权限清理失败时不删除工作区，工作区删除失败时恢复权限快照。
- 审批重建错误改为中文。
- 后端拒绝“空 argvPrefix + allowRemainingArgs + wholeExecutable=false”的伪造组合。
- 多段 Bash 审批只展示尚未被 allow 规则覆盖的 segments。
- 权限页目录规则复用目录选择器，目录路径不再依赖手工输入。
- Policy Trace 记录本次共同覆盖命令的全部稳定 rule ID、类型、effect 和所属分组；前端 Trace 已消费 `permissionRules`，不再读取旧 whitelist 字段。

## 验证面

- Bash：单 shell 状态、完整 timeout、短路、非法 `&&`、SecretRef 注入与脱敏。
- Policy：deny 优先、复杂语法/secretEnv 单次审批、部分 segment 候选、多规则 Trace、权限读取失败 fail-closed。
- Runtime：伪造 whole-executable 选择、工作区删除补偿事务。
- Web：权限目录选择器、Trace permissionRules 展示。

最终检查结果以本次任务收尾时实际执行的命令为准。
