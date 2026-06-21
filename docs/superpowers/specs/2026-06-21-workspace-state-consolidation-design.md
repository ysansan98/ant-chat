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

以 `useWorkspaceStore.currentWorkspacePath`(workspaceStore 顶层字段,整合后新增)为唯一事实源(SSOT)。删除 `conversationsStore.currentWorkspacePath` 字段,删除 `WorkspaceSelector` 的本地 `workspaceData`。所有需要「当前工作区」的读写统一从 workspaceStore 顶层字段取。`conversationsStore` 的分片缓存 `workspaceConversations: Record<path, Slice>` 保留,但其 save/restore 用的 key 改为跨 store 从 workspaceStore 读取。

整合后,显示(Sender 读 workspaceStore)与归属(Chat 读 workspaceStore)天然一致,因为只剩一个源;闭包陷阱、删除不同步、第三源三个缺口一并消除。

## 架构

```
useWorkspaceStore  ← 唯一事实源(SSOT)
  .currentWorkspacePath                       顶层字段,写入:增/删/切/refresh(前端显式设置+启动派生)
  .workspaceData.workspaces                   工作区列表(后端不再回传 currentWorkspacePath)

useConversationsStore  ← 不再持有 currentWorkspacePath
  .workspaceConversations: Record<path, Slice>   分片缓存,key 来自 workspaceStore
  .conversations / pageIndex / conversationsTotal / loadVersion   顶层=当前工作区 slice 的投影
  需要「当前 path」时 → useWorkspaceStore.getState().currentWorkspacePath
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

- **入参**:目标工作区绝对路径。由调用方传入,与紧邻的 workspaceStore action 的 `path` 入参一致(如 `addWorkspace(path)` 后调 `activateWorkspace(path)`),或从 `useWorkspaceStore.getState().currentWorkspacePath` 取(如 `removeWorkspace`/`refresh` 后,workspaceStore action 已派生好新当前路径)。**不依赖任何闭包渲染期变量**。
- **行为**:空路径 → 仅 `setActiveConversationsId('')`;非空 → `ensureWorkspaceConversationsAction(path)` + `switchWorkspaceSlice(path)` + 必要时 `nextPageConversationsAction()` 补加载首页。
- **返回**:无返回值。不写 workspaceStore(由 workspaceStore action 负责)。
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
  await addWorkspace(path)                              // workspaceStore action: set currentWorkspacePath=path (SSOT 更新)
  await activateWorkspace(path)                         // 同步会话分片缓存到该路径,用入参不依赖闭包
    → ensureWorkspaceConversationsAction(path)
    → switchWorkspaceSlice(path)                        // 只做分片 save/restore,不写 currentWorkspacePath
```

显示(Sender 读 workspaceStore)与归属(Chat 读 workspaceStore)天然一致。

**职责边界**:workspaceStore action(`addWorkspace`/`openWorkspace`/`removeWorkspace`/`refresh`)负责设置 SSOT 的 `currentWorkspacePath`;`activateWorkspace(path)` 只负责把会话分片缓存切换到该路径(ensure + switchSlice + 补加载)。调用方先调 workspaceStore action,再调 `activateWorkspace(同一 path)`。`activateWorkspace` 不写 workspaceStore,避免双写。

## 逐文件改动

### 1. `store/workspace/store.ts`(SSOT,承担当前路径的显式设置)

workspaceStore 保持四个 action(`refresh`/`openWorkspace`/`addWorkspace`/`removeWorkspace`),但行为调整以适配后端不再回传 `currentWorkspacePath`(详见「后端 `currentWorkspacePath`:去掉持久化」):

- store state 新增 `currentWorkspacePath: string`(前端派生+显式设置的 SSOT 字段,初始 `''`)。`workspaceData` 保留 `workspaces` 列表,但不再含 `currentWorkspacePath`(后端已删该字段)。
- `refresh`:拉取 `workspaces` 列表后,若当前 `currentWorkspacePath` 为空或不在列表中,取 `workspaces` 中 `lastOpenedAt` 最大者为当前工作区;列表为空时取默认工作区。
- `openWorkspace(path)`/`addWorkspace(path)`:后端返回新 `workspaces` 列表后,`set({ workspaceData: { workspaces }, currentWorkspacePath: path })` —— 操作的目标路径即为新当前工作区,前端显式设置。
- `removeWorkspace(path)`:后端返回新列表后,若删的是当前工作区,`currentWorkspacePath` 回退到 `workspaces` 中 `lastOpenedAt` 最大者。

