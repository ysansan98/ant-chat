# 工作区状态源整合设计

## 背景与问题

web 端存在一个 bug:在左侧工作区面板添加新工作区后,Sender 中显示的是新工作区,但发送消息时会话却归属到之前的工作区。即「Sender 显示的工作区」与「会话实际归属的工作区」不一致。

### 根因

「当前工作区路径」在 web 端被 **三处** 独立持有,彼此靠手动成对调用来维系同步,存在多个缺口:

| 持有者 | 性质 | 用途 |
|---|---|---|
| `useWorkspaceStore.workspaceData.currentWorkspacePath` | zustand 全局 store | Sender 显示、WorkspacePanels 列表渲染 |
| `useConversationsStore.currentWorkspacePath` | zustand 全局 store | 发送消息归属、分片缓存 key、分页加载竞态守护 |
| `WorkspaceSelector` 的 `useReducer` 本地 `workspaceData` | 组件本地 state,完全绕开两个全局 store | `ConversationsManage` 头部的工作区选择器 |

具体缺口:

1. **闭包陷阱(触发本 bug 的直接原因)**:`WorkspacePanels.handlePickerConfirm`(`apps/web/src/components/Workspace/WorkspacePanels.tsx:103-116`)在 `await addWorkspace(path)` 后调用 `reloadCurrentWorkspace()`(`WorkspacePanels.tsx:92-97`)。`reloadCurrentWorkspace` 是依赖 `[currentWorkspacePath]` 的 `useCallback`,而 `currentWorkspacePath`(`WorkspacePanels.tsx:72`)是渲染期派生值。`addWorkspace` 内部 `useWorkspaceStore.setState` 触发的重渲染要等下一次渲染周期才让 `currentWorkspacePath` 生效,但 `handlePickerConfirm` 在同一执行流里紧接着调用 `reloadCurrentWorkspace()`,此时闭包捕获的仍是旧渲染周期的 `currentWorkspacePath`(原工作区路径)。于是 `switchWorkspaceConversationsAction(旧路径)` 把 `conversationsStore.currentWorkspacePath` 固化在旧工作区,而 `workspaceStore` 已切到新工作区 → 显示与归属脱节。发送时 `Chat.tsx:83` 用 `conversationsStore` 的旧路径,新会话归属旧工作区。

2. **删除工作区不同步**:`WorkspacePanels.handleDeleteWorkspace`(`WorkspacePanels.tsx:118-130`)调 `removeWorkspace` 更新了 workspaceStore,但**不调** `switchWorkspaceConversationsAction`。若删的恰是当前工作区,后端会把 `currentWorkspacePath` 回退到默认工作区,但 conversationsStore 停在已删除的工作区路径上。

3. **WorkspaceSelector 是第三源**:`WorkspaceSelector.tsx` 自带本地 `useReducer workspaceData`(`WorkspaceSelector.tsx:52`),与两个全局 store 并存。`refreshWorkspaces`(`WorkspaceSelector.tsx:71-75`)只更新本地 + conversationsStore,**不回写 workspaceStore**,靠 `emitWorkspaceChanged` 间接触发全局 refresh 来兜底对齐。本质是三源用事件互相补,结构脆弱。`WorkspaceSelector` 挂载于 `ConversationsManage`(`ConversationsManage.tsx:67`),`WorkspacePanels` 挂载于 `SiliderMenu`(`SiliderMenu.tsx:74`),两者并存于不同视图。

### 反证对照

Sender 的「切换工作区」路径(`Sender.tsx:493-496`)用入参 `nextWorkspacePath` 而非闭包变量调 `switchWorkspaceConversationsAction`,所以切换不报 bug。这印证根因是闭包陷阱,且说明「用 action 返回值/入参而非渲染期闭包变量」是正确范式。

## 目标

以 `useWorkspaceStore.workspaceData.currentWorkspacePath` 为唯一事实源(SSOT)。删除 `conversationsStore.currentWorkspacePath` 字段,删除 `WorkspaceSelector` 的本地 `workspaceData`。所有需要「当前工作区」的读写统一从 workspaceStore 取。`conversationsStore` 的分片缓存 `workspaceConversations: Record<path, Slice>` 保留,但其 save/restore 用的 key 改为跨 store 从 workspaceStore 读取。

整合后,显示(Sender 读 workspaceStore)与归属(Chat 读 workspaceStore)天然一致,因为只剩一个源;闭包陷阱、删除不同步、第三源三个缺口一并消除。

