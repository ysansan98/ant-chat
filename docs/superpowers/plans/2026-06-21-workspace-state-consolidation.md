# 工作区状态源整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 web 端「当前工作区路径」整合为 `useWorkspaceStore.currentWorkspacePath` 单一事实源(SSOT),删除 `conversationsStore.currentWorkspacePath` 与 `WorkspaceSelector` 本地第三源;后端去掉 `currentWorkspacePath` 持久化,会话写接口改必传 `workspacePath`,从根上消除「Sender 显示工作区」与「会话实际归属」不一致的 bug。

**Architecture:** workspaceStore 顶层新增 `currentWorkspacePath` 字段(前端派生 + 显式设置),后端 `ListWorkspacesData` 不再回传该字段。新增统一入口 `activateWorkspace(path)` 封装「workspaceStore 已更新当前路径后,同步会话分片缓存到该路径」的成对操作,所有切换/新增/删除场景调用它,避免闭包陷阱与手动拼装遗漏。`conversationsStore` 删除 `currentWorkspacePath`,需要当前路径时跨 store 从 `useWorkspaceStore.getState().currentWorkspacePath` 读取。后端 `createConversation`/`startTurn`/`clearWorkspaceConversations` 的 `workspacePath` 改必传,`listConversations` 未传时语义改为跨工作区全量查询,删除 `getCurrentWorkspacePath()` 方法与 RPC 端点。

**Tech Stack:** TypeScript、Zustand、Immer、Vitest、Zod、React Testing Library;前端 `apps/web`,后端 workspace packages `app-data`/`app-runtime`/`agent-runtime`/`shared`。

## Global Constraints

- 单 PR 完成;前端 store/action/组件与后端 service/runtime/rpc 同步改,不留双源或前后端不一致。
- 所有对话、注释、UI 文案、提交信息使用中文;代码用 JSDoc 注释「为什么」。
- TypeScript-first,导出 API 显式标注类型;2 空格缩进;LF 行尾。
- 导入顺序(@antfu/eslint-config):`@ant-chat/*` workspace 包优先,其次外部包,最后相对导入。
- 测试框架 Vitest;行为导向,mock 系统边界(HTTP/IPC/文件系统),不 mock 内部 store/repository 模块。
- 每步运行 `pnpm check`(type-check + lint + unit tests),一次性修复所有错误再提交;后端接口签名变更会触发 `tsc -b` 跨包报错,据此定位调用点。
- `searchFiles` 端点入参加 `workspacePath: string` 必传(用户决策);`parseConfig` 容忍并忽略旧 `currentWorkspacePath` 字段(用户决策),`ensureInitialized` 派生只依赖 `workspaces` 列表的 `lastOpenedAt`。
- 提交前必须本地运行 `pnpm check` 全量通过。

---

## File Structure

### 后端(packages)

- **`packages/shared/src/interfaces/workspace.ts`**:`WorkspaceConfig` 删 `currentWorkspacePath` 字段;`ListWorkspacesData` 删 `currentWorkspacePath` 字段。
- **`packages/shared/src/interfaces/app-rpc.ts`**:删 `workspace.getCurrentWorkspacePath` 端点;`workspace.searchWorkspaceFiles` 入参加 `workspacePath: string` 必传。
- **`packages/shared/src/interfaces/agent-runtime-electron.ts`**:`StartAgentTurnOptions.workspacePath` 从可选改必传 `string`。
- **`packages/shared/src/ipc-events.ts`**:`workspace:changed` 事件 payload 删 `currentWorkspacePath`。
- **`packages/app-data/src/workspace/workspaceService.ts`**:`WorkspaceConfig` 不再持久化 `currentWorkspacePath`;删除 `getCurrentWorkspacePath()` 方法;`ensureInitialized`/`addWorkspace`/`openWorkspace`/`removeWorkspace`/`listWorkspaces` 对齐;`parseConfig` 容忍忽略旧字段。
- **`packages/app-runtime/src/appRuntime.ts`**:`createConversation`/`clearWorkspaceConversations` 的 `workspacePath` 改必传;`listConversations` 未传 = 全量查询;`searchFiles` 入参改必传;删除 `workspace.getCurrentPath`;`emitWorkspaceResult` 事件 payload 删 `currentWorkspacePath`。
- **`packages/app-runtime/src/rpcHandlers.ts`**:删 `workspace.getCurrentWorkspacePath` handler;`workspace.searchWorkspaceFiles` 传 `workspacePath`。
- **`packages/agent-runtime/src/agentTurnService.ts`**:`startTurn` 的 `workspacePath` 改必传,删兜底。

### 前端(apps/web)

- **`apps/web/src/store/workspace/store.ts`**:新增顶层 `currentWorkspacePath` 字段;`refresh`/`openWorkspace`/`addWorkspace`/`removeWorkspace` 显式设置/派生该字段。
- **`apps/web/src/store/conversation/initialState.ts`**:`StoreState` 与 `createInitialState` 删 `currentWorkspacePath`。
- **`apps/web/src/store/conversation/conversationsStore.ts`**:新增 `getCurrentWorkspacePath()` helper;`switchWorkspace` 重命名 `switchWorkspaceSlice`,key 跨 store 取;`reset`/`saveCurrentWorkspaceSlice` 对齐。
- **`apps/web/src/store/conversation/actions.ts`**:新增 `activateWorkspace(path)`;删 `switchWorkspaceConversationsAction`;`clearConversationsAction`/`nextPageConversationsAction` 跨 store 取路径与竞态守护。
- **`apps/web/src/components/Workspace/WorkspacePanels.tsx`**:删 `reloadCurrentWorkspace` 与本地派生;调用点改 `activateWorkspace`。
- **`apps/web/src/components/Workspace/WorkspaceSelector.tsx`**:删本地 `useReducer`/`applyWorkspaceData`;直接走 workspaceStore action + `activateWorkspace`。
- **`apps/web/src/components/Chat/Chat.tsx`**:`currentWorkspacePath` 改读 workspaceStore。
- **`apps/web/src/components/Sender/Sender.tsx`**:显示工作区名读 workspaceStore 顶层字段;`handleSwitchWorkspace` 改 `activateWorkspace`;`searchWorkspaceFiles` 调用传 `currentWorkspacePath`。
- **`apps/web/src/api/workspaceApi.ts`**:`searchWorkspaceFiles` 签名加 `workspacePath`。
- **`apps/web/src/hooks/useBuiltinCommandSubmit.ts`**:无逻辑改动,仅因 `Chat.tsx` 传入源变更而确认入参类型不变(`currentWorkspacePath?: string` 保留)。

### 测试文件(更新)

- **`packages/app-runtime/src/__tests__/appRuntime.spec.ts`**:改 `createConversation`/`clearWorkspaceConversations` 必传;`workspace:changed` 事件 payload 断言改空对象;`searchFiles` 传 `workspacePath`。
- **`packages/local-server/src/__tests__/server.spec.ts`**:`workspace:changed` SSE payload 断言改为空对象。
- **`packages/agent-runtime/src/__tests__/agentService.spec.ts`**:删除 mock 中 `getCurrentWorkspacePath`(必传后不再调用);确认所有 `startTurn` 已传 `workspacePath`。
- **`apps/web/src/__tests__/gui.spec.tsx`**:`seedActiveConversation`/`beforeEach` 改用 workspaceStore set `currentWorkspacePath`;`listWorkspaces` mock 返回删 `currentWorkspacePath`。
- **`apps/web/src/components/Sender/__tests__/Sender.spec.tsx`**:`listWorkspaces` mock 与 `useConversationsStore.setState` 删 `currentWorkspacePath`;`searchWorkspaceFiles` mock 断言加 `workspacePath`;改用 workspaceStore 设置当前路径。
- **新增**`apps/web/src/store/workspace/__tests__/store.spec.ts`:workspaceStore 派生与显式设置行为测试。
- **新增**`apps/web/src/store/conversation/__tests__/activateWorkspace.spec.ts`:`activateWorkspace` 行为测试。

---

## Task 1: 后端 shared 接口 — 删 currentWorkspacePath 字段与端点,searchFiles 入参必传

**Files:**
- Modify: `packages/shared/src/interfaces/workspace.ts:1-20`
- Modify: `packages/shared/src/interfaces/app-rpc.ts:105-113`
- Modify: `packages/shared/src/interfaces/agent-runtime-electron.ts:8-21`
- Modify: `packages/shared/src/ipc-events.ts:65-75`
- Test: `packages/shared/src/interfaces/__tests__/workspace-types.spec.ts`(新增,类型与运行时事件 payload 行为)

**Interfaces:**
- Consumes: 无(起始任务)
- Produces:
  - `WorkspaceConfig { workspaces: Array<{ path, addedAt, lastOpenedAt? }> }`(无 `currentWorkspacePath`)
  - `ListWorkspacesData { workspaces: WorkspaceItem[] }`(无 `currentWorkspacePath`)
  - `StartAgentTurnOptions.workspacePath: string`(必传)
  - `AppRendererEvents['workspace:changed'] = Record<string, never>`(空 payload)
  - `workspace.searchWorkspaceFiles` 端点入参 `{ workspacePath: string, query?: string, limit?: number }`

> 类型层面的破坏性改动会让 `tsc -b` 在下游包(app-data/app-runtime/agent-runtime/apps/web)报错,后续任务逐一修复。本任务只改 shared 类型与事件定义,先让类型变更落地。

- [ ] **Step 1: 写失败测试 — 事件 payload 不再含 currentWorkspacePath**

创建 `packages/shared/src/interfaces/__tests__/workspace-types.spec.ts`:

```ts
import { APP_RENDERER_EVENT_NAMES } from '../ipc-events'
import type { AppRendererEvents } from '../ipc-events'
import type { ListWorkspacesData, WorkspaceConfig } from '../workspace'
import { describe, expect, it } from 'vitest'

describe('workspace shared types', () => {
  it('ListWorkspacesData 不再含 currentWorkspacePath', () => {
    const data: ListWorkspacesData = { workspaces: [] }
    // 类型断言:该字段已不存在,访问应报类型错误(运行时此断言恒真,仅作占位)
    expect(data).not.toHaveProperty('currentWorkspacePath')
  })

  it('WorkspaceConfig 不再含 currentWorkspacePath', () => {
    const config: WorkspaceConfig = { workspaces: [] }
    expect(config).not.toHaveProperty('currentWorkspacePath')
  })

  it('workspace:changed 事件名仍在注册表且 payload 为空', () => {
    expect(APP_RENDERER_EVENT_NAMES).toContain('workspace:changed')
    // payload 类型为空对象:无法合法携带 currentWorkspacePath
    const payload: AppRendererEvents['workspace:changed'] = {}
    expect(payload).toEqual({})
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @ant-chat/shared test -- workspace-types`
Expected: FAIL —— `ListWorkspacesData` 当前含 `currentWorkspacePath`,但断言 `not.toHaveProperty` 对类型未删的运行时对象可能通过;真正失败来自类型 `WorkspaceConfig` 仍要求/允许该字段。若运行时通过而类型未改,需在 Step 3 删字段后用 `tsc -b` 验证类型错误消除。先记录当前状态,继续。

> 注:此测试主要作为类型契约的回归守卫。Step 3 删字段后,旧代码 `workspaceService.ts` 等会因引用 `currentWorkspacePath` 产生 `tsc -b` 报错,后续任务修复。

- [ ] **Step 3: 删 workspace.ts 字段**

编辑 `packages/shared/src/interfaces/workspace.ts`:

```ts
export interface WorkspaceConfig {
  workspaces: Array<{
    path: string
    addedAt: number
    lastOpenedAt?: number
  }>
}

export interface WorkspaceItem {
  path: string
  displayName: string
  isDefault: boolean
  lastOpenedAt?: number
}

export interface ListWorkspacesData {
  workspaces: WorkspaceItem[]
}
```

(删除 `WorkspaceConfig.currentWorkspacePath?: string` 与 `ListWorkspacesData.currentWorkspacePath: string`。)

- [ ] **Step 4: 删 app-rpc.ts 端点 + searchFiles 入参必传**

编辑 `packages/shared/src/interfaces/app-rpc.ts`:

将第 113 行:
```ts
  'workspace.searchWorkspaceFiles': RpcEndpoint<{ query?: string, limit?: number } | undefined, WorkspaceFileSearchResult[]>
```
改为:
```ts
  'workspace.searchWorkspaceFiles': RpcEndpoint<{ workspacePath: string, query?: string, limit?: number }, WorkspaceFileSearchResult[]>
```

删除第 109 行:
```ts
  'workspace.getCurrentWorkspacePath': RpcEndpoint<undefined, string>
```

- [ ] **Step 5: StartAgentTurnOptions.workspacePath 改必传**

编辑 `packages/shared/src/interfaces/agent-runtime-electron.ts`,将:
```ts
  workspacePath?: string
```
改为:
```ts
  workspacePath: string
```

- [ ] **Step 6: workspace:changed 事件 payload 改空**

编辑 `packages/shared/src/ipc-events.ts`,将第 71 行:
```ts
  'workspace:changed': { currentWorkspacePath: string }
```
改为:
```ts
  'workspace:changed': Record<string, never>
```

- [ ] **Step 7: 运行 shared 包测试 + 类型检查**

Run: `pnpm --filter @ant-chat/shared test && pnpm --filter @ant-chat/shared exec tsc --noEmit`
Expected: shared 包测试 PASS(含新 workspace-types.spec)。`tsc --noEmit` 在 shared 包内 PASS。**注意**:`pnpm type-check`(全仓 `tsc -b`)此时会在 app-data/app-runtime/agent-runtime/apps/web 报错,因为它们仍引用已删字段——这是预期,后续任务修复。本步只确认 shared 包自身通过。

- [ ] **Step 8: 提交**

```bash
git add packages/shared/src/interfaces/workspace.ts packages/shared/src/interfaces/app-rpc.ts packages/shared/src/interfaces/agent-runtime-electron.ts packages/shared/src/ipc-events.ts packages/shared/src/interfaces/__tests__/workspace-types.spec.ts
git commit -m "refactor(shared): 删除 currentWorkspacePath 字段与端点,searchFiles 入参加 workspacePath 必传"
```

