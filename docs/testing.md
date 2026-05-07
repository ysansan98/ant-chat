# 工程基座

本文档定义后续迭代必须遵守的工程入口、模块边界、测试分层和运行产物规则。目标是让小功能也能低成本交付，同时避免主进程、渲染进程和测试工具互相耦合。

## 本地入口

- `pnpm dev`：启动 Electron 开发环境。
- `pnpm check`：本地提交前的基础质量门禁，依次运行类型检查、lint、单元测试。
- `pnpm test:ui`：运行 renderer UI 流程测试，使用 Vitest + jsdom，不启动 Electron 窗口。
- `pnpm test:e2e`：运行跨模块端到端测试；目前覆盖 Agent Runtime + Aimock + DB + native tool 闭环。
- `pnpm check:all`：本地复现 CI 的完整质量检查。
- `pnpm build`：生产构建，不包含平台安装包。

## 模块边界

- `src/main/domains/*` 是主进程 IPC 边界，负责入参校验、错误响应和调用 main service。
- `src/renderer/src/api/*` 是渲染进程访问 IPC 的唯一入口；组件和 store 不直接调用 `window.electron`。
- `packages/shared` 保存跨进程类型、常量和纯数据结构；不要从这里反向依赖 main 或 renderer。
- `src/main/agent/*` 的 runtime、policy、tool registry 和 native tools 保持独立，renderer 只消费 task snapshot 和 `agent:*` 事件。
- 主进程运行产物通过 `src/main/utils/appPaths.ts` 管理，默认写入 Electron `userData`，测试用 `ANT_CHAT_RUNTIME_DIR` 指向临时目录。

## 测试分层

- 单元测试放在被测模块附近的 `__tests__`，优先验证纯逻辑、状态机、IPC 包装和 UI 状态。
- 复用测试工具放在 `tests/helpers`，例如临时 workspace、运行数据目录、fake runtime 依赖。
- UI 流程测试放在 `tests/ui`，覆盖 renderer 路由、组件交互、store 状态和 mock IPC/API 后的界面流转。
- e2e 放在 `tests/e2e`，覆盖跨模块闭环，不重复单元测试矩阵。
- Agent 相关模型调用默认使用 Aimock 或 fake provider，不依赖真实模型、真实网络或用户本机配置。

## CI 规则

CI 分两层：

- `quality`：安装依赖、准备 rg、重建 native module、类型检查、lint、单元测试。
- `ui-test`：在 `quality` 通过后运行 renderer UI 流程测试。
- `agent-e2e`：在 `quality` 通过后运行 Agent Runtime e2e。

新增功能至少满足：

- 改 main/renderer/shared 类型：跑 `pnpm type-check`。
- 改 UI、store 或 main 逻辑：跑相关单测，必要时跑 `pnpm test:unit`。
- 改 renderer 路由、聊天输入区、审批 UI、设置导航：跑 `pnpm test:ui`。
- 改 Agent loop、tool、policy、checkpoint/log：跑 `pnpm test:e2e:agent-runtime`。
- 改构建、依赖或 Electron 配置：跑 `pnpm build`。

## 运行产物

- checkpoint、agent log 等诊断文件不写入项目根目录和用户 workspace。
- 生产环境写入 `app.getPath('userData')/agent`。
- 测试环境通过 `ANT_CHAT_RUNTIME_DIR` 隔离，并在 `afterEach` 清理。
- 日志 payload 必须脱敏 token、key、secret、password、env 等敏感字段，并限制长文本长度。
