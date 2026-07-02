# Packages 模块合并执行计划

## 目标

将以下四个内部包合并为 `@ant-chat/backend` 的源码模块：

- `@ant-chat/agent-core` → `packages/backend/src/agent-core`
- `@ant-chat/agent-runtime` → `packages/backend/src/agent-runtime`
- `@ant-chat/app-data` → `packages/backend/src/data`
- `@ant-chat/mcp-client-hub` → `packages/backend/src/mcp`

保留独立包：

- `@ant-chat/backend`：后端运行时唯一入口
- `@ant-chat/shared`：Desktop、Web 和运行时共享协议
- `@ant-chat/local-server`：独立 CLI 和发布单元
- `@workspace/ui`：前端组件

## 执行步骤

### 1. 建立基线

- [x] 运行 `pnpm check` 和 `pnpm build`，确认合并前状态正常。
- [x] 记录 `@ant-chat/backend` 当前公开导出，合并过程中保持兼容。

### 2. 迁移源码和测试

按以下顺序迁移，每迁移一个模块就运行对应测试和类型检查：

- [x] `mcp-client-hub/src` → `backend/src/mcp`
- [x] `app-data/src` → `backend/src/data`
- [x] `agent-core/src` → `backend/src/agent-core`
- [x] `agent-runtime/src` → `backend/src/agent-runtime`
- [x] 将旧的 `@ant-chat/*` 跨包导入改为包内相对导入。

模块依赖保持单向：

```text
appRuntime ──→ agent-runtime ──→ agent-core
     │                 │
     ├──→ mcp          └──→ data
     └──→ data
```

`agent-core`、`data`、`mcp` 之间不得互相反向依赖。

### 3. 合并配置

- [x] 将四个旧包的依赖合并到 `packages/backend/package.json`。
- [x] 更新 `packages/backend/tsdown.config.ts`，移除对旧包的 external 配置。
- [x] 保留 `@ant-chat/backend` 和 `@ant-chat/backend/rpc-handlers` 两个公开入口。
- [x] 简化根目录 `build:packages`，移除四个旧包的独立构建命令。
- [x] 删除根 `tsconfig.json` 中四个旧包的项目引用。

### 4. 删除旧包

- [x] 删除 `packages/agent-core`。
- [x] 删除 `packages/agent-runtime`。
- [x] 删除 `packages/app-data`。
- [x] 删除 `packages/mcp-client-hub`。
- [x] 更新 lockfile 和 README 项目结构。
- [x] 使用 `rg` 确认源码、配置和文档中没有旧包引用。

### 5. 完整验证

- [x] 运行 `pnpm lint --fix`。
- [x] 运行 `pnpm check`。
- [x] 运行 `pnpm build`。
- [x] 验证 Desktop 能创建运行时并调用 RPC。
- [x] 验证 Local Server 能启动并调用运行时。
- [x] 验证会话、Agent turn、MCP 工具和数据持久化主流程。

## 完成标准

- `packages` 只保留 `backend`、`shared`、`local-server` 和 `ui`。
- Desktop 和 Local Server 仍只依赖 `@ant-chat/backend`。
- 不保留旧包兼容层或内部模块 package。
- `pnpm check` 和 `pnpm build` 全部通过。