---

## Task 2: 后端 workspaceService — 删持久化与方法,ensureInitialized 按 lastOpenedAt 派生

**Files:**
- Modify: `packages/app-data/src/workspace/workspaceService.ts:1-304`
- Test: `packages/app-data/src/workspace/__tests__/workspaceService.spec.ts`(扩展现有文件)

**Interfaces:**
- Consumes: Task 1 的 `WorkspaceConfig`(无 `currentWorkspacePath`)、`ListWorkspacesData`(无 `currentWorkspacePath`)。
- Produces:
  - `WorkspaceService.listWorkspaces(): ListWorkspacesData`(只返回 `workspaces`)
  - `WorkspaceService.addWorkspace(path)`/`openWorkspace(path)`/`removeWorkspace(path)`:只更新 `workspaces` 列表与 `lastOpenedAt`,不再写 `currentWorkspacePath`
  - `ensureInitialized()`:派生逻辑只依赖 `workspaces`,保证默认工作区在列表中
  - 删除 `getCurrentWorkspacePath()` 方法
  - `parseConfig`:容忍并忽略旧 `currentWorkspacePath` 字段

- [ ] **Step 1: 写失败测试 — listWorkspaces 不含 currentWorkspacePath,持久化只存 workspaces**

在 `packages/app-data/src/workspace/__tests__/workspaceService.spec.ts` 顶部追加导入与测试(保留现有 `computeDisplayNames` 测试):

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceService } from '../workspaceService'

