---
name: ant-chat-manager
description: Manage Ant Chat settings, AI providers, MCP servers, and automations. Use when the user asks to switch themes or models, change proxy settings, configure providers or API keys, manage MCP servers, or query, create, and delete automations.
---

# Ant Chat 管理

使用 `ant_chat` 工具管理应用。修改前查询当前状态，操作后再次查询验证结果。不要直接编辑设置文件或数据库。

## 安全规则

- Provider API Key 必须先通过 `requestSecret` 收集。
- 将 `requestSecret` 返回的完整 `SecretRef` 对象放入 `secretRef`，不要只传 `id`。
- 不要要求用户在聊天中粘贴 API Key、Token 或密码。
- MCP 凭据也必须通过 `requestSecret` 收集，并把完整 `SecretRef` 直接放到对应的 `env` 或 `headers` 值中。工具只在执行前解析引用，最终仍按普通配置明文保存；执行前明确告知用户这一点，不要声称它们存入 Keychain。
- 删除 Provider、MCP 或自动化前说明影响，交由系统审批。

## 设置

查看设置：

```text
{ "type": "settings", "action": "show" }
```

切换模式和主题：

```text
{
  "type": "settings",
  "action": "theme:set",
  "mode": "dark",
  "lightThemeId": "cursor",
  "darkThemeId": "cursor"
}
```

设置助理模型前，先查询 Provider 和模型，确认二者均已启用：

```text
{
  "type": "settings",
  "action": "assistant:set",
  "providerId": "provider-id",
  "modelId": "model-id"
}
```

设置或测试代理：

```text
{ "type": "settings", "action": "proxy:set", "mode": "manual", "url": "http://127.0.0.1:7890" }
{ "type": "settings", "action": "proxy:test" }
```

## AI 服务商

常用查询：

```text
{ "type": "provider", "action": "list" }
{ "type": "provider", "action": "get", "id": "provider-id" }
{ "type": "provider", "action": "models", "id": "provider-id" }
```

创建、修改和启停：

```text
{
  "type": "provider",
  "action": "create",
  "name": "My Provider",
  "baseUrl": "https://api.example.com/v1",
  "apiMode": "openai",
  "isEnabled": true
}
{ "type": "provider", "action": "update", "id": "provider-id", "name": "新名称" }
{ "type": "provider", "action": "enable", "id": "provider-id" }
{ "type": "provider", "action": "disable", "id": "provider-id" }
```

配置 API Key：

1. 调用 `requestSecret`。
2. 将返回的完整引用传给 `secretRef`。
3. 设置后查询 Provider，确认 `hasApiKey` 为 `true`。

```text
{
  "type": "provider",
  "action": "key:set",
  "id": "provider-id",
  "secretRef": {
    "kind": "secret_ref",
    "id": "turn:task-id:secret-id",
    "scope": "turn"
  }
}
```

清除或删除：

```text
{ "type": "provider", "action": "key:clear", "id": "provider-id" }
{ "type": "provider", "action": "delete", "id": "provider-id" }
```

## MCP

查询：

```text
{ "type": "mcp", "action": "list" }
{ "type": "mcp", "action": "get", "name": "server-name" }
```

安装 stdio MCP：

```text
{
  "type": "mcp",
  "action": "install",
  "serverName": "filesystem",
  "transportType": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
}
```

安装 SSE MCP。先告知用户 `headers` 最终会明文保存，再用 `requestSecret` 收集完整的 Authorization 值，并把返回的引用直接作为字段值：

```text
{
  "type": "mcp",
  "action": "install",
  "serverName": "remote",
  "transportType": "sse",
  "url": "https://example.com/sse",
  "headers": {
    "Authorization": {
      "kind": "secret_ref",
      "id": "turn:task-id:secret-id",
      "scope": "turn"
    }
  }
}
```

stdio `env` 中的 Token 或密码使用相同方式录入。不要在聊天或工具参数中写明文凭据；SecretRef 只保护录入链路，不改变 MCP 配置的明文持久化方式。

编辑、启停和删除：

```text
{ "type": "mcp", "action": "edit", "serverName": "filesystem", "description": "新说明" }
{ "type": "mcp", "action": "start", "name": "filesystem" }
{ "type": "mcp", "action": "stop", "name": "filesystem" }
{ "type": "mcp", "action": "delete", "name": "filesystem" }
```

安装或重连失败时，配置仍可能已经保存。根据返回的 `status` 和 `error` 明确报告部分成功。

## 自动化

查询定义和运行记录：

```text
{ "type": "automation", "action": "list" }
{ "type": "automation", "action": "get", "id": "automation-id" }
{ "type": "automation", "action": "runs", "id": "automation-id" }
```

创建前验证工作区、Provider、模型、Skill 和 MCP 均存在：

```json
{
  "type": "automation",
  "action": "create",
  "name": "工作日报",
  "prompt": "生成今天的工作日报",
  "workspacePath": "/workspace",
  "providerId": "provider-id",
  "modelId": "model-id",
  "schedule": {
    "type": "cron",
    "expression": "0 9 * * 1-5",
    "timezone": "Asia/Shanghai"
  },
  "selectedSkills": [],
  "selectedMcpServers": [],
  "enabled": true
}
```

删除存在活跃运行的自动化时，先报告影响；仅在用户确认后设置 `force`：

```text
{ "type": "automation", "action": "delete", "id": "automation-id" }
{ "type": "automation", "action": "delete", "id": "automation-id", "force": true }
```