## 架构

```
useWorkspaceStore  ← 唯一事实源(SSOT)
  .workspaceData.currentWorkspacePath   写入:增/删/切/refresh
  .workspaceData.workspaces             工作区列表

useConversationsStore  ← 不再持有 currentWorkspacePath
  .workspaceConversations: Record<path, Slice>   分片缓存,key 来自 workspaceStore
  .conversations / pageIndex / conversationsTotal / loadVersion   顶层=当前工作区 slice 的投影
  需要「当前 path」时 → useWorkspaceStore.getState().workspaceData.currentWorkspacePath
```

### 写入收口:统一入口 `activateWorkspace`

新增统一入口封装「workspaceStore 已更新当前路径后,同步会话分片缓存到该路径」的成对操作。所有切换/新增/删除场景调用此入口,避免手动拼装 `ensure + switch` 导致的遗漏与闭包陷阱。

```ts
/**
 * 统一的工作区激活入口:在 workspaceStore 已更新当前路径后,
 * 同步会话分片缓存到该路径。所有切换/新增/删除场景调用此入口,
 * 避免手动拼装 ensure+switch 导致的遗漏与闭包陷阱。
 */
export async function activateWorkspace(workspacePath: string): Promise<void>
```

- **入参**:目标工作区绝对路径。由调用方从 workspaceStore action 的返回值(`data.currentWorkspacePath`)或 `item.path` 传入,**不依赖任何闭包渲染期变量**。
- **行为**:空路径 → 仅 `setActiveConversationsId('')`;非空 → `ensureWorkspaceConversationsAction(path)` + `switchWorkspaceSlice(path)` + 必要时 `nextPageConversationsAction()` 补加载首页。
- **返回**:无返回值。调用方需要 `ListWorkspacesData` 时从 workspaceStore action 的返回值拿。
- **幂等**:目标路径已是当前路径时,`switchWorkspaceSlice` 内部 no-op,`ensureWorkspaceConversationsAction` 内部有 `loaded` 守卫,安全。

## 数据流(以「添加工作区」为例)

修复前(bug):

```
addWorkspace(path) → workspaceStore 切新
reloadCurrentWorkspace() → 用闭包旧 path → switchWorkspaceConversationsAction(旧path)
→ conversationsStore 停在旧工作区 ❌
```

修复后:

```
handlePickerConfirm(path):
  data = await addWorkspace(path)                      // workspaceStore 切新(SSOT 更新)
  await activateWorkspace(data.currentWorkspacePath)   // 用返回值,不依赖闭包
    → ensureWorkspaceConversationsAction(path)
    → switchWorkspaceSlice(path)                       // 只做分片 save/restore,不写 currentWorkspacePath
```

显示(Sender 读 workspaceStore)与归属(Chat 读 workspaceStore)天然一致。

## 逐文件改动

### 1. `store/workspace/store.ts`(SSOT,代码不变)

workspaceStore 保持四个 action(`refresh`/`openWorkspace`/`addWorkspace`/`removeWorkspace`)各自 `set({ workspaceData: data })`。承担 SSOT 角色,**代码不改**。

### 2. `store/conversation/initialState.ts` — 删除字段

- `StoreState` 删除 `currentWorkspacePath: string`。
- `createInitialState` 删除 `currentWorkspacePath: ''`。
- `workspaceConversations: Record<string, WorkspaceConversationsState>` 保留。

### 3. `store/conversation/conversationsStore.ts` — key 来源跨 store

新增内部 helper:

```ts
function getCurrentWorkspacePath(): string {
  return useWorkspaceStore.getState().workspaceData?.currentWorkspacePath ?? ''
}
```

- `switchWorkspace(path)` 重命名为 `switchWorkspaceSlice(path)`:
  - no-op 守卫 `workspacePath === state.currentWorkspacePath` 改为 `workspacePath === getCurrentWorkspacePath()`。
  - save 旧分片时 key 用 `getCurrentWorkspacePath()`(旧路径),restore 新分片 key 用入参 `path`。
  - 不再 set `currentWorkspacePath`。