workspaceStore 仍是 SSOT,只是 `currentWorkspacePath` 来源从「后端回传」改为「前端在操作时显式设置 + 启动时按 `lastOpenedAt` 派生」。

### 2. `store/conversation/initialState.ts` — 删除字段

- `StoreState` 删除 `currentWorkspacePath: string`。
- `createInitialState` 删除 `currentWorkspacePath: ''`。
- `workspaceConversations: Record<string, WorkspaceConversationsState>` 保留。

### 3. `store/conversation/conversationsStore.ts` — key 来源跨 store

新增内部 helper:

```ts
function getCurrentWorkspacePath(): string {
  return useWorkspaceStore.getState().currentWorkspacePath ?? ''
}
```

(读 workspaceStore 新增的顶层 `currentWorkspacePath` 字段,而非 `workspaceData.currentWorkspacePath` —— 后者已随后端去字段而删除。)

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

`clearConversationsAction`、`nextPageConversationsAction` 的 `currentWorkspacePath` 改从 `useWorkspaceStore.getState().currentWorkspacePath` 取。

`nextPageConversationsAction` 的竞态守护:

```ts
// 修复前
if (draft.currentWorkspacePath !== currentWorkspacePath || ...) return
// 修复后:produce 回调内读 workspaceStore 当前路径与发起时的 currentWorkspacePath 比较
if (useWorkspaceStore.getState().currentWorkspacePath !== currentWorkspacePath || ...) return
```

语义不变:分页加载是异步的,加载期间用户可能切了工作区,加载回来时若 workspaceStore 当前路径已不是发起时的路径,则丢弃结果,不污染新工作区顶层 conversations。

### 5. `components/Workspace/WorkspacePanels.tsx`

- 删除 `reloadCurrentWorkspace`(闭包陷阱根源,`WorkspacePanels.tsx:92-97`)。
- 删除本地 `currentWorkspacePath` 派生(`WorkspacePanels.tsx:72`),改为 `const currentWorkspacePath = useWorkspaceStore(state => state.currentWorkspacePath)`(读 workspaceStore 顶层字段)。
- `handlePickerConfirm`:`await addWorkspace(path)` 后调 `await activateWorkspace(path)`。`addWorkspace` 内部已 `set({ currentWorkspacePath: path })`,故用入参 `path`(或 `useWorkspaceStore.getState().currentWorkspacePath`),不依赖闭包渲染期变量。
- `handleDeleteWorkspace`:`removeWorkspace(path)` 后调 `await activateWorkspace(useWorkspaceStore.getState().currentWorkspacePath)`(removeWorkspace action 内部已回退到 `lastOpenedAt` 最大者),修复删除不同步缺口。
- `openConversation`/`createConversation`:`openWorkspace` 后调 `activateWorkspace(workspacePath)`。
- `initialize`:`refreshWorkspace()` 后调 `activateWorkspace(useWorkspaceStore.getState().currentWorkspacePath)`(refresh action 内部已按 `lastOpenedAt` 派生当前路径)。

### 6. `components/Workspace/WorkspaceSelector.tsx` — 消除第三源

- 删除本地 `useReducer workspaceData` 与 `refreshWorkspaces` 里的 `setWorkspaceData`。
- 改读 `useWorkspaceStore(state => state.workspaceData)`(列表)与 `useWorkspaceStore(state => state.currentWorkspacePath)`(当前)。
- 删除 `applyWorkspaceData` 中间函数。三个操作直接走 workspaceStore action + `activateWorkspace`:
  - `handlePickerConfirm(path)`:`await addWorkspace(path)`(内部 set currentWorkspacePath)→ `await activateWorkspace(path)`。
  - `confirmRemoveWorkspace(path)`:`await removeWorkspace(path)`(内部回退 currentWorkspacePath)→ `await activateWorkspace(useWorkspaceStore.getState().currentWorkspacePath)`。
  - `handleOpenWorkspace(item)`:`await openWorkspace(item.path)`(内部 set currentWorkspacePath)→ `await activateWorkspace(item.path)`。
  - 每个操作前 `await setActiveConversationsId('')`。
- `refreshWorkspaces` 简化为:调 `useWorkspaceStore.getState().refresh()`(不再自己调 `workspaceApi.listWorkspaces`)。组件挂载 useEffect 改为依赖 workspaceStore,无需本地 refresh。
- `emitWorkspaceChanged` 保留(通知其他实例),但不再是补同步兜底。
- `handleOpenWorkspace` 的 `item.path === workspaceData?.currentWorkspacePath` 守卫改用 `useWorkspaceStore.getState().currentWorkspacePath`。