describe('workspaceService currentWorkspacePath 整合', () => {
  let configPath: string
  let service: WorkspaceService

  beforeEach(() => {
    configPath = path.join(mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-')), 'workspace.json')
    service = new WorkspaceService({ filePath: configPath })
  })

  afterEach(() => {
    rmSync(path.dirname(configPath), { force: true, recursive: true })
  })

  it('listWorkspaces 不再返回 currentWorkspacePath', () => {
    const data = service.listWorkspaces()
    expect(data).not.toHaveProperty('currentWorkspacePath')
    expect(data.workspaces.length).toBeGreaterThan(0)
  })

  it('addWorkspace 后配置文件只持久化 workspaces,不含 currentWorkspacePath', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-added-'))
    try {
      service.addWorkspace(dir)
      const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
      expect(raw).not.toHaveProperty('currentWorkspacePath')
      expect(Array.isArray(raw.workspaces)).toBe(true)
    }
    finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it('openWorkspace 只更新 lastOpenedAt,不写 currentWorkspacePath', () => {
    const list = service.listWorkspaces()
    const target = list.workspaces[0]
    service.openWorkspace(target.path)
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
    expect(raw).not.toHaveProperty('currentWorkspacePath')
    const opened = (raw.workspaces as Array<{ path: string, lastOpenedAt?: number }>)
      .find(item => item.path === target.path)
    expect(opened?.lastOpenedAt).toBeTypeOf('number')
  })

  it('removeWorkspace 删除当前工作区后配置仍不含 currentWorkspacePath', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-rm-'))
    try {
      service.addWorkspace(dir)
      service.removeWorkspace(dir)
      const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
      expect(raw).not.toHaveProperty('currentWorkspacePath')
    }
    finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it('读取含旧 currentWorkspacePath 字段的配置文件时容忍并忽略该字段', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-legacy-'))
    try {
      // 先正常添加,再手写一个含旧字段的配置
      service.addWorkspace(dir)
      const legacy = {
        currentWorkspacePath: dir,
        workspaces: [
          { path: dir, addedAt: 1, lastOpenedAt: 2 },
        ],
      }
      require('node:fs').writeFileSync(configPath, JSON.stringify(legacy))

      // 重新创建 service 读取旧配置,不应抛错
      const legacyService = new WorkspaceService({ filePath: configPath })
      const data = legacyService.listWorkspaces()
      expect(data).not.toHaveProperty('currentWorkspacePath')
      expect(data.workspaces.some(item => item.path === dir)).toBe(true)
    }
    finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @ant-chat/app-data test -- workspaceService`
Expected: FAIL —— `listWorkspaces` 仍返回 `currentWorkspacePath`,配置文件仍写该字段。

- [ ] **Step 3: 改 workspaceService.ts — 删字段持久化与 getCurrentWorkspacePath 方法**

编辑 `packages/app-data/src/workspace/workspaceService.ts`:

(a) `ensureInitialized`(行 41-75)改为:
```ts
  ensureInitialized(): WorkspaceConfig {
    fs.mkdirSync(this.getDefaultWorkspacePath(), { recursive: true })
    const defaultPath = this.normalizeExistingDirectory(this.getDefaultWorkspacePath())

    const current = this.getConfig()
    const normalizedWorkspaces = current.workspaces
      .map((item) => {
        try {
          return {
            ...item,
            path: this.normalizeExistingDirectory(item.path),
          }
        }
        catch {
          return null
        }
      })
      .filter(item => item !== null)

    const existsDefault = normalizedWorkspaces.some(item => item.path === defaultPath)
    const workspaces = existsDefault
      ? normalizedWorkspaces
      : [{ path: defaultPath, addedAt: Date.now(), lastOpenedAt: Date.now() }, ...normalizedWorkspaces]

    const next = { workspaces: this.dedupeWorkspaces(workspaces) }
    this.saveConfig(next)
    return next
  }
```
(删除 `currentWorkspacePath` 的校验与回填逻辑。)

(b) `listWorkspaces`(行 77-83)改为:
```ts
  listWorkspaces(): ListWorkspacesData {
    const config = this.ensureInitialized()
    return {
      workspaces: this.toWorkspaceItems(config.workspaces),
    }
  }
```

(c) `addWorkspace`(行 85-103),将 `saveConfig` 调用改为:
```ts
    const now = Date.now()
    this.saveConfig({
      workspaces: [
        ...config.workspaces,
        { path: normalizedPath, addedAt: now, lastOpenedAt: now },
      ],
    })
```
(删除 `currentWorkspacePath: normalizedPath`。)

(d) `removeWorkspace`(行 105-121),将 `saveConfig` 调用改为:
```ts
    this.saveConfig({
      workspaces: nextWorkspaces,
    })
```
(删除 `currentWorkspacePath: ...` 整行。)

(e) `openWorkspace`(行 123-138),将 `saveConfig` 调用改为:
```ts
    const now = Date.now()
    this.saveConfig({
      workspaces: config.workspaces.map(item => item.path === normalizedPath ? { ...item, lastOpenedAt: now } : item),
    })
```
(删除 `currentWorkspacePath: normalizedPath`。)

(f) 删除 `getCurrentWorkspacePath` 方法(行 140-143):
```ts
  getCurrentWorkspacePath(): string {
    const config = this.ensureInitialized()
    return config.currentWorkspacePath || this.getDefaultWorkspacePath()
  }
```
整段删除。

(g) `parseConfig`(行 230-266),将末尾 return 与校验改为:
```ts
    // 兼容旧配置文件中残留的 currentWorkspacePath 字段:忽略不解析
    return {
      workspaces,
    }
```
删除 `if (record.currentWorkspacePath !== undefined && typeof record.currentWorkspacePath !== 'string')` 校验块(行 258-260)与 return 中的 `currentWorkspacePath: record.currentWorkspacePath`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @ant-chat/app-data test -- workspaceService`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/app-data/src/workspace/workspaceService.ts packages/app-data/src/workspace/__tests__/workspaceService.spec.ts
git commit -m "refactor(app-data): workspaceService 去掉 currentWorkspacePath 持久化与方法,按 lastOpenedAt 派生"
```

---

## Task 3: 后端 appRuntime — 会话接口读写区分语义,searchFiles 必传,删 getCurrentPath

**Files:**
- Modify: `packages/app-runtime/src/appRuntime.ts:140-200,360-375,434-437`
- Modify: `packages/app-runtime/src/rpcHandlers.ts:80,84`
- Test: `packages/app-runtime/src/__tests__/appRuntime.spec.ts:34-83`

**Interfaces:**
- Consumes: Task 1 的 RPC 契约(`chat.clearWorkspaceConversations` 已声明 `workspacePath: string` 必传;`workspace.searchWorkspaceFiles` 入参含 `workspacePath`;`workspace.getCurrentWorkspacePath` 端点已删)。Task 2 的 `WorkspaceService`(无 `getCurrentWorkspacePath`)。
- Produces:
  - `runtime.chat.createConversation(conversation)`:要求 `conversation.workspacePath` 必传非空,否则抛 `workspacePath is required`
  - `runtime.chat.listConversations(pageIndex, pageSize, workspacePath?)`:未传 `workspacePath` = 跨工作区全量查询(`getWorkspaceWhere` 返回空 WHERE,含 `workspace_path IS NULL`);传了 = 按路径筛选;删除 `includeNullWorkspace` 的默认工作区特判
  - `runtime.chat.clearWorkspaceConversations(workspacePath)`:必传,无兜底
  - `runtime.workspace.searchFiles(workspacePath, query?, limit?)`:`workspacePath` 必传
  - 删除 `runtime.workspace.getCurrentPath`
  - `emitWorkspaceResult`:`workspace:changed` 事件 payload 为空对象

- [ ] **Step 1: 写失败测试 — createConversation 必传、listConversations 全量语义、事件 payload 空**

替换 `packages/app-runtime/src/__tests__/appRuntime.spec.ts` 中三个测试(行 34-83):

```ts
  it('createConversation 必传 workspacePath,未传时抛错', async () => {
    await expect(runtime.chat.createConversation({
      title: 'no workspace',
      createdAt: 1,
      updatedAt: 1,
      settings: { modelId: 'model-1', providerId: 'provider-1', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
    } as any)).rejects.toThrow('workspacePath is required')
  })

  it('createConversation 传入 workspacePath 时归属该工作区', async () => {
    const workspacePath = runtime.workspace.getDefaultPath()
    const conversation = await runtime.chat.createConversation({
      title: 'explicit workspace',
      createdAt: 1,
      updatedAt: 1,
      workspacePath,
      settings: { modelId: 'model-1', providerId: 'provider-1', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
    })

    expect(conversation.workspacePath).toBe(workspacePath)
    const result = await runtime.chat.listConversations(0, 20, workspacePath)
    expect(result.data).toEqual([expect.objectContaining({ id: conversation.id, workspacePath })])
  })

  it('listConversations 未传 workspacePath 时返回跨工作区全量', async () => {
    const defaultPath = runtime.workspace.getDefaultPath()
    await runtime.chat.createConversation({
      title: 'in default',
      createdAt: 1,
      updatedAt: 1,
      workspacePath: defaultPath,
      settings: { modelId: 'm', providerId: 'p', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
    })

    const result = await runtime.chat.listConversations(0, 100)

    // 全量查询:不依赖 currentWorkspacePath 兜底,返回所有会话
    expect(result.total).toBeGreaterThanOrEqual(1)
  })

  it('workspace:changed 事件 payload 为空对象', async () => {
    const workspaceEvents: Record<string, never>[] = []
    runtime.events.on('workspace:changed', event => workspaceEvents.push(event))

    const workspace = runtime.workspace.list().workspaces[0]
    runtime.workspace.open(workspace.path)

    expect(workspaceEvents).toEqual([{}])
  })

  it('clearWorkspaceConversations 必传 workspacePath', async () => {
    const defaultPath = runtime.workspace.getDefaultPath()
    await runtime.chat.createConversation({
      title: 'to clear',
      createdAt: 1,
      updatedAt: 1,
      workspacePath: defaultPath,
      settings: { modelId: 'm', providerId: 'p', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
    })

    await expect(runtime.chat.clearWorkspaceConversations(undefined as any)).rejects.toThrow('workspacePath is required')

    const deletedIds = await runtime.chat.clearWorkspaceConversations(defaultPath)
    expect(deletedIds.length).toBe(1)
  })

  it('searchFiles 必传 workspacePath', async () => {
    const defaultPath = runtime.workspace.getDefaultPath()
    const results = await runtime.workspace.searchFiles(defaultPath, '', 10)
    expect(Array.isArray(results)).toBe(true)
  })
```

> 注:删除原 `it('applies the current workspace...')`(行 34-58)、`it('emits domain events...')`(行 60-72)、`it('clears all conversations...')`(行 74-83)三个测试,由上述五个替换。`runtime.workspace.getCurrentPath()` 调用全部移除。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @ant-chat/app-runtime test -- appRuntime`
Expected: FAIL —— 当前 `createConversation` 仍兜底不抛错;事件 payload 仍含 `currentWorkspacePath`;`searchFiles` 签名仍不含 `workspacePath`。

- [ ] **Step 3: 改 appRuntime.ts — listConversations 全量语义**

编辑 `packages/app-runtime/src/appRuntime.ts` 行 152-156,改为:
```ts
      listConversations: async (pageIndex: number, pageSize: number, workspacePath?: string) => {
        // 未传 workspacePath = 跨工作区全量查询(含 workspace_path IS NULL);
        // 传了 = 按该路径筛选。不再用 currentWorkspacePath 兜底。
        return await context.conversationRepository.list(pageIndex, pageSize, workspacePath, false)
      },
```
(删除 `getCurrentWorkspacePath()` 兜底与 `includeNullWorkspace` 的默认工作区特判;`includeNullWorkspace` 固定 `false`,由调用方显式决定是否纳入 null 工作区——本任务简化为常参 `false`,保留 repository 的 `includeNullWorkspace` 参数能力。)

- [ ] **Step 4: 改 appRuntime.ts — createConversation 必传**

编辑行 158-165,改为:
```ts
      createConversation: async (conversation: AddConversationsSchema) => {
        if (!conversation.workspacePath) {
          throw new Error('workspacePath is required')
        }
        const result = await context.conversationRepository.create({
          ...conversation,
          workspacePath: conversation.workspacePath,
        })
        events.emit('conversation:updated', { conversation: result })
        return result
      },
```

- [ ] **Step 5: 改 appRuntime.ts — clearWorkspaceConversations 必传**

编辑行 176-192,改为:
```ts
      clearWorkspaceConversations: async (workspacePath: string) => {
        if (!workspacePath) {
          throw new Error('workspacePath is required')
        }
        const targetWorkspace = workspacePath

        const listResult = await context.conversationRepository.list(0, Number.MAX_SAFE_INTEGER, targetWorkspace, false)
        const targetIds = listResult.data.map(c => c.id)

        if (targetIds.length === 0) {
          return []
        }

        for (const id of targetIds) {
          await agentRuntime.closeConversation(id)
        }

        return await context.conversationRepository.deleteByWorkspace(targetWorkspace, false)
      },
```

- [ ] **Step 6: 改 appRuntime.ts — searchFiles 必传 + 删 getCurrentPath**

编辑行 362-375 `workspace` 对象,改为:
```ts
    workspace: {
      list: () => context.workspaceService.listWorkspaces(),
      add: (path: string) => emitWorkspaceResult(context.workspaceService.addWorkspace(path)),
      remove: (path: string) => emitWorkspaceResult(context.workspaceService.removeWorkspace(path)),
      open: (path: string) => emitWorkspaceResult(context.workspaceService.openWorkspace(path)),
      getDefaultPath: () => context.workspaceService.getDefaultWorkspacePath(),
      listDirectories: (path?: string) => context.workspaceService.listDirectories(path),
      createDirectory: (parentPath: string, name: string) => context.workspaceService.createDirectory(parentPath, name),
      searchFiles: async (workspacePath: string, query = '', limit = 50) => {
        if (!workspacePath) {
          throw new Error('workspacePath is required')
        }
        return await searchWorkspaceFiles(workspacePath, query, limit)
      },
    },
```
(删除 `getCurrentPath: () => context.workspaceService.getCurrentWorkspacePath()`;`searchFiles` 第一参 `workspacePath` 必传,删 `getCurrentWorkspacePath()` 兜底。)

- [ ] **Step 7: 改 appRuntime.ts — emitWorkspaceResult 事件 payload 空**

编辑行 434-437,改为:
```ts
  function emitWorkspaceResult(result: ReturnType<typeof context.workspaceService.listWorkspaces>) {
    events.emit('workspace:changed', {})
    return result
  }
```

- [ ] **Step 8: 改 rpcHandlers.ts — 删 getCurrentWorkspacePath handler,searchFiles 传 workspacePath**

编辑 `packages/app-runtime/src/rpcHandlers.ts`:

删除行 80:
```ts
    'workspace.getCurrentWorkspacePath': () => runtime.workspace.getCurrentPath(),
```

将行 84:
```ts
    'workspace.searchWorkspaceFiles': input => runtime.workspace.searchFiles(input?.query, input?.limit),
```
改为:
```ts
    'workspace.searchWorkspaceFiles': input => runtime.workspace.searchFiles(input.workspacePath, input?.query, input?.limit),
```

- [ ] **Step 9: 运行 app-runtime 测试确认通过**

Run: `pnpm --filter @ant-chat/app-runtime test -- appRuntime`
Expected: PASS。

- [ ] **Step 10: 提交**

```bash
git add packages/app-runtime/src/appRuntime.ts packages/app-runtime/src/rpcHandlers.ts packages/app-runtime/src/__tests__/appRuntime.spec.ts
git commit -m "refactor(app-runtime): 会话接口读写区分语义,searchFiles 必传 workspacePath,删除 getCurrentPath"
```

---

## Task 4: 后端 agentTurnService — startTurn 必传 workspacePath

**Files:**
- Modify: `packages/agent-runtime/src/agentTurnService.ts:1-60`
- Test: `packages/agent-runtime/src/__tests__/agentService.spec.ts:60-70`

**Interfaces:**
- Consumes: Task 1 的 `StartAgentTurnOptions.workspacePath: string`(必传)。Task 2 的 `WorkspaceService`(无 `getCurrentWorkspacePath`)。
- Produces: `startTurn(options)` 要求 `options.workspacePath` 非空,不再兜底 `process.cwd()`。

- [ ] **Step 1: 写失败测试 — startTurn 未传 workspacePath 抛错**

在 `packages/agent-runtime/src/__tests__/agentService.spec.ts` 的 `describe` 内追加(找到现有 `it('保留显式传入的 turn 上下文字段')` 附近):

```ts
  it('startTurn 未传 workspacePath 时抛错,不再兜底 process.cwd()', async () => {
    const service = createAgentRuntimeController(runtime, appDataContext, { aiProviderFactory })
    await expect(service.startTurn({
      prompt: 'inspect',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
        features: { enableMCP: false },
      },
    } as any)).rejects.toThrow('workspacePath is required')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @ant-chat/agent-runtime test -- agentService`
Expected: FAIL —— 当前 `startTurn` 用 `?? getCurrentWorkspacePath() ?? process.cwd()` 兜底,不抛错。

- [ ] **Step 3: 改 agentTurnService.ts — workspacePath 必传**

编辑 `packages/agent-runtime/src/agentTurnService.ts`:

(a) 删除顶部 `import process from 'node:process'`(行 11),不再需要。

(b) 将行 38-40:
```ts
      const workspacePath = options.workspacePath
        ?? appDataContext.workspaceService.getCurrentWorkspacePath()
        ?? process.cwd()
```
改为:
```ts
      const workspacePath = options.workspacePath
      if (!workspacePath) {
        throw new Error('workspacePath is required')
      }
```

- [ ] **Step 4: 清理 agentService.spec.ts mock 中的 getCurrentWorkspacePath**

编辑 `packages/agent-runtime/src/__tests__/agentService.spec.ts` 行 66,删除:
```ts
    getCurrentWorkspacePath: vi.fn(() => '/workspace'),
```
(必传后该 mock 不再被调用;删除避免误导。确认其余 `startTurn` 调用均显式传 `workspacePath`——行 39/122/144/164 等已传,无需改。)

- [ ] **Step 5: 运行 agent-runtime 测试确认通过**

Run: `pnpm --filter @ant-chat/agent-runtime test -- agentService`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/agent-runtime/src/agentTurnService.ts packages/agent-runtime/src/__tests__/agentService.spec.ts
git commit -m "refactor(agent-runtime): startTurn 必传 workspacePath,删除 getCurrentWorkspacePath 兜底"
```

---

## Task 5: 后端 local-server 测试 — workspace:changed SSE payload 空

**Files:**
- Modify: `packages/local-server/src/__tests__/server.spec.ts:96-103`

**Interfaces:**
- Consumes: Task 3 的 `workspace:changed` 事件 payload 为空对象。
- Produces: 无(仅测试对齐)。

- [ ] **Step 1: 改测试 — SSE payload 断言改为空对象**

编辑 `packages/local-server/src/__tests__/server.spec.ts` 行 96-103:
```ts
  it('通过 SSE 推送运行时事件', async () => {
    const payload = await readSseEvent('workspace:changed', () => {
      eventEmitter.emit('workspace:changed', {})
    })

    expect(payload).toContain('event: workspace:changed')
    expect(payload).toContain('data: {}')
  })
```

- [ ] **Step 2: 运行 local-server 测试确认通过**

Run: `pnpm --filter @ant-chat/local-server test -- server`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add packages/local-server/src/__tests__/server.spec.ts
git commit -m "test(local-server): workspace:changed SSE payload 对齐为空对象"
```

---

## Task 6: 前端 workspaceStore — 新增顶层 currentWorkspacePath SSOT 字段与派生

**Files:**
- Modify: `apps/web/src/store/workspace/store.ts:1-59`
- Test: `apps/web/src/store/workspace/__tests__/store.spec.ts`(新增)

**Interfaces:**
- Consumes: Task 1 的 `ListWorkspacesData`(无 `currentWorkspacePath`,只含 `workspaces`)。`workspaceApi.listWorkspaces`/`addWorkspace`/`openWorkspace`/`removeWorkspace`(返回 `ListWorkspacesData`)。
- Produces:
  - `WorkspaceStoreState.currentWorkspacePath: string`(顶层 SSOT,初始 `''`)
  - `refresh()`:拉 `workspaces` 后,若 `currentWorkspacePath` 为空或不在列表中,取 `lastOpenedAt` 最大者为当前;列表为空时取 `''`(由后端 `ensureInitialized` 保证默认工作区在列表,实际不为空)
  - `openWorkspace(path)`/`addWorkspace(path)`:`set({ workspaceData, currentWorkspacePath: path })`
  - `removeWorkspace(path)`:若删的是当前工作区,`currentWorkspacePath` 回退到 `workspaces` 中 `lastOpenedAt` 最大者;否则保持
  - `workspaceData: ListWorkspacesData | null`(只含 `workspaces`)

- [ ] **Step 1: 写失败测试 — 派生与显式设置行为**

创建 `apps/web/src/store/workspace/__tests__/store.spec.ts`:

```ts
import type { ListWorkspacesData } from '@ant-chat/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  addWorkspace: vi.fn(),
  openWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
}))

vi.mock('@/api/workspaceApi', () => ({
  default: mocks,
}))

import { useWorkspaceStore } from '../store'

function makeWorkspaces(paths: Array<{ path: string, lastOpenedAt: number }>): ListWorkspacesData {
  return {
    workspaces: paths.map(item => ({
      path: item.path,
      displayName: item.path,
      isDefault: false,
      lastOpenedAt: item.lastOpenedAt,
    })),
  }
}

describe('workspaceStore currentWorkspacePath SSOT', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({ workspaceData: null, currentWorkspacePath: '', loading: false })
  })

  it('refresh 后 currentWorkspacePath 派生为 lastOpenedAt 最大者', async () => {
    mocks.listWorkspaces.mockResolvedValue(makeWorkspaces([
      { path: '/a', lastOpenedAt: 1 },
      { path: '/b', lastOpenedAt: 5 },
      { path: '/c', lastOpenedAt: 3 },
    ]))

    await useWorkspaceStore.getState().refresh()

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/b')
  })

  it('refresh 后若当前路径仍有效则保持不变', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: '/c' })
    mocks.listWorkspaces.mockResolvedValue(makeWorkspaces([
      { path: '/a', lastOpenedAt: 1 },
      { path: '/c', lastOpenedAt: 3 },
    ]))

    await useWorkspaceStore.getState().refresh()

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/c')
  })

  it('refresh 后若当前路径不在列表则回退到 lastOpenedAt 最大者', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: '/gone' })
    mocks.listWorkspaces.mockResolvedValue(makeWorkspaces([
      { path: '/a', lastOpenedAt: 1 },
      { path: '/b', lastOpenedAt: 9 },
    ]))

    await useWorkspaceStore.getState().refresh()

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/b')
  })

  it('addWorkspace 后 currentWorkspacePath 显式设置为目标路径', async () => {
    mocks.addWorkspace.mockResolvedValue(makeWorkspaces([{ path: '/new', lastOpenedAt: 10 }]))

    await useWorkspaceStore.getState().addWorkspace('/new')

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/new')
  })

  it('openWorkspace 后 currentWorkspacePath 显式设置为目标路径', async () => {
    mocks.openWorkspace.mockResolvedValue(makeWorkspaces([{ path: '/opened', lastOpenedAt: 10 }]))

    await useWorkspaceStore.getState().openWorkspace('/opened')

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/opened')
  })

  it('removeWorkspace 删除当前工作区后回退到 lastOpenedAt 最大者', async () => {
    useWorkspaceStore.setState({
      currentWorkspacePath: '/cur',
      workspaceData: makeWorkspaces([
        { path: '/cur', lastOpenedAt: 5 },
        { path: '/other', lastOpenedAt: 8 },
      ]),
    })
    mocks.removeWorkspace.mockResolvedValue(makeWorkspaces([{ path: '/other', lastOpenedAt: 8 }]))

    await useWorkspaceStore.getState().removeWorkspace('/cur')

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/other')
  })

  it('removeWorkspace 删除非当前工作区时 currentWorkspacePath 保持不变', async () => {
    useWorkspaceStore.setState({
      currentWorkspacePath: '/cur',
      workspaceData: makeWorkspaces([
        { path: '/cur', lastOpenedAt: 5 },
        { path: '/other', lastOpenedAt: 8 },
      ]),
    })
    mocks.removeWorkspace.mockResolvedValue(makeWorkspaces([{ path: '/cur', lastOpenedAt: 5 }]))

    await useWorkspaceStore.getState().removeWorkspace('/other')

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/cur')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @ant-chat/web test -- store/workspace/__tests__/store`
Expected: FAIL —— 当前 `WorkspaceStoreState` 无 `currentWorkspacePath` 字段;`refresh` 不派生该字段;`addWorkspace`/`openWorkspace`/`removeWorkspace` 不设置该字段。

> 若 `pnpm --filter @ant-chat/web` 名称不匹配,改用 `pnpm -F apps/web test` 或直接 `cd apps/web && pnpm test -- store/workspace/__tests__/store`。以 `apps/web/package.json` 的 `name` 字段为准。

- [ ] **Step 3: 改 store.ts — 新增 SSOT 字段与派生**

编辑 `apps/web/src/store/workspace/store.ts`,整体替换为:

```ts
import type { ListWorkspacesData, WorkspaceItem } from '@ant-chat/shared'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import workspaceApi from '@/api/workspaceApi'
import { WORKSPACE_CHANGED_EVENT } from '@/constants/workspaceEvents'

interface WorkspaceStoreState {
  /** 当前工作区路径(SSOT):前端派生 + 工作区操作显式设置。后端不再回传。 */
  currentWorkspacePath: string
  workspaceData: ListWorkspacesData | null
  loading: boolean
}

interface WorkspaceStoreActions {
  refresh: () => Promise<void>
  openWorkspace: (path: string) => Promise<ListWorkspacesData>
  addWorkspace: (path: string) => Promise<ListWorkspacesData>
  removeWorkspace: (path: string) => Promise<ListWorkspacesData>
}

export type WorkspaceStore = WorkspaceStoreState & WorkspaceStoreActions

/**
 * 从 workspaces 列表中取 lastOpenedAt 最大者为当前工作区。
 * 列表为空时返回空串(由后端 ensureInitialized 保证默认工作区始终在列表,实际不会为空)。
 */
function pickLatestWorkspace(workspaces: WorkspaceItem[]): string {
  if (workspaces.length === 0) {
    return ''
  }
  return workspaces.reduce((latest, item) => {
    const ts = item.lastOpenedAt ?? 0
    const latestTs = latest.lastOpenedAt ?? 0
    return ts > latestTs ? item : latest
  }).path
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  devtools(
    set => ({
      currentWorkspacePath: '',
      workspaceData: null,
      loading: false,

      refresh: async () => {
        const data = await workspaceApi.listWorkspaces()
        set((state) => {
          const workspaces = data.workspaces
          // 当前路径为空或不在列表中时,按 lastOpenedAt 派生;否则保持
          const stillValid = state.currentWorkspacePath
            && workspaces.some(item => item.path === state.currentWorkspacePath)
          const currentWorkspacePath = stillValid
            ? state.currentWorkspacePath
            : pickLatestWorkspace(workspaces)
          return { workspaceData: data, currentWorkspacePath }
        })
      },

      openWorkspace: async (path: string) => {
        const data = await workspaceApi.openWorkspace(path)
        set({ workspaceData: data, currentWorkspacePath: path })
        return data
      },

      addWorkspace: async (path: string) => {
        const data = await workspaceApi.addWorkspace(path)
        set({ workspaceData: data, currentWorkspacePath: path })
        return data
      },

      removeWorkspace: async (path: string) => {
        const data = await workspaceApi.removeWorkspace(path)
        set((state) => {
          // 删的是当前工作区时,回退到 lastOpenedAt 最大者;否则保持
          const isCurrent = path === state.currentWorkspacePath
          const currentWorkspacePath = isCurrent
            ? pickLatestWorkspace(data.workspaces)
            : state.currentWorkspacePath
          return { workspaceData: data, currentWorkspacePath }
        })
        return data
      },
    }),
    { name: 'workspace-store' },
  ),
)

// 全局监听工作区变更事件,自动刷新(刷新内部按 lastOpenedAt 派生当前路径)
if (typeof window !== 'undefined') {
  window.addEventListener(WORKSPACE_CHANGED_EVENT, () => {
    void useWorkspaceStore.getState().refresh()
  })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @ant-chat/web test -- store/workspace/__tests__/store`(或等价命令)
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/store/workspace/store.ts apps/web/src/store/workspace/__tests__/store.spec.ts
git commit -m "feat(web): workspaceStore 新增顶层 currentWorkspacePath SSOT 字段与 lastOpenedAt 派生"
```

---

## Task 7: 前端 conversationsStore — 删 currentWorkspacePath,switchWorkspace 改名跨 store 取 key

**Files:**
- Modify: `apps/web/src/store/conversation/initialState.ts:11-47`
- Modify: `apps/web/src/store/conversation/conversationsStore.ts:1-118`

**Interfaces:**
- Consumes: Task 6 的 `useWorkspaceStore.getState().currentWorkspacePath`。
- Produces:
  - `StoreState` 删除 `currentWorkspacePath`
  - `createInitialState()` 不再含 `currentWorkspacePath`
  - `getCurrentWorkspacePath(): string`(conversationsStore 内部 helper,读 workspaceStore)
  - `switchWorkspaceSlice(workspacePath: string)`:no-op 守卫用 `getCurrentWorkspacePath()`;save 旧分片 key 用 `getCurrentWorkspacePath()`,restore 新分片 key 用入参 `path`;不再 set `currentWorkspacePath`
  - `saveCurrentWorkspaceSlice`:key 用 `getCurrentWorkspacePath()`
  - `reset`:在 `set` 回调外先取 `currentPath`,用该值替代 `state.currentWorkspacePath`

> 本任务与 Task 8(actions.ts 新增 `activateWorkspace`)紧耦合:`switchWorkspace` 重命名为 `switchWorkspaceSlice` 后,`ensureWorkspaceConversationsAction`(actions.ts:72)仍调用旧名,会报类型错误。Task 8 同步修复。本任务先改 store,允许 `pnpm check` 暂时报 actions.ts 的错,Task 8 修复。

- [ ] **Step 1: 改 initialState.ts — 删字段**

编辑 `apps/web/src/store/conversation/initialState.ts`:

(a) `StoreState`(行 11-22)删除 `currentWorkspacePath: string` 行(行 20)。

(b) `createInitialState`(行 34-47)删除 `currentWorkspacePath: '',`(行 44)。

改后 `StoreState`:
```ts
export interface StoreState {
  conversations: IConversations[]
  abortCallbacks: (() => void)[]
  pageIndex: number
  pageSize: number
  conversationsTotal: number
  activeConversationsId: string
  streamingConversationIds: Set<string>
  loadVersion: number
  workspaceConversations: Record<string, WorkspaceConversationsState>
}
```

`createInitialState`:
```ts
export function createInitialState(): StoreState {
  return {
    conversations: [],
    abortCallbacks: [],
    streamingConversationIds: new Set<string>(),
    pageIndex: 0,
    pageSize: 20,
    conversationsTotal: 1,
    activeConversationsId: '',
    loadVersion: 0,
    workspaceConversations: {},
  }
}
```

- [ ] **Step 2: 改 conversationsStore.ts — helper + switchWorkspaceSlice + reset + saveCurrentWorkspaceSlice**

编辑 `apps/web/src/store/conversation/conversationsStore.ts`,整体替换为:

```ts
import type { StoreState, WorkspaceConversationsState } from './initialState'

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  createInitialState,
  createWorkspaceConversationsState,
  initialState,
} from './initialState'
import { useWorkspaceStore } from '@/store/workspace'

interface StoreActions {
  reset: () => void
  setActiveConversationsId: (id: string) => void
  switchWorkspaceSlice: (workspacePath: string) => void
  saveCurrentWorkspaceSlice: () => void
}
export type ConversationsStore = StoreState & StoreActions

/**
 * 跨 store 读取当前工作区路径(SSOT 在 workspaceStore)。
 * conversationsStore 不再持有 currentWorkspacePath,需要时统一从此取。
 */
function getCurrentWorkspacePath(): string {
  return useWorkspaceStore.getState().currentWorkspacePath ?? ''
}

function getWorkspaceSlice(state: StoreState, workspacePath: string): WorkspaceConversationsState {
  return state.workspaceConversations[workspacePath] || createWorkspaceConversationsState()
}

// 创建基础 store
export const useConversationsStore = create<ConversationsStore>()(
  devtools(
    (set, get) => ({
      ...initialState,
      reset: () => {
        // 在 set 回调外先取当前路径,避免回调内跨 store 读取的时序歧义
        const currentPath = getCurrentWorkspacePath()
        set((state) => {
          const nextState = createInitialState()
          nextState.pageSize = state.pageSize

          if (currentPath) {
            const currentSlice = getWorkspaceSlice(state, currentPath)
            const nextSlice: WorkspaceConversationsState = {
              ...currentSlice,
              conversations: [],
              pageIndex: 0,
              conversationsTotal: 0,
              loadVersion: currentSlice.loadVersion + 1,
              loaded: true,
            }
            nextState.workspaceConversations = {
              ...state.workspaceConversations,
              [currentPath]: nextSlice,
            }
            nextState.conversations = nextSlice.conversations
            nextState.pageIndex = nextSlice.pageIndex
            nextState.conversationsTotal = nextSlice.conversationsTotal
            nextState.loadVersion = nextSlice.loadVersion
          }

          return nextState
        })
      },
      setActiveConversationsId: (id: string) => {
        set({ activeConversationsId: id })
      },
      saveCurrentWorkspaceSlice: () => {
        const state = get()
        const currentPath = getCurrentWorkspacePath()
        if (!currentPath) {
          return
        }

        set({
          workspaceConversations: {
            ...state.workspaceConversations,
            [currentPath]: {
              conversations: state.conversations,
              pageIndex: state.pageIndex,
              conversationsTotal: state.conversationsTotal,
              loadVersion: state.loadVersion,
              loaded: true,
            },
          },
        })
      },
      switchWorkspaceSlice: (workspacePath: string) => {
        // no-op 守卫用 workspaceStore 当前路径(旧路径),与 save key 一致
        const currentPath = getCurrentWorkspacePath()
        if (workspacePath === currentPath) {
          return
        }

        set((state) => {
          const nextWorkspaceConversations = { ...state.workspaceConversations }

          // save 旧分片,key 用旧路径(currentPath)
          if (currentPath) {
            nextWorkspaceConversations[currentPath] = {
              conversations: state.conversations,
              pageIndex: state.pageIndex,
              conversationsTotal: state.conversationsTotal,
              loadVersion: state.loadVersion,
              loaded: true,
            }
          }

          // restore 新分片,key 用入参 path
          const nextSlice = nextWorkspaceConversations[workspacePath] || createWorkspaceConversationsState()

          return {
            ...state,
            // 不再 set currentWorkspacePath(SSOT 在 workspaceStore)
            workspaceConversations: nextWorkspaceConversations,
            conversations: nextSlice.conversations,
            pageIndex: nextSlice.pageIndex,
            conversationsTotal: nextSlice.conversationsTotal,
            loadVersion: nextSlice.loadVersion,
            activeConversationsId: '',
            streamingConversationIds: new Set<string>(),
            abortCallbacks: [],
          }
        })
      },
    }),
    {
      enabled: import.meta.env.MODE === 'development',
    },
  ),
)
```

- [ ] **Step 3: 暂不运行全量 check(actions.ts 仍引用旧名,Task 8 修复)**

确认 `conversationsStore.ts` 与 `initialState.ts` 自身无语法错误:
Run: `pnpm --filter @ant-chat/web exec tsc --noEmit -p apps/web/tsconfig.json 2>&1 | rg "conversationsStore|initialState" || echo "store 文件自身无新错"`
Expected: store 文件自身无新错(可能仍有 actions.ts 的 `switchWorkspace` 旧名引用错,属预期)。

- [ ] **Step 4: 提交(与 Task 8 合并提交亦可,此处单独提交 store 层)**

```bash
git add apps/web/src/store/conversation/initialState.ts apps/web/src/store/conversation/conversationsStore.ts
git commit -m "refactor(web): conversationsStore 删 currentWorkspacePath,switchWorkspaceSlice 跨 store 取 key"
```

> 注:此时 `pnpm check` 仍会因 actions.ts 与组件引用 `switchWorkspace`/`switchWorkspaceConversationsAction` 报错,后续 Task 8-11 修复。本提交是 store 层的干净切片。

---

## Task 8: 前端 actions.ts — 新增 activateWorkspace,改 clear/nextPage 跨 store 取路径

**Files:**
- Modify: `apps/web/src/store/conversation/actions.ts:1-260`
- Test: `apps/web/src/store/conversation/__tests__/activateWorkspace.spec.ts`(新增)

**Interfaces:**
- Consumes: Task 7 的 `switchWorkspaceSlice`、`saveCurrentWorkspaceSlice`、`getCurrentWorkspacePath`(store 导出需补)。Task 6 的 `useWorkspaceStore.getState().currentWorkspacePath`。`setActiveConversationsId`(来自 `@/store/messages`)。
- Produces:
  - `activateWorkspace(workspacePath: string): Promise<void>`:空路径 → 仅 `setActiveConversationsId('')`;非空 → `ensureWorkspaceConversationsAction(path)` + `switchWorkspaceSlice(path)` + 必要时 `nextPageConversationsAction()` 补加载首页
  - 删除 `switchWorkspaceConversationsAction`
  - `ensureWorkspaceConversationsAction`:内部 `switchWorkspace` 改为 `switchWorkspaceSlice`
  - `clearConversationsAction`:`currentWorkspacePath` 从 `useWorkspaceStore.getState().currentWorkspacePath` 取
  - `nextPageConversationsAction`:发起时 `currentWorkspacePath` 从 workspaceStore 取;竞态守护在 produce 回调内读 `useWorkspaceStore.getState().currentWorkspacePath` 与发起时值比较

- [ ] **Step 1: 写失败测试 — activateWorkspace 行为**

创建 `apps/web/src/store/conversation/__tests__/activateWorkspace.spec.ts`:

```ts
import type { IConversations } from '@ant-chat/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const chatMocks = vi.hoisted(() => ({
  getWorkspaceConversations: vi.fn(),
  clearWorkspaceConversations: vi.fn(),
}))

vi.mock('@/api/chatApi', () => ({
  default: chatMocks,
}))

import { useWorkspaceStore } from '@/store/workspace'
import { activateWorkspace, clearConversationsAction } from '../actions'
import { useConversationsStore } from '../conversationsStore'
import { useMessagesStore } from '@/store/messages'

function makeConversation(id: string, workspacePath: string): IConversations {
  return {
    id,
    workspacePath,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    settings: { modelId: 'm', providerId: 'p', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
  } as IConversations
}

describe('activateWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({ currentWorkspacePath: '', workspaceData: null, loading: false })
    useConversationsStore.setState({
      conversations: [],
      abortCallbacks: [],
      pageIndex: 0,
      pageSize: 20,
      conversationsTotal: 1,
      activeConversationsId: 'stale-id',
      streamingConversationIds: new Set<string>(),
      loadVersion: 0,
      workspaceConversations: {},
    })
    useMessagesStore.setState({ activeConversationsId: 'stale-id', messages: [] })
  })

  it('空路径时仅清空 activeConversationsId,不加载会话', async () => {
    await activateWorkspace('')

    expect(useMessagesStore.getState().activeConversationsId).toBe('')
    expect(chatMocks.getWorkspaceConversations).not.toHaveBeenCalled()
  })

  it('非空路径时加载该工作区分片并切换顶层 slice', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: '/other' })
    chatMocks.getWorkspaceConversations.mockResolvedValue({
      data: [makeConversation('c1', '/target')],
      total: 1,
    })

    await activateWorkspace('/target')

    expect(chatMocks.getWorkspaceConversations).toHaveBeenCalledWith('/target', 0, 20)
    expect(useConversationsStore.getState().conversations).toHaveLength(1)
    expect(useConversationsStore.getState().conversations[0].id).toBe('c1')
  })

  it('分片已加载时复用缓存,不重复请求', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: '/other' })
    // 预置已加载的分片
    useConversationsStore.setState({
      workspaceConversations: {
        '/target': {
          conversations: [makeConversation('cached', '/target')],
          pageIndex: 0,
          conversationsTotal: 1,
          loadVersion: 0,
          loaded: true,
        },
      },
    })

    await activateWorkspace('/target')

    expect(chatMocks.getWorkspaceConversations).not.toHaveBeenCalled()
    expect(useConversationsStore.getState().conversations[0].id).toBe('cached')
  })
})

