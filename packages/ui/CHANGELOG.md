# @workspace/ui

## 0.0.1-alpha.1

### Patch Changes

- 831d10e: 统一右侧辅助栏，支持工作区文件树浏览与文件预览

  - 新增统一 `RightSidebar`：标签页模型（文件 / Trace），支持多个文件标签 + 唯一 Trace 标签；窄屏（≤767px）降级为 Sheet，宽屏为可拖拽宽度侧栏；右上角常驻开关按钮。Trace 面板从独立 Sheet 重构为侧栏内嵌内容，入口从标题栏按钮改为右上角开关。
  - 新增文件管理器：工作区文件树懒加载（目录展开按需拉取）、目录/文件名称排序、语言推断与图标；文件名模糊搜索；文件树列宽与右侧栏宽度可拖拽调节（树宽持久化，栏宽每次启动恢复默认）。
  - 新增文件预览：文本文件（1MB 上限、二进制嗅探，binary/oversize 展示中性提示）、Markdown（Preview/Source 双模式，复用 streamdown 静态渲染）、图片/音视频（原生流式）、Excel/PDF/DOCX（WASM 只读渲染）、不支持类型中性提示；「用默认软件打开」调用系统默认应用。
  - 后端新增 RPC：`workspace.listDirectoryEntries` / `workspace.readTextFile` / `workspace.openWithDefaultApp` / `workspace.resolveFileForStream`；路径校验拒绝绝对路径/盘符/反斜杠/`..`，realpath 阻断符号链接逃逸，单目录枚举上限 2000 条。
  - 文件流式预览双通道：Web 走本地 HTTP 端点 `/api/workspace/file`（支持 Range），Electron 走自定义 `antchat-ws-file` scheme（protocol.handle + net.fetch）；安全校验统一收敛到后端 `workspace.resolveFileForStream`。

- Updated dependencies [e2ce6cd]
- Updated dependencies [80f4283]
- Updated dependencies [831d10e]
  - @ant-chat/shared@1.0.0-alpha.4

## 0.0.1-alpha.0

### Patch Changes

- ac16c9b: 升级 AI SDK 到 v7（`ai@^7.0.18` 及 `@ai-sdk/*` provider 包 v4/v3），并重构 `MultiProvider` 实现：用 `PROVIDER_FACTORIES` 表消除 provider 分支与 `any`；系统提示改用 `instructions` 选项；消息转换返回类型化 `ModelMessage[]`（图片部件改为 `file`）；流式遍历 `result.stream`（`TextStreamPart` 类型化，删除 `usedFullStream`/`textStream` 死代码分支）；`usage` 收敛为单一 `await result.usage` 来源；`complete`/`createConversationTitle`/`validateConnection` 改用 `generateText`；`normalizeUsage` 源读取改 `outputTokenDetails.reasoningTokens` / `inputTokenDetails.cacheReadTokens`。对外契约 `streamModel`/`complete` 保持不变。
- Updated dependencies [77a5e4c]
- Updated dependencies [ac16c9b]
- Updated dependencies [893be45]
- Updated dependencies [6135228]
- Updated dependencies [90afafd]
- Updated dependencies [c8b903c]
- Updated dependencies [d0e2eb6]
- Updated dependencies [3e473c0]
- Updated dependencies [a5511b3]
- Updated dependencies [0ffdbf0]
- Updated dependencies [914c4ae]
  - @ant-chat/shared@1.0.0-alpha.2