### 7. `components/Chat/Chat.tsx`

- `currentWorkspacePath`(`Chat.tsx:28`)从 `useConversationsStore` 改为 `useWorkspaceStore(state => state.currentWorkspacePath)`(读 workspaceStore 顶层字段)。
- 其余不动,发送消息归属(`Chat.tsx:83` 的 `workspacePath: currentWorkspacePath`)自然正确。`currentWorkspacePath` 现在恒为 workspaceStore 的 SSOT 值,发送时显式传给后端,后端 `createConversation`/`startTurn` 必收必用。

### 8. `components/Sender/Sender.tsx`

- 显示工作区名仍读 `workspaceData.workspaces` + `useWorkspaceStore(state => state.currentWorkspacePath)`(从匹配 `workspaceData.currentWorkspacePath` 改为读顶层字段)。
- `handleSwitchWorkspace`(`Sender.tsx:478-504`):`openWorkspace(nextWorkspacePath)`(内部已 set `currentWorkspacePath`)后,将 `switchWorkspaceConversationsAction(nextWorkspacePath)` 改为 `activateWorkspace(nextWorkspacePath)`,与统一入口对齐。
- `selectableWorkspaces`、`hasWorkspace` 等读 `workspaceData` 列表的逻辑不变。

## 后端 `currentWorkspacePath`:去掉持久化(方案 B)

### 现状与判断

后端 `WorkspaceService` 持久化一份 `currentWorkspacePath`(`packages/app-data/src/workspace/workspaceService.ts`),由 `addWorkspace`/`openWorkspace`/`removeWorkspace` 即时写盘(`workspaceService.ts:95/116/133`),在会话域作为**归属兜底默认值**被读取:

- `appRuntime.ts:161` `createConversation`:`workspacePath ?? getCurrentWorkspacePath()`
- `appRuntime.ts:153` `listConversations`、`appRuntime.ts:177` `clearWorkspaceConversations`:同理兜底
- `agentTurnService.ts:39` `startTurn`:`workspacePath ?? getCurrentWorkspacePath() ?? process.cwd()`

但前端所有会话操作都经前端 store 显式传 `workspacePath`,后端兜底在正常路径下基本不被触发。它实际是一个「前端漏传时的隐式默认」,价值低且有害:

1. **模糊强语义**:会话归属是强语义,不该有「隐式默认」。后端用「最近打开的工作区」兜底,把「前端忘了传/传错」这个错误静默吞掉,凑一个看似合理的结果。本 bug 正是因此藏住 —— 前端传错路径时后端照单全收。
2. **制造前后端两份「当前工作区」**:前端一份(workspaceStore)、后端一份(持久化 config),靠「前端显式传值覆盖后端兜底」维系一致。一旦前端传错,后端兜底不仅不纠错,反而让错误结果落地。
3. **「记住上次打开的工作区」可由前端启动逻辑承担**:后端 `workspaces` 列表的 `lastOpenedAt` 已记录最近打开顺序,启动时前端可据此选当前工作区,不需要 `currentWorkspacePath` 这个独立字段。
4. **`startTurn` 的 `?? process.cwd()` 兜底**:说明连后端自己都不完全信任该字段一定有值,层层兜底本身就是价值不足的信号。

### 决策:去掉后端 `currentWorkspacePath`,会话接口改读写区分语义

- **写操作(createConversation、startTurn)**:`workspacePath` 改为必传(`string`),后端不再兜底,未传则抛错。会话创建必须显式归属某个工作区。
- **读操作(listConversations)**:`workspacePath` 保持可选,但语义改为「未传 = 跨工作区全量查询」(对应 `workspace_path IS NULL` 或忽略筛选),**不再用 `currentWorkspacePath` 兜底**。这保留「全量查询」能力(如 `chat.getConversations` 全量入口)。
- **clearWorkspaceConversations**:RPC schema 已声明 `workspacePath: string` 必传(`app-rpc.ts:52`),实现里却是 `workspacePath?: string` + 兜底(`appRuntime.ts:176`)。统一为必传,去掉兜底,与 schema 对齐。

### 后端逐文件改动

#### `packages/app-data/src/workspace/workspaceService.ts`