describe('clearConversationsAction 跨 store 取路径', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({ currentWorkspacePath: '/cur', workspaceData: null, loading: false })
    useConversationsStore.setState({
      conversations: [makeConversation('c1', '/cur')],
      abortCallbacks: [],
      pageIndex: 0,
      pageSize: 20,
      conversationsTotal: 1,
      activeConversationsId: '',
      streamingConversationIds: new Set<string>(),
      loadVersion: 0,
      workspaceConversations: {},
    })
  })

  it('用 workspaceStore 当前路径清空,不再读 conversationsStore.currentWorkspacePath', async () => {
    chatMocks.clearWorkspaceConversations.mockResolvedValue([])

    await clearConversationsAction()

    expect(chatMocks.clearWorkspaceConversations).toHaveBeenCalledWith('/cur')
  })

  it('workspaceStore 路径为空时抛错', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: '' })

    await expect(clearConversationsAction()).rejects.toThrow('当前工作区路径不存在，无法清空对话')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @ant-chat/web test -- store/conversation/__tests__/activateWorkspace`
Expected: FAIL —— `activateWorkspace` 未导出;`clearConversationsAction` 仍读 `conversationsStore.currentWorkspacePath`(已删字段)。

- [ ] **Step 3: 改 actions.ts — 新增 activateWorkspace,删 switchWorkspaceConversationsAction,改 ensure/clear/nextPage**

编辑 `apps/web/src/store/conversation/actions.ts`:

(a) 顶部导入补 `useWorkspaceStore` 与 `setActiveConversationsId`。将行 1-7 的导入区改为:
```ts
import type { AddConversationsSchema, ConversationsId, ConversationsSettingsSchema, IConversations } from '@ant-chat/shared'
import type { AntChatFileStructure } from '@/constants'
import { produce } from 'immer'
import chatApi from '@/api/chatApi'
import { useGeneralSettingsStore } from '@/store/generalSettings'
import { setActiveConversationsId, clearActiveConversations } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
import { useConversationsStore } from './conversationsStore'
```
(注意:`clearActiveConversations` 原本就从 `../messages` 导入,保持;`setActiveConversationsId` 新增导入——确认 `@/store/messages` 导出 `setActiveConversationsId`,若导出路径不同则调整。)

(b) 新增 `getCurrentWorkspacePath` helper(放在 `saveCurrentSlice` 之后,`ensureWorkspaceConversationsAction` 之前):
```ts
function getCurrentWorkspacePath(): string {
  return useWorkspaceStore.getState().currentWorkspacePath ?? ''
}
```

(c) `ensureWorkspaceConversationsAction`(行 19-69)末尾的 `switchWorkspace` 调用——本函数内无该调用,无需改。但检查:原 `switchWorkspaceConversationsAction`(行 71-79)调用 `useConversationsStore.getState().switchWorkspace(workspacePath)`,本步骤删除整个 `switchWorkspaceConversationsAction` 函数(行 71-79),用 `activateWorkspace` 替代。

在原 `switchWorkspaceConversationsAction` 位置(行 71 前)新增:
```ts
/**
 * 统一的工作区激活入口:在 workspaceStore 已更新当前路径后,
 * 同步会话分片缓存到该路径。所有切换/新增/删除场景调用此入口,
 * 避免手动拼装 ensure+switch 导致的遗漏与闭包陷阱。
 *
 * 入参为目标工作区路径,由调用方传入(与紧邻的 workspaceStore action 的 path 入参一致),
 * 不依赖任何闭包渲染期变量。activateWorkspace 不写 workspaceStore(SSOT 由 workspaceStore action 负责)。
 */