- `saveCurrentWorkspaceSlice`:key 从 `getCurrentWorkspacePath()` 取,空则 return。
- `reset`:原在 zustand `set` 回调内读 `state.currentWorkspacePath` 决定保留哪个工作区的 slice。整合后在 `set` 回调外先用 `const currentPath = getCurrentWorkspacePath()` 取值,再传入 `set` 回调使用(避免在回调内跨 store 读取的时序歧义);`state.currentWorkspacePath` 的所有引用替换为该 `currentPath`。
- **循环依赖确认**:`workspaceStore` 只导入 `workspaceApi` 与事件常量,不导入 conversationsStore;`conversationsStore` 导入 `workspaceStore` 为单向依赖,无循环。

### 4. `store/conversation/actions.ts` — 新增统一入口 + 改 action

新增 `activateWorkspace(workspacePath: string)`(签名见上),内部依次调用 `ensureWorkspaceConversationsAction(path)` → `switchWorkspaceSlice(path)` → 必要时 `nextPageConversationsAction()`。

`switchWorkspaceConversationsAction` 删除,所有外部调用点改为调 `activateWorkspace`。注意 `ensureWorkspaceConversationsAction`(actions.ts:72)内部原直接调用 `useConversationsStore.getState().switchWorkspace(workspacePath)`,改名后同步改为 `switchWorkspaceSlice`;但 `activateWorkspace` 已统一封装 ensure+switch,外部调用方不再单独调 `ensureWorkspaceConversationsAction` + `switchWorkspace`,仅在 `WorkspacePanels.toggleWorkspace`(展开非当前工作区面板预加载)这类只需 ensure 不需切换顶层 slice的场景保留单独调 `ensureWorkspaceConversationsAction`。

`clearConversationsAction`、`nextPageConversationsAction` 的 `currentWorkspacePath` 改从 `useWorkspaceStore.getState().workspaceData?.currentWorkspacePath` 取。

`nextPageConversationsAction` 的竞态守护:

```ts
// 修复前
if (draft.currentWorkspacePath !== currentWorkspacePath || ...) return
// 修复后:produce 回调内读 workspaceStore 当前路径与发起时的 currentWorkspacePath 比较
if (useWorkspaceStore.getState().workspaceData?.currentWorkspacePath !== currentWorkspacePath || ...) return
```

语义不变:分页加载是异步的,加载期间用户可能切了工作区,加载回来时若 workspaceStore 当前路径已不是发起时的路径,则丢弃结果,不污染新工作区顶层 conversations。

### 5. `components/Workspace/WorkspacePanels.tsx`

- 删除 `reloadCurrentWorkspace`(闭包陷阱根源,`WorkspacePanels.tsx:92-97`)。
- 删除本地 `currentWorkspacePath` 派生(`WorkspacePanels.tsx:72`),改为 `const currentWorkspacePath = workspaceData?.currentWorkspacePath ?? ''`。
- `handlePickerConfirm`:`addWorkspace(path)` 后调 `await activateWorkspace(data.currentWorkspacePath)`,用返回值不用闭包。
- `handleDeleteWorkspace`:`removeWorkspace(path)` 后调 `await activateWorkspace(data.currentWorkspacePath)`(后端返回删除后的新当前路径),修复删除不同步缺口。
- `openConversation`/`createConversation`:`openWorkspace` 后调 `activateWorkspace(workspacePath)`。
- `initialize`:`refreshWorkspace()` 后调 `activateWorkspace(data.currentWorkspacePath)`。

### 6. `components/Workspace/WorkspaceSelector.tsx` — 消除第三源

- 删除本地 `useReducer workspaceData`、`refreshWorkspaces` 里的 `setWorkspaceData`。
- 改读 `useWorkspaceStore(state => state.workspaceData)`。
- `applyWorkspaceData` 改为:不再 `setWorkspaceData`(workspaceStore action 已 set),只 `setActiveConversationsId('') + activateWorkspace(data.currentWorkspacePath)`。
- `handlePickerConfirm`/`confirmRemoveWorkspace`/`handleOpenWorkspace` 改调 workspaceStore 的 `addWorkspace`/`removeWorkspace`/`openWorkspace` + `activateWorkspace`。
- `emitWorkspaceChanged` 保留(通知其他实例),但不再是补同步兜底。
- `handleOpenWorkspace` 的 `item.path === workspaceData?.currentWorkspacePath` 守卫改用 workspaceStore 的值。

### 7. `components/Chat/Chat.tsx`

- `currentWorkspacePath`(`Chat.tsx:28`)从 `useConversationsStore` 改为 `useWorkspaceStore(state => state.workspaceData?.currentWorkspacePath)`。
- 其余不动,发送消息归属(`Chat.tsx:83` 的 `workspacePath: currentWorkspacePath`)自然正确。