- `WorkspaceConfig` 删除 `currentWorkspacePath` 字段(对应 `packages/shared/src/interfaces/workspace.ts:2` 的可选字段同步删除)。
- `addWorkspace`/`openWorkspace`/`removeWorkspace` 的 `saveConfig` 不再写 `currentWorkspacePath`,只更新 `workspaces` 列表(及 `lastOpenedAt`)。
- `ensureInitialized` 删除 `currentWorkspacePath` 的校验与回填逻辑(`workspaceService.ts:62-71`),只保证默认工作区存在于列表。
- `listWorkspaces` 返回的 `ListWorkspacesData` 不再含 `currentWorkspacePath`。`currentWorkspacePath` 字段从 `ListWorkspacesData`(`packages/shared/src/interfaces/workspace.ts:18`)删除 —— 前端启动时改由「`workspaces` 列表中 `lastOpenedAt` 最大者」决定当前工作区。
- 删除 `getCurrentWorkspacePath()` 方法(`workspaceService.ts:140-143`)及 `workspace.getCurrentWorkspacePath` RPC 端点(`app-rpc.ts:109`、`rpcHandlers.ts:80`)。

#### `packages/app-runtime/src/appRuntime.ts`

- `createConversation`(`appRuntime.ts:158-165`):`workspacePath` 改必传,删除 `?? getCurrentWorkspacePath()`。未传抛 `workspacePath is required`。
- `listConversations`(`appRuntime.ts:152-156`):`workspacePath` 保持可选,语义明确为:**未传 = 全量查询(`getWorkspaceWhere` 返回空 WHERE,含所有工作区与 `workspace_path IS NULL` 的会话);传了 = 按该路径筛选**。删除 `?? getCurrentWorkspacePath()` 兜底,同时删除 `includeNullWorkspace` 的默认工作区特判(`appRuntime.ts:154`,`targetWorkspace === getDefaultWorkspacePath()` 时把 null 纳入)—— 该特判依赖后端「当前=默认工作区」概念,B 方案后该概念不存在。`includeNullWorkspace` 仍作为可选参数保留,语义为「传了 `workspacePath` 时是否额外纳入 null 工作区会话」,由调用方显式决定,默认 `false`。`chat.getConversations`(全量入口,`rpcHandlers.ts:17`)不传 `workspacePath`,自然走全量语义。`chat.getWorkspaceConversations` 传 `workspacePath`,走筛选语义。
- `clearWorkspaceConversations`(`appRuntime.ts:176-192`):`workspacePath` 改必传,删除兜底,与 RPC schema 对齐。
- `emitWorkspaceResult`(`appRuntime.ts:434-435`)与 `workspace:changed` 事件(`ipc-events.ts:71`):事件 payload 不再含 `currentWorkspacePath`。

#### `packages/agent-runtime/src/agentTurnService.ts`

- `startTurn`(`agentTurnService.ts:38-40`):`workspacePath` 改必传,删除 `?? getCurrentWorkspacePath() ?? process.cwd()`。未传抛错。`StartAgentTurnOptions.workspacePath`(`agent-runtime-electron.ts:14`)从可选改为必传 `string`。

#### `packages/app-runtime/src/rpcHandlers.ts` / `packages/shared/src/interfaces/app-rpc.ts`

- `chat.getConversations`(`app-rpc.ts` 对应端点、`rpcHandlers.ts:17`):全量查询入口,保持不传 `workspacePath`,语义为跨工作区全量。
- `chat.getWorkspaceConversations`(`app-rpc.ts:47`):已声明 `workspacePath: string` 必传,不变。
- `chat.clearWorkspaceConversations`(`app-rpc.ts:52`):已声明必传,实现对齐。
- 删除 `workspace.getCurrentWorkspacePath` 端点。

### 前端配套:启动时确定当前工作区

后端不再返回 `currentWorkspacePath` 后,`ListWorkspacesData` 只剩 `workspaces` 列表。前端 workspaceStore 的 `refresh`/`openWorkspace`/`addWorkspace`/`removeWorkspace` 返回值不再含 `currentWorkspacePath`。当前工作区改由前端决定:

- **启动时**:`refresh` 后,当前工作区 = `workspaces` 中 `lastOpenedAt` 最大者(最近打开);列表为空时取默认工作区。
- **`openWorkspace`/`addWorkspace`**:操作的目标路径即为新的当前工作区(前端在调用方已知,无需后端回传)。
- **`removeWorkspace`**:若删的是当前工作区,前端回退到 `workspaces` 中 `lastOpenedAt` 最大者。