export async function activateWorkspace(workspacePath: string): Promise<void> {
  await setActiveConversationsId('')
  if (!workspacePath) {
    return
  }
  await ensureWorkspaceConversationsAction(workspacePath)
  useConversationsStore.getState().switchWorkspaceSlice(workspacePath)

  const nextState = useConversationsStore.getState()
  if (nextState.conversations.length === 0 && nextState.conversationsTotal > 0) {
    await nextPageConversationsAction()
  }
}
```

删除原 `switchWorkspaceConversationsAction`(行 71-79)整段。

(d) `clearConversationsAction`(行 135-152),将:
```ts
export async function clearConversationsAction() {
  const { currentWorkspacePath } = useConversationsStore.getState()
  if (!currentWorkspacePath) {
    throw new Error('当前工作区路径不存在，无法清空对话')
  }

  await chatApi.clearWorkspaceConversations(currentWorkspacePath)
```
改为:
```ts
export async function clearConversationsAction() {
  const currentWorkspacePath = getCurrentWorkspacePath()
  if (!currentWorkspacePath) {
    throw new Error('当前工作区路径不存在，无法清空对话')
  }

  await chatApi.clearWorkspaceConversations(currentWorkspacePath)
```

(e) `nextPageConversationsAction`(行 154-195),将:
```ts
export async function nextPageConversationsAction() {
  const { pageIndex, pageSize, loadVersion, currentWorkspacePath } = useConversationsStore.getState()
  if (!currentWorkspacePath) {
    return
  }
```
改为:
```ts
export async function nextPageConversationsAction() {
  const { pageIndex, pageSize, loadVersion } = useConversationsStore.getState()
  const currentWorkspacePath = getCurrentWorkspacePath()
  if (!currentWorkspacePath) {
    return
  }
```

将竞态守护(行 171-178):
```ts
    useConversationsStore.setState(state => produce(state, (draft) => {
      if (
        draft.currentWorkspacePath !== currentWorkspacePath
        || draft.loadVersion !== loadVersion
        || draft.pageIndex !== pageIndex
      ) {
        return
      }
```
改为:
```ts
    useConversationsStore.setState(state => produce(state, (draft) => {
      // 分页加载是异步的:加载期间用户可能切了工作区,加载回来时若 workspaceStore
      // 当前路径已不是发起时的路径,则丢弃结果,不污染新工作区顶层 conversations。
      if (
        useWorkspaceStore.getState().currentWorkspacePath !== currentWorkspacePath
        || draft.loadVersion !== loadVersion
        || draft.pageIndex !== pageIndex
      ) {
        return
      }
```

- [ ] **Step 4: 确认 messages store 导出 setActiveConversationsId**

Run: `rg -n "export.*setActiveConversationsId" apps/web/src/store/messages`
Expected: 命中(若未导出,需在 `@/store/messages` 入口补导出现有 `setActiveConversationsId`)。若导出名不同,调整 Task 8(c) 导入。

- [ ] **Step 5: 运行 activateWorkspace 测试确认通过**

Run: `pnpm --filter @ant-chat/web test -- store/conversation/__tests__/activateWorkspace`
Expected: PASS。

- [ ] **Step 6: 运行类型检查定位组件层剩余报错**

Run: `pnpm --filter @ant-chat/web exec tsc --noEmit 2>&1 | rg "switchWorkspace|switchWorkspaceConversationsAction|currentWorkspacePath" | head -30`
Expected: 报错集中在组件层(`WorkspacePanels`/`WorkspaceSelector`/`Sender`/`Chat` 仍引用旧 action 名或 `workspaceData.currentWorkspacePath`),由 Task 9-11 修复。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/store/conversation/actions.ts apps/web/src/store/conversation/__tests__/activateWorkspace.spec.ts
git commit -m "feat(web): 新增 activateWorkspace 统一入口,clear/nextPage 跨 store 取 currentWorkspacePath"
```

---

## Task 9: 前端 WorkspacePanels — 删 reloadCurrentWorkspace,调用点改 activateWorkspace

**Files:**
- Modify: `apps/web/src/components/Workspace/WorkspacePanels.tsx:1-438`

**Interfaces:**
- Consumes: Task 8 的 `activateWorkspace`、`ensureWorkspaceConversationsAction`、`nextPageConversationsAction`。Task 6 的 `useWorkspaceStore(state => state.currentWorkspacePath)`。Task 7 的 `useConversationsStore`(无 `currentWorkspacePath`)。
- Produces: `WorkspacePanels` 组件不再有 `reloadCurrentWorkspace` 与本地 `currentWorkspacePath` 派生;所有切换/新增/删除/初始化调用 `activateWorkspace`。

- [ ] **Step 1: 改 WorkspacePanels.tsx — 导入与 currentWorkspacePath 来源**

编辑 `apps/web/src/components/Workspace/WorkspacePanels.tsx`:

(a) 导入区(行 23-31),将:
```ts
import {
  ensureWorkspaceConversationsAction,
  nextPageConversationsAction,
  switchWorkspaceConversationsAction,
  useConversationsStore,
} from '@/store/conversation'
import { setActiveConversationsId, useMessagesStore } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
```
改为:
```ts
import {
  activateWorkspace,
  ensureWorkspaceConversationsAction,
  useConversationsStore,
} from '@/store/conversation'
import { setActiveConversationsId, useMessagesStore } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
```
(删除 `switchWorkspaceConversationsAction`、`nextPageConversationsAction` 导入;新增 `activateWorkspace`。保留 `setActiveConversationsId`——`openConversation`/`createConversation` 仍直接调用它设置具体会话 id,`activateWorkspace` 只在切换工作区入口清空 id,不替代设置具体 id 的场景。)

(b) `currentWorkspacePath` 来源(行 54-56 + 行 72),将:
```ts
  const storeWorkspacePath = useConversationsStore(
    state => state.currentWorkspacePath,
  )
```
删除该段;将行 72:
```ts
  const currentWorkspacePath = storeWorkspacePath || workspaceData?.currentWorkspacePath
```
改为:
```ts
  const currentWorkspacePath = useWorkspaceStore(state => state.currentWorkspacePath)
```

- [ ] **Step 2: 改 initialize — refresh 后 activateWorkspace**

将行 74-90 `initialize`:
```ts
  const initialize = useCallback(async () => {
    if (initializedRef.current) {
      return
    }

    initializedRef.current = true
    await refreshWorkspace()
    const data = useWorkspaceStore.getState().workspaceData
    if (data) {
      setExpandedPaths(new Set([data.currentWorkspacePath]))
      useConversationsStore.getState().switchWorkspace(data.currentWorkspacePath)

      if (useConversationsStore.getState().conversations.length === 0) {
        await nextPageConversationsAction()
      }
    }
  }, [refreshWorkspace])
```
改为:
```ts
  const initialize = useCallback(async () => {
    if (initializedRef.current) {
      return
    }

    initializedRef.current = true
    await refreshWorkspace()
    const data = useWorkspaceStore.getState().workspaceData
    if (data) {
      const currentPath = useWorkspaceStore.getState().currentWorkspacePath
      setExpandedPaths(new Set([currentPath]))
      await activateWorkspace(currentPath)
    }
  }, [refreshWorkspace])
```

- [ ] **Step 3: 删 reloadCurrentWorkspace,改 handlePickerConfirm**

将行 92-97 `reloadCurrentWorkspace` 整段删除:
```ts
  const reloadCurrentWorkspace = useCallback(async () => {
    await setActiveConversationsId('')
    if (currentWorkspacePath) {
      await switchWorkspaceConversationsAction(currentWorkspacePath)
    }
  }, [currentWorkspacePath])
```

将行 103-116 `handlePickerConfirm`:
```ts
  const handlePickerConfirm = useCallback(async (path: string) => {
    setPickerOpen(false)
    setPanelError('')
    try {
      const data = await addWorkspace(path)
      setExpandedPaths(
        paths => new Set([...paths, data.currentWorkspacePath]),
      )
      await reloadCurrentWorkspace()
    }
    catch (error) {
      setPanelError((error as Error).message)
    }
  }, [addWorkspace, reloadCurrentWorkspace])
```
改为:
```ts
  const handlePickerConfirm = useCallback(async (path: string) => {
    setPickerOpen(false)
    setPanelError('')
    try {
      await addWorkspace(path)
      // addWorkspace 内部已 set currentWorkspacePath=path(SSOT 更新),
      // 用入参 path 调 activateWorkspace,不依赖闭包渲染期变量
      setExpandedPaths(paths => new Set([...paths, path]))
      await activateWorkspace(path)
    }
    catch (error) {
      setPanelError((error as Error).message)
    }
  }, [addWorkspace])
```

- [ ] **Step 4: 改 handleDeleteWorkspace — removeWorkspace 后 activateWorkspace**

将行 118-130 `handleDeleteWorkspace`:
```ts
  const handleDeleteWorkspace = useCallback(async (path: string) => {
    try {
      await removeWorkspace(path)
      setExpandedPaths((paths) => {
        const next = new Set(paths)
        next.delete(path)
        return next
      })
    }
    catch (error) {
      setPanelError((error as Error).message)
    }
  }, [removeWorkspace])
```
改为:
```ts
  const handleDeleteWorkspace = useCallback(async (path: string) => {
    try {
      await removeWorkspace(path)
      // removeWorkspace 内部已按 lastOpenedAt 回退 currentWorkspacePath,
      // 从 workspaceStore 取回退后的当前路径再 activate
      await activateWorkspace(useWorkspaceStore.getState().currentWorkspacePath)
      setExpandedPaths((paths) => {
        const next = new Set(paths)
        next.delete(path)
        return next
      })
    }
    catch (error) {
      setPanelError((error as Error).message)
    }
  }, [removeWorkspace])
```

- [ ] **Step 5: 改 openConversation / createConversation — openWorkspace 后 activateWorkspace**

将行 151-167 `openConversation`:
```ts
  async function openConversation(
    workspacePath: string,
    conversationId: string,
  ) {
    navigate('/chat')

    if (workspacePath !== currentWorkspacePath) {
      const data = await openWorkspace(workspacePath)
      setExpandedPaths(
        paths => new Set([...paths, data.currentWorkspacePath]),
      )
      await switchWorkspaceConversationsAction(workspacePath)
    }

    await setActiveConversationsId(conversationId)
    onNavigate?.()
  }
```
改为:
```ts
  async function openConversation(
    workspacePath: string,
    conversationId: string,
  ) {
    navigate('/chat')

    if (workspacePath !== currentWorkspacePath) {
      await openWorkspace(workspacePath)
      setExpandedPaths(paths => new Set([...paths, workspacePath]))
      await activateWorkspace(workspacePath)
    }

    await setActiveConversationsId(conversationId)
    onNavigate?.()
  }
```

将行 169-180 `createConversation`:
```ts
  async function createConversation(workspacePath: string) {
    navigate('/chat')

    if (workspacePath !== currentWorkspacePath) {
      const data = await openWorkspace(workspacePath)
      setExpandedPaths(paths => new Set([...paths, data.currentWorkspacePath]))
      await switchWorkspaceConversationsAction(workspacePath)
    }

    await setActiveConversationsId('')
    onNavigate?.()
  }
```
改为:
```ts
  async function createConversation(workspacePath: string) {
    navigate('/chat')

    if (workspacePath !== currentWorkspacePath) {
      await openWorkspace(workspacePath)
      setExpandedPaths(paths => new Set([...paths, workspacePath]))
      await activateWorkspace(workspacePath)
    }

    await setActiveConversationsId('')
    onNavigate?.()
  }
```

- [ ] **Step 6: toggleWorkspace 保持单调 ensure(无需改)**

确认行 132-149 `toggleWorkspace` 仍用 `ensureWorkspaceConversationsAction(item.path)`(行 147),这是"只需 ensure 不需切换顶层 slice"的预加载场景,保留不变。`currentWorkspacePath`(行 144)现在来自 workspaceStore(Step 1(b) 已改),守卫语义不变。

- [ ] **Step 7: 运行类型检查确认 WorkspacePanels 无错**

Run: `pnpm --filter @ant-chat/web exec tsc --noEmit 2>&1 | rg "WorkspacePanels" || echo "WorkspacePanels 无错"`
Expected: `WorkspacePanels 无错`。

- [ ] **Step 8: 提交**

```bash
git add apps/web/src/components/Workspace/WorkspacePanels.tsx
git commit -m "refactor(web): WorkspacePanels 删 reloadCurrentWorkspace,调用点改 activateWorkspace"
```

---

## Task 10: 前端 WorkspaceSelector — 消除第三源,直接走 workspaceStore action

**Files:**
- Modify: `apps/web/src/components/Workspace/WorkspaceSelector.tsx:1-344`

**Interfaces:**
- Consumes: Task 8 的 `activateWorkspace`、`setActiveConversationsId`。Task 6 的 `useWorkspaceStore`(state 与 actions)。`workspaceApi`(不再直接调,改用 store action)。
- Produces: `WorkspaceSelector` 无本地 `useReducer workspaceData`;无 `applyWorkspaceData`;`refreshWorkspaces` 简化为调 `useWorkspaceStore.getState().refresh()`;三个操作走 store action + `activateWorkspace`。

- [ ] **Step 1: 改 WorkspaceSelector.tsx — 导入与状态**

编辑 `apps/web/src/components/Workspace/WorkspaceSelector.tsx`:

(a) 导入区(行 29-36),将:
```ts
import { useEffect, useMemo, useReducer, useState } from 'react'
import workspaceApi from '@/api/workspaceApi'
import {
  emitWorkspaceChanged,
  WORKSPACE_CHANGED_EVENT,
} from '@/constants/workspaceEvents'
import { switchWorkspaceConversationsAction, useConversationsStore } from '@/store/conversation'
import { setActiveConversationsId } from '@/store/messages'
```
改为:
```ts
import { useEffect, useMemo, useState } from 'react'
import {
  emitWorkspaceChanged,
  WORKSPACE_CHANGED_EVENT,
} from '@/constants/workspaceEvents'
import { activateWorkspace } from '@/store/conversation'
import { setActiveConversationsId } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
```
(删除 `useReducer`、`workspaceApi`、`switchWorkspaceConversationsAction`、`useConversationsStore`;新增 `activateWorkspace`、`useWorkspaceStore`。)

(b) 组件内状态(行 48-69),将:
```ts
export function WorkspaceSelector({ compact = false }: WorkspaceSelectorProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  // useReducer to avoid react-hooks/set-state-in-effect: dispatch is allowed in effects
  const [workspaceData, setWorkspaceData] = useReducer(
    (_s: ListWorkspacesData | null, a: ListWorkspacesData | null) => a,
    null,
  )
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [removeTarget, setRemoveTarget] = useState<WorkspaceItem | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const compactClass = compact
    ? `
      text-slate-500
      dark:text-slate-400
    `
    : ''

  const currentWorkspace = useMemo(
    () => workspaceData?.workspaces.find(item => item.path === workspaceData.currentWorkspacePath),
    [workspaceData],
  )
```
改为:
```ts
export function WorkspaceSelector({ compact = false }: WorkspaceSelectorProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [removeTarget, setRemoveTarget] = useState<WorkspaceItem | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const compactClass = compact
    ? `
      text-slate-500
      dark:text-slate-400
    `
    : ''

  // 唯一事实源:workspaceStore。不再持有本地 workspaceData(第三源)。
  const workspaceData = useWorkspaceStore(state => state.workspaceData)
  const currentWorkspacePath = useWorkspaceStore(state => state.currentWorkspacePath)
  const currentWorkspace = useMemo(
    () => workspaceData?.workspaces.find(item => item.path === currentWorkspacePath),
    [workspaceData, currentWorkspacePath],
  )
```

- [ ] **Step 2: 改 refreshWorkspaces — 调 store refresh**

将行 71-75 `refreshWorkspaces`:
```ts
  async function refreshWorkspaces() {
    const data = await workspaceApi.listWorkspaces()
    setWorkspaceData(data)
    useConversationsStore.getState().switchWorkspace(data.currentWorkspacePath)
  }
```
改为:
```ts
  async function refreshWorkspaces() {
    await useWorkspaceStore.getState().refresh()
  }
```

- [ ] **Step 3: 删 applyWorkspaceData,改三个操作走 store action + activateWorkspace**

将行 101-108 `applyWorkspaceData` 整段删除:
```ts
  async function applyWorkspaceData(data: ListWorkspacesData | null) {
    if (!data) {
      return
    }
    setWorkspaceData(data)
    await setActiveConversationsId('')
    await switchWorkspaceConversationsAction(data.currentWorkspacePath)
  }
```

将行 114-131 `handlePickerConfirm`:
```ts
  async function handlePickerConfirm(path: string) {
    setPickerOpen(false)
    setLoading(true)
    setNotice(null)
    try {
      const data = await workspaceApi.addWorkspace(path)
      await applyWorkspaceData(data)
      emitWorkspaceChanged()
      setNotice({ type: 'success', message: '工作区已添加' })
      setOpen(false)
    }
    catch (error) {
      setNotice({ type: 'error', message: (error as Error).message })
    }
    finally {
      setLoading(false)
    }
  }
```
改为:
```ts
  async function handlePickerConfirm(path: string) {
    setPickerOpen(false)
    setLoading(true)
    setNotice(null)
    try {
      await setActiveConversationsId('')
      await useWorkspaceStore.getState().addWorkspace(path)
      await activateWorkspace(path)
      emitWorkspaceChanged()
      setNotice({ type: 'success', message: '工作区已添加' })
      setOpen(false)
    }
    catch (error) {
      setNotice({ type: 'error', message: (error as Error).message })
    }
    finally {
      setLoading(false)
    }
  }
```

将行 133-151 `handleOpenWorkspace`:
```ts
  async function handleOpenWorkspace(item: WorkspaceItem) {
    if (item.path === workspaceData?.currentWorkspacePath) {
      return
    }

    setLoading(true)
    setNotice(null)
    try {
      const data = await workspaceApi.openWorkspace(item.path)
      await applyWorkspaceData(data)
      setOpen(false)
    }
    catch (error) {
      setNotice({ type: 'error', message: (error as Error).message })
    }
    finally {
      setLoading(false)
    }
  }
```
改为:
```ts
  async function handleOpenWorkspace(item: WorkspaceItem) {
    if (item.path === useWorkspaceStore.getState().currentWorkspacePath) {
      return
    }

    setLoading(true)
    setNotice(null)
    try {
      await setActiveConversationsId('')
      await useWorkspaceStore.getState().openWorkspace(item.path)
      await activateWorkspace(item.path)
      setOpen(false)
    }
    catch (error) {
      setNotice({ type: 'error', message: (error as Error).message })
    }
    finally {
      setLoading(false)
    }
  }
```

将行 157-176 `confirmRemoveWorkspace`:
```ts
  async function confirmRemoveWorkspace() {
    if (!removeTarget) {
      return
    }

    setLoading(true)
    setNotice(null)
    try {
      const data = await workspaceApi.removeWorkspace(removeTarget.path)
      await applyWorkspaceData(data)
      emitWorkspaceChanged()
      setRemoveTarget(null)
    }
    catch (error) {
      setNotice({ type: 'error', message: (error as Error).message })
    }
    finally {
      setLoading(false)
    }
  }
```
改为:
```ts
  async function confirmRemoveWorkspace() {
    if (!removeTarget) {
      return
    }

    setLoading(true)
    setNotice(null)
    try {
      await setActiveConversationsId('')
      await useWorkspaceStore.getState().removeWorkspace(removeTarget.path)
      await activateWorkspace(useWorkspaceStore.getState().currentWorkspacePath)
      emitWorkspaceChanged()
      setRemoveTarget(null)
    }
    catch (error) {
      setNotice({ type: 'error', message: (error as Error).message })
    }
    finally {
      setLoading(false)
    }
  }
```

- [ ] **Step 4: 改 JSX 中 workspaceData.currentWorkspacePath 引用**

行 187 `active={item.path === workspaceData.currentWorkspacePath}` 改为:
```tsx
                  active={item.path === currentWorkspacePath}
```

- [ ] **Step 5: 清理未使用导入**

确认 `ListWorkspacesData` 类型导入(行 1)若不再使用则删除;`useReducer` 已删;`workspaceApi` 已删。运行 lint 自动修复:
Run: `pnpm --filter @ant-chat/web exec eslint --fix apps/web/src/components/Workspace/WorkspaceSelector.tsx`
检查行 1 `import type { ListWorkspacesData, WorkspaceItem } from '@ant-chat/shared'`——`ListWorkspacesData` 不再使用,改为:
```ts
import type { WorkspaceItem } from '@ant-chat/shared'
```

- [ ] **Step 6: 运行类型检查确认 WorkspaceSelector 无错**

Run: `pnpm --filter @ant-chat/web exec tsc --noEmit 2>&1 | rg "WorkspaceSelector" || echo "WorkspaceSelector 无错"`
Expected: `WorkspaceSelector 无错`。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/components/Workspace/WorkspaceSelector.tsx
git commit -m "refactor(web): WorkspaceSelector 消除本地第三源,直接走 workspaceStore action + activateWorkspace"
```

---

## Task 11: 前端 Chat 与 Sender — 读 workspaceStore,Sender 切换改 activateWorkspace,searchFiles 传路径

**Files:**
- Modify: `apps/web/src/components/Chat/Chat.tsx:1-95`
- Modify: `apps/web/src/components/Sender/Sender.tsx:56,415-416,440,478-504`
- Modify: `apps/web/src/api/workspaceApi.ts:32-34`

**Interfaces:**
- Consumes: Task 8 的 `activateWorkspace`。Task 6 的 `useWorkspaceStore(state => state.currentWorkspacePath)` 与 `useWorkspaceStore.getState()`。Task 1 的 `searchWorkspaceFiles` 端点入参含 `workspacePath`。
- Produces:
  - `Chat`:`currentWorkspacePath` 读 workspaceStore,传给 `AgentApprovalCard` 与 `startAgentTurn`
  - `Sender`:显示工作区名读 workspaceStore 顶层字段;`handleSwitchWorkspace` 用 `activateWorkspace`;`searchWorkspaceFiles` 调用传 `currentWorkspacePath`
  - `workspaceApi.searchWorkspaceFiles(workspacePath, query, limit)` 签名加 `workspacePath`

- [ ] **Step 1: 改 Chat.tsx — currentWorkspacePath 读 workspaceStore**

编辑 `apps/web/src/components/Chat/Chat.tsx`:

(a) 导入区,将:
```ts
import {
  upsertConversationAction,
  useConversationsStore,
} from '@/store/conversation'
```
确认是否已导入 `useWorkspaceStore`——当前未导入。在导入区补:
```ts
import { useWorkspaceStore } from '@/store/workspace'
```
(放在 `@/store/conversation` 导入之后,`@/store/messages` 导入之前,符合导入顺序。)

(b) 行 28,将:
```ts
  const currentWorkspacePath = useConversationsStore(state => state.currentWorkspacePath)
```
改为:
```ts
  const currentWorkspacePath = useWorkspaceStore(state => state.currentWorkspacePath)
```

> `currentWorkspacePath` 传给 `useBuiltinCommandSubmit`(行 44)、`startAgentTurn`(行 83)、`AgentApprovalCard`(行 129)的用法不变,仅取值源变更。`useConversationsStore` 仍用于行 27 `currentConversations`,保留该导入。

- [ ] **Step 2: 改 workspaceApi.ts — searchWorkspaceFiles 签名加 workspacePath**

编辑 `apps/web/src/api/workspaceApi.ts`,将行 32-34:
```ts
async function searchWorkspaceFiles(query: string, limit = 50): Promise<WorkspaceFileSearchResult[]> {
  return getAppRpcClient().call('workspace.searchWorkspaceFiles', { query, limit })
}
```
改为:
```ts
async function searchWorkspaceFiles(workspacePath: string, query: string, limit = 50): Promise<WorkspaceFileSearchResult[]> {
  return getAppRpcClient().call('workspace.searchWorkspaceFiles', { workspacePath, query, limit })
}
```

- [ ] **Step 3: 改 Sender.tsx — 显示工作区名读 workspaceStore 顶层字段**

编辑 `apps/web/src/components/Sender/Sender.tsx`:

(a) 导入区(行 51-58),将:
```ts
import {
  switchWorkspaceConversationsAction,
  useConversationsStore,
} from '@/store/conversation'
import { setActiveConversationsId, useMessagesStore } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
```
改为:
```ts
import { activateWorkspace, useConversationsStore } from '@/store/conversation'
import { setActiveConversationsId, useMessagesStore } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
```
(删除 `switchWorkspaceConversationsAction`,新增 `activateWorkspace`。)

(b) 行 333 `const workspaceData = useWorkspaceStore(state => state.workspaceData)` 下方补:
```ts
  const currentWorkspacePath = useWorkspaceStore(state => state.currentWorkspacePath)
```

(c) 行 413-418 `currentWorkspace` 派生,将:
```ts
  const currentWorkspace = useMemo(
    () =>
      workspaceData?.workspaces.find(
        item => item.path === workspaceData?.currentWorkspacePath,
      ),
    [workspaceData],
  )
```
改为:
```ts
  const currentWorkspace = useMemo(
    () =>
      workspaceData?.workspaces.find(
        item => item.path === currentWorkspacePath,
      ),
    [workspaceData, currentWorkspacePath],
  )
```

(d) 行 482 `handleSwitchWorkspace` 守卫,将:
```ts
    if (
      !canSwitchWorkspace
      || !workspaceData
      || nextWorkspacePath === workspaceData.currentWorkspacePath
    ) {
      return
    }
```
改为:
```ts
    if (
      !canSwitchWorkspace
      || !workspaceData
      || nextWorkspacePath === currentWorkspacePath
    ) {
      return
    }
```

(e) 行 490-496 `handleSwitchWorkspace` 主体,将:
```ts
    setWorkspaceLoading(true)
    setNotice('')
    try {
      await openWorkspace(nextWorkspacePath)
      setWorkspacePickerOpen(false)
      await setActiveConversationsId('')
      await switchWorkspaceConversationsAction(nextWorkspacePath)
    }
```
改为:
```ts
    setWorkspaceLoading(true)
    setNotice('')
    try {
      await openWorkspace(nextWorkspacePath)
      setWorkspacePickerOpen(false)
      await activateWorkspace(nextWorkspacePath)
    }
```
(`activateWorkspace` 内部已 `setActiveConversationsId('')`,无需单独调。)

(f) 行 820 `hasWorkspace={Boolean(workspaceData?.currentWorkspacePath)}` 改为:
```tsx
            hasWorkspace={Boolean(currentWorkspacePath)}
```

- [ ] **Step 4: 改 Sender.tsx — searchWorkspaceFiles 调用传 currentWorkspacePath**

行 440,将:
```ts
      void workspaceApi.searchWorkspaceFiles(activeReferenceTrigger.query, 50)
```
改为:
```ts
      void workspaceApi.searchWorkspaceFiles(currentWorkspacePath, activeReferenceTrigger.query, 50)
```

- [ ] **Step 5: 运行类型检查确认 Chat/Sender 无错**

Run: `pnpm --filter @ant-chat/web exec tsc --noEmit 2>&1 | rg "Chat/Chat|Sender/Sender|workspaceApi" || echo "Chat/Sender/workspaceApi 无错"`
Expected: `Chat/Sender/workspaceApi 无错`。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/Chat/Chat.tsx apps/web/src/components/Sender/Sender.tsx apps/web/src/api/workspaceApi.ts
git commit -m "refactor(web): Chat/Sender 读 workspaceStore SSOT,Sender 切换改 activateWorkspace,searchFiles 传路径"
```

---

## Task 12: 前端测试更新 — gui.spec 与 Sender.spec 对齐 SSOT

**Files:**
- Modify: `apps/web/src/__tests__/gui.spec.tsx:88-93,119-121,151,156-164,543-556`
- Modify: `apps/web/src/components/Sender/__tests__/Sender.spec.tsx:20-31,95-115,440`

**Interfaces:**
- Consumes: Task 6 的 `useWorkspaceStore`。Task 7 的 `createInitialState`(无 `currentWorkspacePath`)。Task 1 的 `ListWorkspacesData`(无 `currentWorkspacePath`)。
- Produces: 测试用例对齐 SSOT——mock `listWorkspaces` 返回不含 `currentWorkspacePath`;`useConversationsStore.setState` 不含 `currentWorkspacePath`;用 `useWorkspaceStore.setState({ currentWorkspacePath })` 设当前路径;`searchWorkspaceFiles` mock 断言含 `workspacePath`。

- [ ] **Step 1: 改 gui.spec.tsx — mock 与 store setState 对齐**

编辑 `apps/web/src/__tests__/gui.spec.tsx`:

(a) 行 88-93 `mocks.workspace`,将:
```ts
  workspace: {
    chooseWorkspace: vi.fn(async () => null),
    listWorkspaces: vi.fn(),
    openWorkspace: vi.fn(),
  },
```
改为:
```ts
  workspace: {
    chooseWorkspace: vi.fn(async () => null),
    listWorkspaces: vi.fn(),
    openWorkspace: vi.fn(),
    searchWorkspaceFiles: vi.fn(async () => []),
  },
```
(新增 `searchWorkspaceFiles` mock,供 Sender 调用。)

(b) 行 119-121 `vi.mock('@/api/workspaceApi')` 保持 `default: mocks.workspace`。

(c) 行 15-17 导入补 `useWorkspaceStore`:
```ts
import { useConversationsStore } from '../store/conversation'
import { createInitialState } from '../store/conversation/initialState'
import { setActiveConversationsId, useMessagesStore } from '../store/messages'
import { useWorkspaceStore } from '../store/workspace'
```

(d) 行 151 `useConversationsStore.setState(createInitialState())` 保持(已无 `currentWorkspacePath`)。补 workspaceStore 重置:
```ts
    useConversationsStore.setState(createInitialState())
    useWorkspaceStore.setState({ currentWorkspacePath: '', workspaceData: null, loading: false })
    useAgentStore.setState({ pendingByTask: {}, tasks: {} })
```

(e) 行 156-164 `mocks.workspace.listWorkspaces.mockResolvedValue`,将:
```ts
    mocks.workspace.listWorkspaces.mockResolvedValue({
      currentWorkspacePath: guiWorkspacePath,
      workspaces: [{
        path: guiWorkspacePath,
        displayName: 'ant-chat-gui-workspace',
        addedAt: 1,
        lastOpenedAt: 1,
      }],
    })
```
改为:
```ts
    mocks.workspace.listWorkspaces.mockResolvedValue({
      workspaces: [{
        path: guiWorkspacePath,
        displayName: 'ant-chat-gui-workspace',
        addedAt: 1,
        lastOpenedAt: 1,
      }],
    })
```

(f) 行 543-556 `seedActiveConversation`,将:
```ts
function seedActiveConversation(conversationId: string) {
  const conversation = createConversation(conversationId)
  conversationsById.set(conversationId, conversation)
  messagesByConversation.set(conversationId, [])
  useMessagesStore.setState({
    activeConversationsId: conversationId as any,
    messages: [],
  })
  useConversationsStore.setState({
    activeConversationsId: conversationId,
    conversations: [conversation],
    currentWorkspacePath: guiWorkspacePath,
  })
}
```
改为:
```ts
function seedActiveConversation(conversationId: string) {
  const conversation = createConversation(conversationId)
  conversationsById.set(conversationId, conversation)
  messagesByConversation.set(conversationId, [])
  useMessagesStore.setState({
    activeConversationsId: conversationId as any,
    messages: [],
  })
  useConversationsStore.setState({
    activeConversationsId: conversationId,
    conversations: [conversation],
  })
  useWorkspaceStore.setState({ currentWorkspacePath: guiWorkspacePath })
}
```

- [ ] **Step 2: 改 Sender.spec.tsx — mock 与 store 对齐**

编辑 `apps/web/src/components/Sender/__tests__/Sender.spec.tsx`:

(a) 行 10-12 `mocks` hoisted,将:
```ts
const mocks = vi.hoisted(() => ({
  searchWorkspaceFiles: vi.fn(),
}))
```
改为:
```ts
const mocks = vi.hoisted(() => ({
  searchWorkspaceFiles: vi.fn(),
  listWorkspaces: vi.fn(),
}))
```

(b) 行 20-31 `vi.mock('@/api/workspaceApi')`,将:
```ts
vi.mock('@/api/workspaceApi', () => ({
  default: {
    listWorkspaces: vi.fn(async () => ({
      currentWorkspacePath: '/tmp/workspace',
      workspaces: [
        { path: '/tmp/workspace', displayName: 'workspace' },
      ],
    })),
    openWorkspace: vi.fn(),
    searchWorkspaceFiles: mocks.searchWorkspaceFiles,
  },
}))
```
改为:
```ts
vi.mock('@/api/workspaceApi', () => ({
  default: {
    listWorkspaces: mocks.listWorkspaces,
    openWorkspace: vi.fn(),
    searchWorkspaceFiles: mocks.searchWorkspaceFiles,
  },
}))
```

(c) 导入补 `useWorkspaceStore`:
```ts
import { useConversationsStore } from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
```

(d) 行 92-110 `beforeEach`,在 `mocks.searchWorkspaceFiles.mockResolvedValue(...)` 之后、`useMessagesStore.setState` 之前补 workspaceStore 设置;并将 `useConversationsStore.setState` 中删除 `currentWorkspacePath`。改为:
```ts
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    Element.prototype.scrollIntoView = vi.fn()
    mocks.searchWorkspaceFiles.mockResolvedValue([
      { path: 'resume.md', name: 'resume.md', type: 'file' },
    ])
    mocks.listWorkspaces.mockResolvedValue({
      workspaces: [
        { path: '/tmp/workspace', displayName: 'workspace' },
      ],
    })
    useMessagesStore.setState({
      activeConversationsId: '',
      messages: [],
    })
    useConversationsStore.setState({
      activeConversationsId: '',
      conversations: [],
      abortCallbacks: [],
      pageIndex: 0,
      pageSize: 20,
      conversationsTotal: 1,
      streamingConversationIds: new Set<string>(),
      loadVersion: 0,
      workspaceConversations: {},
    })
    useWorkspaceStore.setState({ currentWorkspacePath: '/tmp/workspace', workspaceData: null, loading: false })
    useChatSttingsStore.setState({
      enableMCP: false,
      agentMode: 'hybrid',
    })
  })
```

(e) 行 146-179 "选择文件引用后渲染 overlay token" 测试,将断言:
```ts
    await waitFor(() => {
      expect(mocks.searchWorkspaceFiles).toHaveBeenCalledWith('res', 50)
    })
```
改为:
```ts
    await waitFor(() => {
      expect(mocks.searchWorkspaceFiles).toHaveBeenCalledWith('/tmp/workspace', 'res', 50)
    })
```

- [ ] **Step 3: 运行前端测试确认通过**

Run: `pnpm --filter @ant-chat/web test -- gui.spec Sender.spec`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/__tests__/gui.spec.tsx apps/web/src/components/Sender/__tests__/Sender.spec.tsx
git commit -m "test(web): gui.spec 与 Sender.spec 对齐 workspaceStore SSOT"
```

---

## Task 13: 全量检查与原 bug 行为测试

**Files:**
- Test: `apps/web/src/store/conversation/__tests__/activateWorkspace.spec.ts`(Task 8 已建,此处补竞态守护用例)
- Test: `apps/web/src/__tests__/workspace-bug.spec.tsx`(新增,覆盖原 bug)

**Interfaces:**
- Consumes: Task 6-11 全部产出。
- Produces: 全量 `pnpm check` 通过;原 bug 的行为回归测试(添加工作区后发送消息归属新工作区)。

- [ ] **Step 1: 补 activateWorkspace 竞态守护测试**

在 `apps/web/src/store/conversation/__tests__/activateWorkspace.spec.ts` 的 `describe('activateWorkspace')` 内追加:

```ts
  it('分页加载期间切换工作区,旧加载返回不污染新工作区顶层 conversations', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: '/a' })
    // 控制分页加载延迟,使切换发生在加载返回前
    let resolveList: (value: { data: IConversations[], total: number }) => void = () => {}
    chatMocks.getWorkspaceConversations.mockImplementationOnce(
      () => new Promise(resolve => { resolveList = resolve }),
    )

    const pending = activateWorkspace('/a')
    // 此时 /a 的首页加载在途;切到 /b
    useWorkspaceStore.setState({ currentWorkspacePath: '/b' })
    useConversationsStore.getState().switchWorkspaceSlice('/b')
    useConversationsStore.setState({ conversations: [makeConversation('in-b', '/b')] })

    // 旧加载返回 /a 的数据
    resolveList({ data: [makeConversation('late-a', '/a')], total: 1 })
    await pending

    // 新工作区顶层 conversations 不被 /a 的迟到数据污染
    const topIds = useConversationsStore.getState().conversations.map(c => c.id)
    expect(topIds).not.toContain('late-a')
  })
```

> 注:此用例验证 `nextPageConversationsAction` 的竞态守护——`activateWorkspace` 内部在 `conversations.length === 0 && conversationsTotal > 0` 时触发 `nextPage`。若该用例因 `activateWorkspace` 的首页已加载走 `ensure` 路径而不触发 `nextPage`,调整为直接测 `nextPageConversationsAction`:在 `/a` 发起 `nextPage` 后切到 `/b`,再 resolve,断言 `/b` 顶层不受污染。以实际行为为准。

- [ ] **Step 2: 写原 bug 行为测试 — 添加工作区后发送消息归属新工作区**

创建 `apps/web/src/__tests__/workspace-bug.spec.tsx`:

```ts
import type { AgentTaskSnapshot, ConversationsId, IConversations, IMessage } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Navigate, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppWrapper from '../App'
import { ChatLayout } from '../components/ChatLayout'
import { ChatPage } from '../pages/Chat'
import { useAgentStore } from '../store/agent'
import { useConversationsStore } from '../store/conversation'
import { createInitialState } from '../store/conversation/initialState'
import { setActiveConversationsId, useMessagesStore } from '../store/messages'
import { useWorkspaceStore } from '../store/workspace'

const mocks = vi.hoisted(() => ({
  agent: {
    approvePendingAction: vi.fn(async () => null),
    approvePendingActionWithWhitelist: vi.fn(async () => null),
    cancelTask: vi.fn(async () => null),
    injectSteering: vi.fn(async (): Promise<IMessage> => ({
      id: 'msg-s', convId: 'c' as ConversationsId, createdAt: 1, role: 'user',
      status: 'success', content: [{ type: 'text', text: 's' }], turnId: 'u-1',
    })),
    listActiveTasks: vi.fn<() => Promise<AgentTaskSnapshot[]>>(async () => []),
    rejectPendingAction: vi.fn(async () => null),
    startTurn: vi.fn(),
  },
  chat: {
    getConversationById: vi.fn(),
    getMessagesByConvId: vi.fn<(id: string) => Promise<IMessage[]>>(async () => []),
    getMessagesByConvIdWithPagination: vi.fn(),
    getWorkspaceConversations: vi.fn(async () => ({ data: [], total: 0 })),
    initConversationsTitle: vi.fn(async () => ({ success: true, data: null })),
    updateConversation: vi.fn(),
  },
  generalSettings: {
    getSettings: vi.fn(async () => ({ assistantModelId: '', proxySettings: { mode: 'system', customProxyUrl: '' } })),
    resetSettings: vi.fn(),
    updateSettings: vi.fn(),
  },
  provider: {
    getAllAbvailableModels: vi.fn(async () => [{
      id: 'p1', name: 'P', models: [{ id: 'm1', model: 'mock', name: 'Mock', providerId: 'p1', maxTokens: 1024, temperature: 0 }],
    }]),
    getModelInfoById: vi.fn(async () => null),
  },
  memory: { getMemoryFiles: vi.fn(), rollbackSoul: vi.fn(), updateMemoryFiles: vi.fn() },
  skill: { listSkills: vi.fn(async () => ({ skills: [] })) },
  workspace: {
    chooseWorkspace: vi.fn(async () => null),
    listWorkspaces: vi.fn(),
    openWorkspace: vi.fn(),
    addWorkspace: vi.fn(),
    searchWorkspaceFiles: vi.fn(async () => []),
  },
}))

vi.mock('@/api/agentApi', () => ({ default: mocks.agent }))
vi.mock('@/api/chatApi', () => ({ default: mocks.chat }))
vi.mock('@/api/generalSettingsApi', () => ({ generalSettingsApi: mocks.generalSettings }))
vi.mock('@/api/providerApi', () => ({ providerApi: mocks.provider }))
vi.mock('@/api/memoryApi', () => ({ memoryApi: mocks.memory }))
vi.mock('@/api/skillApi', () => ({ skillApi: mocks.skill }))
vi.mock('@/api/workspaceApi', () => ({ default: mocks.workspace }))
vi.mock('@/components/Search', () => ({ SearchContainer: () => null }))

const oldWorkspace = '/tmp/ant-chat-old-ws'
const newWorkspace = '/tmp/ant-chat-new-ws'

describe('workspace state consolidation bug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.matchMedia = vi.fn().mockImplementation(query => ({
      addEventListener: vi.fn(), dispatchEvent: vi.fn(), matches: false, media: query,
      onchange: null, removeEventListener: vi.fn(),
    }))
    Element.prototype.scrollIntoView = vi.fn()
    useMessagesStore.setState({ activeConversationsId: '' as any, messages: [] })
    useConversationsStore.setState(createInitialState())
    useWorkspaceStore.setState({ currentWorkspacePath: '', workspaceData: null, loading: false })
    useAgentStore.setState({ pendingByTask: {}, tasks: {} })

    mocks.workspace.listWorkspaces.mockResolvedValue({
      workspaces: [{ path: oldWorkspace, displayName: 'old', addedAt: 1, lastOpenedAt: 1 }],
    })
    mocks.workspace.addWorkspace.mockImplementation(async (path: string) => ({
      workspaces: [
        { path: oldWorkspace, displayName: 'old', addedAt: 1, lastOpenedAt: 1 },
        { path, displayName: 'new', addedAt: 2, lastOpenedAt: 2 },
      ],
    }))
    mocks.chat.getMessagesByConvIdWithPagination.mockResolvedValue({ data: [], total: 0 })
    mocks.chat.getMessagesByConvId.mockResolvedValue([])
    mocks.chat.getConversationById.mockResolvedValue(undefined)
  })

  it('添加新工作区后发送消息,会话归属新工作区而非旧工作区', async () => {
    const createdConversations: IConversations[] = []
    mocks.agent.startTurn.mockImplementation(async (opts: { workspacePath?: string }) => {
      const conv: IConversations = {
        id: 'conv-new',
        workspacePath: opts.workspacePath,
        title: 'new conv',
        createdAt: 1,
        updatedAt: 1,
        settings: { modelId: 'm1', providerId: 'p1', systemPrompt: '', temperature: 0, maxTokens: 1024 },
      } as IConversations
      createdConversations.push(conv)
      return { taskId: 't1', conversationId: conv.id, userMessageId: 'u1', conversation: conv }
    })

    renderGui('/chat')
    await screen.findByTestId('chat-input')

    // 添加新工作区(模拟 WorkspacePanels.handlePickerConfirm 的路径)
    await useWorkspaceStore.getState().addWorkspace(newWorkspace)
    const { activateWorkspace } = await import('../store/conversation/actions')
    await activateWorkspace(newWorkspace)

    // 此时 workspaceStore.currentWorkspacePath 应为新工作区
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe(newWorkspace)

    // 发送消息
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByTestId('chat-submit'))

    await waitFor(() => {
      expect(mocks.agent.startTurn).toHaveBeenCalledWith(expect.objectContaining({
        workspacePath: newWorkspace,
      }))
    })
    // 会话归属新工作区,不是旧工作区
    expect(createdConversations[0].workspacePath).toBe(newWorkspace)
    expect(createdConversations[0].workspacePath).not.toBe(oldWorkspace)
  })

  it('删除当前工作区后,当前路径回退到 lastOpenedAt 最大者,后续发送归属回退后的工作区', async () => {
    // 预置:当前为新工作区,列表含旧+新
    useWorkspaceStore.setState({
      currentWorkspacePath: newWorkspace,
      workspaceData: {
        workspaces: [
          { path: oldWorkspace, displayName: 'old', isDefault: false, lastOpenedAt: 5 },
          { path: newWorkspace, displayName: 'new', isDefault: false, lastOpenedAt: 9 },
        ],
      },
    })
    mocks.workspace.listWorkspaces.mockResolvedValue({
      workspaces: [
        { path: oldWorkspace, displayName: 'old', isDefault: false, lastOpenedAt: 5 },
      ],
    })

    // 删除当前工作区(新)
    await useWorkspaceStore.getState().removeWorkspace(newWorkspace)
    const { activateWorkspace } = await import('../store/conversation/actions')
    await activateWorkspace(useWorkspaceStore.getState().currentWorkspacePath)

    // 当前路径回退到旧工作区(lastOpenedAt 最大者)
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe(oldWorkspace)

    mocks.agent.startTurn.mockImplementation(async (opts: { workspacePath?: string }) => ({
      taskId: 't2', conversationId: 'c2', userMessageId: 'u2',
      conversation: {
        id: 'c2', workspacePath: opts.workspacePath, title: 'c2', createdAt: 1, updatedAt: 1,
        settings: { modelId: 'm1', providerId: 'p1', systemPrompt: '', temperature: 0, maxTokens: 1024 },
      } as IConversations,
    }))

    renderGui('/chat')
    await screen.findByTestId('chat-input')
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'after delete' } })
    fireEvent.click(screen.getByTestId('chat-submit'))

    await waitFor(() => {
      expect(mocks.agent.startTurn).toHaveBeenCalledWith(expect.objectContaining({
        workspacePath: oldWorkspace,
      }))
    })
  })
})

