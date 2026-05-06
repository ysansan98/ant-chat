# P5：设置独立窗口

## 目标

- 设置页从主窗口路由中剥离为独立 Electron Window。

## 范围

- 设置入口。
- `openSettingsWindow()`。
- 设置窗口生命周期。
- 设置保存后通知主窗口刷新。
- 模型、服务商、MCP、Skills、工作区、Agent 模式配置入口。

## 交付物

- 独立 Settings Window。
- settings IPC。
- 主窗口设置入口。

## 实现要点

### Settings IPC

新增或调整 `src/main/domains/settings/ipc.ts`。

建议方法：

- `openSettingsWindow()`
- `getSettings()`
- `updateSettings(patch)`

Renderer 事件：

```ts
'settings:updated': [
  {
    keys: string[]
  }
]
```

### 窗口行为

- 主窗口只保留设置入口。
- 重复打开设置时聚焦已有窗口。
- 设置窗口关闭不影响主窗口。
- 设置保存统一走主进程 settings service，再广播 `settings:updated`。

## 验收标准

- AC-P5-1：点击设置入口打开独立窗口。
- AC-P5-2：重复点击不会创建多个重复设置窗口。
- AC-P5-3：设置保存后主窗口收到 `settings:updated`。
- AC-P5-4：关闭设置窗口不影响主窗口聊天。
- AC-P5-5：设置窗口可管理 Agent 模式、工作区、Skill 相关配置。

## 测试

见 [TESTPLAN.md](./TESTPLAN.md)。