### 8. `components/Sender/Sender.tsx`

- 已读 workspaceStore,基本不动。
- `handleSwitchWorkspace`(`Sender.tsx:478-504`)的 `openWorkspace` + `switchWorkspaceConversationsAction` 改为 `openWorkspace` + `activateWorkspace(nextWorkspacePath)`,与统一入口对齐。

## 错误处理与边界

- **workspaceStore 路径为空(初始化前)**:`activateWorkspace('')` 为 no-op,仅清空 `activeConversationsId`。`nextPageConversationsAction` 保留空路径守护。
- **分页加载竞态**:守护从比较 `conversationsStore.currentWorkspacePath` 改为比较 workspaceStore 当前路径,语义不变。
- **refresh 后补加载职责**:`WORKSPACE_CHANGED_EVENT` 全局监听器(`store/workspace/store.ts:56-58`)与 `useAppEventListener.ts:61` 触发 `workspaceStore.refresh()`,只更新 workspaceStore 数据。refresh 后若当前路径的 slice 未加载,由依赖 workspaceStore 的组件(`WorkspacePanels` 挂载时调 `activateWorkspace`)或 `activateWorkspace` 内部的 `ensure + nextPage` 补加载。refresh 本身不直接触发会话补加载,职责边界保持:workspaceStore 只管数据,conversations 层管缓存。
- **循环依赖**:已确认 workspaceStore 不导入 conversationsStore,单向依赖,安全。
- **跨实例通知**:`emitWorkspaceChanged` 保留,用于一个实例操作后通知其他实例 refresh。整合后不再是补同步的兜底,因为 conversationsStore 不再持有路径,refresh 只更新 SSOT,显示与归属自动一致。

## 测试

- **行为测试 — 添加工作区后发送消息归属正确(覆盖原 bug)**:添加新工作区 → 发送消息 → 断言新建会话的 `workspacePath` === 新工作区路径,而非旧工作区。
- **删除当前工作区**:删除当前工作区 → 断言 conversationsStore 顶层 slice 切到后端返回的新当前路径,无残留指向已删除工作区。
- **切换工作区期间分页加载返回**:发起分页加载 → 加载未完成时切换工作区 → 加载返回 → 断言不污染新工作区顶层 conversations(竞态守护)。
- **SSOT 不变性**:断言 `conversationsStore` 的 state 不再有 `currentWorkspacePath` 字段(类型层面由 `StoreState` 删除保证;运行时由 `createInitialState` 删除保证)。
- **WorkspaceSelector 与 WorkspacePanels 一致**:两者都读 workspaceStore,任一实例切换工作区后,另一实例显示与归属一致。

测试遵循项目规范:行为导向,mock 系统边界(HTTP/IPC),不 mock 内部 store 模块。框架 Vitest,环境 jsdom。

## 迁移策略

单 PR 完成。`conversationsStore.currentWorkspacePath` 字段删除是破坏性改动,半迁移会留双源,因此 store 层、action 入口、组件读取点在同一 PR 内一并改。

顺序:

1. 改 store 层(`initialState.ts` 删字段、`conversationsStore.ts` 跨 store 读 key、新增 `getCurrentWorkspacePath`)。
2. 改 action 层(`actions.ts` 新增 `activateWorkspace`、改 `clearConversationsAction`/`nextPageConversationsAction`、替换 `switchWorkspaceConversationsAction` 调用)。
3. 改组件读取点(`WorkspacePanels`/`WorkspaceSelector`/`Chat`/`Sender`)。
4. 每步运行 `pnpm check`(type-check + lint + unit tests),一次性修复所有错误再提交。
5. 补行为测试,运行 `pnpm test:unit` 验证。

## 影响范围

改动文件:

- `apps/web/src/store/conversation/initialState.ts`
- `apps/web/src/store/conversation/conversationsStore.ts`
- `apps/web/src/store/conversation/actions.ts`
- `apps/web/src/components/Workspace/WorkspacePanels.tsx`
- `apps/web/src/components/Workspace/WorkspaceSelector.tsx`
- `apps/web/src/components/Chat/Chat.tsx`
- `apps/web/src/components/Sender/Sender.tsx`
- 相关测试文件

`workspaceStore` 代码不改,仅承担 SSOT 角色。后端 `workspaceService.ts` 不涉及(本 bug 纯前端状态层)。