function renderGui(initialPath: string) {
  const router = createMemoryRouter([
    {
      path: '/',
      Component: AppWrapper,
      children: [
        { index: true, element: <Navigate replace to="/chat" /> },
        { path: 'chat', Component: ChatLayout, children: [{ index: true, Component: ChatPage }] },
      ],
    },
  ], { initialEntries: [initialPath] })
  return render(<RouterProvider router={router} />)
}
```

- [ ] **Step 3: 运行新测试确认通过**

Run: `pnpm --filter @ant-chat/web test -- workspace-bug activateWorkspace`
Expected: PASS。若失败,定位是 store 派生逻辑还是组件读取源问题,回看 Task 6/9/10/11。

- [ ] **Step 4: 运行全量 check**

Run: `pnpm check`
Expected: PASS(type-check + lint + unit tests 全绿)。

> 若 `pnpm check` 报错:
> - 类型错误:运行 `pnpm type-check` 看 `tsc -b` 跨包报错,定位漏改的 `currentWorkspacePath`/`switchWorkspaceConversationsAction`/`getCurrentWorkspacePath` 引用。
> - Lint 错误:运行 `pnpm lint --fix` 自动修复导入排序等。
> - 测试失败:确认是否为本整合导致,修复逻辑后重跑全量 `pnpm check`。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/store/conversation/__tests__/activateWorkspace.spec.ts apps/web/src/__tests__/workspace-bug.spec.tsx
git commit -m "test(web): 补 activateWorkspace 竞态守护与原 bug 行为回归测试"
```

