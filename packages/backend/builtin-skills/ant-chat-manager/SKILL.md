---
name: ant-chat-manager
description: Manage Ant Chat settings, AI providers, MCP servers, and automations through the ant-chat CLI. Use when the user asks to switch themes or models, change proxy settings, configure providers or API keys, manage MCP servers, or query, create, and delete automations.
---

# Ant Chat 管理

通过 `bash` 工具调用 `ant-chat` CLI 管理应用。修改前先查询当前状态，操作后再次查询验证结果。不要直接编辑设置文件或数据库。

所有查询命令加 `--json`，便于读取结构化结果。修改、删除、启动、停止等命令交由系统审批。

## 安全规则

- Provider API Key、MCP Token、密码必须先通过 `requestSecret` 收集。
- `requestSecret` 只返回 `SecretRef`。后续把当前 Turn 的 `SecretRef` 放进 `bash.secretEnv`，不要放进命令文本。
- Provider API Key 使用环境变量 `ANT_CHAT_PROVIDER_API_KEY` 传给 CLI。
- MCP `env` 和 `headers` 最终按普通配置明文保存。执行前明确告知用户这一点，不要声称它们存入 Keychain。
- MCP 敏感字段通过 `--env-from-env` 或 `--headers-from-env` 从环境变量读取。
- 不要要求用户在聊天中粘贴 API Key、Token 或密码。

## 设置

查看设置：

```bash
ant-chat settings show --json
```

切换模式和主题：

```bash
ant-chat settings theme set --mode=dark --theme=cursor --json
ant-chat settings theme set --light-theme=airbnb --dark-theme=cursor --json
```

设置助理模型前，先确认 Provider 和模型均已启用：

```bash
ant-chat provider list --json
ant-chat provider models provider-id --json
ant-chat settings assistant set --provider=provider-id --model=model-id --json
ant-chat settings show --json
```

设置或测试代理：

```bash
ant-chat settings proxy set --mode=manual --url=http://127.0.0.1:7890 --json
ant-chat settings proxy test --json
```

## AI 服务商

查询：

```bash
ant-chat provider list --json
ant-chat provider get provider-id --json
ant-chat provider models provider-id --json
```

创建、修改和启停：

```bash
ant-chat provider create --name="My Provider" --base-url=https://api.example.com/v1 --api-mode=openai --json
ant-chat provider update provider-id --name="New Name" --json
ant-chat provider enable provider-id --json
ant-chat provider disable provider-id --json
```

配置 API Key：

1. 调用 `requestSecret`，让用户在原生敏感输入框中输入 API Key。
2. 调用 `bash`，命令文本不包含密钥，`secretEnv.ANT_CHAT_PROVIDER_API_KEY` 使用上一步返回的 `SecretRef`。
3. 设置后查询 Provider，确认 `hasApiKey` 为 `true`。

```text
tool: bash
input:
  command: ant-chat provider key set provider-id --json
  secretEnv:
    ANT_CHAT_PROVIDER_API_KEY: <SecretRef>
```

清除或删除：

```bash
ant-chat provider key clear provider-id --json
ant-chat provider delete provider-id --json
```

## MCP

查询：

```bash
ant-chat mcp list --json
ant-chat mcp get server-name --json
```

安装 stdio MCP：

```bash
ant-chat mcp install --name=filesystem --command=npx --args="-y @modelcontextprotocol/server-filesystem /workspace" --json
```

安装 SSE MCP。若 Authorization 是敏感值，先说明它最终会明文保存，再用 `requestSecret` 收集完整 header 值：

```text
tool: bash
input:
  command: ant-chat mcp install --name=remote --transport-type=sse --url=https://example.com/mcp --headers-from-env=Authorization=ANT_CHAT_MCP_AUTHORIZATION --json
  secretEnv:
    ANT_CHAT_MCP_AUTHORIZATION: <SecretRef>
```

stdio `env` 中的 Token 或密码使用同样方式：

```text
tool: bash
input:
  command: ant-chat mcp install --name=demo --command=npx --args="-y demo-server" --env-from-env=API_KEY=ANT_CHAT_MCP_API_KEY --json
  secretEnv:
    ANT_CHAT_MCP_API_KEY: <SecretRef>
```

编辑、启停和删除：

```bash
ant-chat mcp edit filesystem --description="New description" --json
ant-chat mcp start filesystem --json
ant-chat mcp stop filesystem --json
ant-chat mcp delete filesystem --json
```

安装或重连失败时，配置仍可能已经保存。根据返回的 `status` 和 `error` 明确报告部分成功。

## 自动化

查询定义和运行记录：

```bash
ant-chat automation list --json
ant-chat automation get automation-id --json
ant-chat automation runs automation-id --json
```

创建前验证工作区、Provider、模型、Skill 和 MCP 均存在：

```bash
ant-chat automation create --name="工作日报" --prompt="生成今天的工作日报" --workspace-path=/workspace --provider-id=provider-id --model-id=model-id --schedule-type=cron --expression="0 9 * * 1-5" --timezone=Asia/Shanghai --json
```

删除存在活跃运行的自动化时，先报告影响；仅在用户确认后设置 `--force=true`：

```bash
ant-chat automation delete automation-id --json
ant-chat automation delete automation-id --force=true --json
```