这要求 workspaceStore 持有「当前工作区路径」作为前端派生状态(SSOT),由前端工作区操作显式更新。后端 `workspaces` 列表只提供可选项与 `lastOpenedAt` 排序依据。

> 注:这使前端 workspaceStore 的 `currentWorkspacePath` 从「后端回传的字段」变为「前端派生+显式设置的状态」。仍是 SSOT,只是来源从后端回传改为前端在操作时经 workspaceStore action 显式 `set`(`addWorkspace`/`openWorkspace` 内部 set 目标 path,`removeWorkspace`/`refresh` 内部按 `lastOpenedAt` 派生)。`activateWorkspace(path)` **不写 workspaceStore**,只同步会话分片缓存;调用方先调 workspaceStore action(已 set currentWorkspacePath),再调 `activateWorkspace(同一 path)`。

### bug 视角

本 bug 中前端 `conversationsStore` 停在旧路径,后端 `currentWorkspacePath` 已被 `addWorkspace` 设为新路径(后端状态其实正确),但 `Chat.tsx:83` 显式传了前端那个错的旧 `workspacePath`,绕过后端兜底,导致会话归属旧工作区。整合后:前端 workspaceStore 为 SSOT 且 `Chat.tsx:28` 读它,`currentWorkspacePath` 始终正确;后端写操作必传 `workspacePath` 且无兜底,即便前端某处漏传也会显式报错而非静默错归属 —— 错误从「静默错归属」变为「显式失败」,更易暴露与修复。

## 错误处理与边界

- **workspaceStore 路径为空(初始化前)**:`activateWorkspace('')` 为 no-op,仅清空 `activeConversationsId`。`nextPageConversationsAction` 保留空路径守护。
- **分页加载竞态**:守护从比较 `conversationsStore.currentWorkspacePath` 改为比较 workspaceStore 当前路径(`useWorkspaceStore.getState().currentWorkspacePath`),语义不变。
- **refresh 后补加载职责**:`WORKSPACE_CHANGED_EVENT` 全局监听器(`store/workspace/store.ts` 底部)与 `useAppEventListener.ts:61` 触发 `workspaceStore.refresh()`,refresh 内部按 `lastOpenedAt` 派生当前路径并更新 `workspaces`。refresh 后若当前路径的 slice 未加载,由依赖 workspaceStore 的组件(`WorkspacePanels` 挂载时调 `activateWorkspace`)或 `activateWorkspace` 内部的 `ensure + nextPage` 补加载。refresh 本身不直接触发会话补加载,职责边界保持:workspaceStore 只管数据与当前路径派生,conversations 层管缓存。
- **循环依赖**:已确认 workspaceStore 不导入 conversationsStore,单向依赖,安全。
- **跨实例通知**:`emitWorkspaceChanged` 保留,用于一个实例操作后通知其他实例 refresh。整合后不再是补同步的兜底,因为 conversationsStore 不再持有路径,refresh 只更新 SSOT,显示与归属自动一致。
- **后端写操作未传 workspacePath**:`createConversation`/`startTurn`/`clearWorkspaceConversations` 改必传后,未传抛错(非静默兜底)。前端所有调用点已显式传 workspaceStore 的 SSOT 值,正常路径不触发。
- **后端 `listConversations` 未传 workspacePath**:语义为跨工作区全量查询(含 `workspace_path IS NULL`),供 `chat.getConversations` 全量入口使用,不再用 `currentWorkspacePath` 兜底。
- **启动时当前工作区派生**:`refresh` 后,`currentWorkspacePath` = `workspaces` 中 `lastOpenedAt` 最大者。后端 `ensureInitialized`(`workspaceService.ts:52-71`)已保证默认工作区始终存在于列表,故 `workspaces` 不会为空,该派生总有结果。无需前端单独获取默认工作区路径。

## 测试

前端(web):

- **行为测试 — 添加工作区后发送消息归属正确(覆盖原 bug)**:添加新工作区 → 发送消息 → 断言新建会话的 `workspacePath` === 新工作区路径,而非旧工作区。
- **删除当前工作区**:删除当前工作区 → 断言 conversationsStore 顶层 slice 切到 `lastOpenedAt` 最大者,无残留指向已删除工作区。
- **切换工作区期间分页加载返回**:发起分页加载 → 加载未完成时切换工作区 → 加载返回 → 断言不污染新工作区顶层 conversations(竞态守护)。
- **SSOT 不变性**:断言 `conversationsStore` 的 state 不再有 `currentWorkspacePath` 字段(类型层面由 `StoreState` 删除保证;运行时由 `createInitialState` 删除保证)。
- **启动派生当前工作区**:`refresh` 后断言 `workspaceStore.currentWorkspacePath` === `workspaces` 中 `lastOpenedAt` 最大者。
- **WorkspaceSelector 与 WorkspacePanels 一致**:两者都读 workspaceStore,任一实例切换工作区后,另一实例显示与归属一致。