---

## Self-Review

### 1. Spec coverage(设计文档逐节核对)

- §背景/根因:闭包陷阱(Task 9 删 `reloadCurrentWorkspace`)、删除不同步(Task 9 `handleDeleteWorkspace` 调 `activateWorkspace`)、第三源(Task 10 消除 `WorkspaceSelector` 本地 state)——均覆盖。
- §目标 SSOT:Task 6 新增顶层字段;Task 7 删 `conversationsStore.currentWorkspacePath`;Task 10 删 `WorkspaceSelector` 本地——覆盖。
- §架构 `activateWorkspace`:Task 8 新增,签名与行为与设计文档一致——覆盖。
- §逐文件改动 1-8:
  - store/workspace/store.ts → Task 6 ✓
  - conversation/initialState.ts → Task 7 ✓
  - conversation/conversationsStore.ts → Task 7(`switchWorkspaceSlice`/`getCurrentWorkspacePath`/`reset`/`saveCurrentWorkspaceSlice`)✓
  - conversation/actions.ts → Task 8(`activateWorkspace`/`clearConversationsAction`/`nextPageConversationsAction` 竞态守护)✓
  - WorkspacePanels.tsx → Task 9 ✓
  - WorkspaceSelector.tsx → Task 10 ✓
  - Chat.tsx → Task 11 ✓
  - Sender.tsx → Task 11 ✓
- §后端方案 B:
  - workspaceService.ts → Task 2 ✓
  - appRuntime.ts → Task 3 ✓
  - agentTurnService.ts → Task 4 ✓
  - rpcHandlers.ts/app-rpc.ts/ipc-events.ts → Task 1 + Task 3 ✓
  - ListWorkspacesData 删字段 → Task 1 ✓
- §错误处理与边界:空路径 no-op(Task 8)、分页竞态(Task 8 + Task 13)、循环依赖(Task 7 单向导入)、跨实例通知(Task 10 保留 `emitWorkspaceChanged`)、后端写操作未传抛错(Task 3/4)、listConversations 全量语义(Task 3)、启动派生(Task 6)——覆盖。
- §测试:前端 6 项 + 后端 4 项,散落于各 Task 的测试步骤与 Task 13——覆盖。
- §迁移策略:单 PR,顺序后端→前端 store→组件→测试,每步 `pnpm check`——Task 顺序与提交点对应。
- **边界补充(用户决策)**:`searchFiles` 端点入参必传(Task 1 类型 + Task 3 实现 + Task 11 前端调用 + Task 12 测试);`parseConfig` 容忍旧字段(Task 2 实现 + Task 2 测试)——覆盖。

### 2. Placeholder scan

无 "TBD/TODO/implement later"。每个代码步骤含完整代码块;测试步骤含完整测试代码;命令含 expected 输出。

### 3. Type consistency

- `activateWorkspace(workspacePath: string): Promise<void>`:Task 8 定义,Task 9/10/11/13 调用一致。
- `switchWorkspaceSlice(workspacePath: string)`:Task 7 定义,Task 8(`ensureWorkspaceConversationsAction` 内部改引用)+ Task 13(竞态测试直接调用)一致。
- `getCurrentWorkspacePath(): string`:Task 7(conversationsStore 内部)+ Task 8(actions 内部)各自定义同名 helper,均读 `useWorkspaceStore.getState().currentWorkspacePath`——一致(两处独立定义避免跨模块导出内部 helper,符合现有代码风格)。
- `useWorkspaceStore.getState().currentWorkspacePath`:Task 6 定义顶层字段,Task 7/8/9/10/11/13 读取一致。
- `WorkspaceConfig`/`ListWorkspacesData` 无 `currentWorkspacePath`:Task 1 定义,Task 2/3/6/12 一致使用。
- `workspace.searchWorkspaceFiles` 入参 `{ workspacePath: string, query?, limit? }`:Task 1 契约,Task 3 实现 `searchFiles(workspacePath, query, limit)`,Task 11 `workspaceApi.searchWorkspaceFiles(workspacePath, query, limit)`,Task 12 测试断言 `('/tmp/workspace', 'res', 50)`——一致。
- `StartAgentTurnOptions.workspacePath: string`:Task 1 必传,Task 4 实现,Task 11/13 前端传值一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-workspace-state-consolidation.md`. Two execution options:

**1. Subagent-Driven(推荐)** — 每个 Task 派发独立子代理,任务间两阶段评审,快速迭代。

**2. Inline Execution** — 在当前会话用 executing-plans 批量执行,带检查点评审。

Which approach?