后端(packages):

- **`createConversation` 必传 `workspacePath`**:未传时抛错,不再用 `getCurrentWorkspacePath` 兜底。
- **`startTurn` 必传 `workspacePath`**:未传时抛错,不再兜底 `process.cwd()`。
- **`listConversations` 未传 `workspacePath`**:返回跨工作区全量(含 null),不依赖 `currentWorkspacePath`。
- **`workspaceService` 不再持久化 `currentWorkspacePath`**:增删改工作区后,配置文件只更新 `workspaces` 列表,不含 `currentWorkspacePath` 字段;`getCurrentWorkspacePath` 方法与 RPC 端点已删除。

测试遵循项目规范:行为导向,mock 系统边界(HTTP/IPC/文件系统),不 mock 内部 store/repository 模块。框架 Vitest。

## 迁移策略

单 PR 完成。`conversationsStore.currentWorkspacePath` 字段删除、后端 `currentWorkspacePath` 持久化删除、会话接口签名变更均为破坏性改动,半迁移会留双源或前后端不一致,因此前端 store/action/组件与后端 service/runtime/rpc 在同一 PR 内一并改。

顺序:

1. **后端**:`workspaceService.ts` 删字段与方法 → `appRuntime.ts` 会话接口改读写区分语义 → `agentTurnService.ts` 必传 → `rpcHandlers.ts`/`app-rpc.ts`/`ipc-events.ts` 端点与事件 payload 对齐 → `ListWorkspacesData` 删 `currentWorkspacePath`。
2. **前端 store**:`workspace/store.ts` 新增顶层 `currentWorkspacePath` 字段与派生逻辑;`conversation/initialState.ts` 删字段;`conversation/conversationsStore.ts` 跨 store 读 key;`conversation/actions.ts` 新增 `activateWorkspace`、改 `clearConversationsAction`/`nextPageConversationsAction`。
3. **前端组件**:`WorkspacePanels`/`WorkspaceSelector`/`Chat`/`Sender` 读取点与调用入口对齐。
4. 每步运行 `pnpm check`(type-check + lint + unit tests),一次性修复所有错误再提交。后端接口签名变更会触发 `tsc -b` 跨包报错,据此定位所有调用点。
5. 补行为测试(前端 + 后端),运行 `pnpm test:unit` 验证。

## 影响范围

前端改动文件:

- `apps/web/src/store/workspace/store.ts`(新增 SSOT 字段与派生)
- `apps/web/src/store/conversation/initialState.ts`
- `apps/web/src/store/conversation/conversationsStore.ts`
- `apps/web/src/store/conversation/actions.ts`
- `apps/web/src/components/Workspace/WorkspacePanels.tsx`
- `apps/web/src/components/Workspace/WorkspaceSelector.tsx`
- `apps/web/src/components/Chat/Chat.tsx`
- `apps/web/src/components/Sender/Sender.tsx`
- 相关测试文件

后端改动文件:

- `packages/app-data/src/workspace/workspaceService.ts`(删 `currentWorkspacePath` 持久化与方法)
- `packages/app-runtime/src/appRuntime.ts`(会话接口读写区分语义、删除兜底)
- `packages/app-runtime/src/rpcHandlers.ts`(端点对齐)
- `packages/agent-runtime/src/agentTurnService.ts`(`workspacePath` 必传)
- `packages/shared/src/interfaces/workspace.ts`(`ListWorkspacesData`/`WorkspaceConfig` 删字段)
- `packages/shared/src/interfaces/app-rpc.ts`(删 `workspace.getCurrentWorkspacePath` 端点、会话端点签名)
- `packages/shared/src/interfaces/agent-runtime-electron.ts`(`StartAgentTurnOptions.workspacePath` 改必传)
- `packages/shared/src/ipc-events.ts`(`workspace:changed` 事件 payload 删 `currentWorkspacePath`)
- 相关测试文件

本 bug 修复跨前后端:前端状态层整合为 SSOT,后端去掉 `currentWorkspacePath` 持久化并改会话接口为读写区分语义,从根上消除「隐式默认归属」这一 bug 藏身处。
