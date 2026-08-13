---
'ant-chat': minor
'@ant-chat/backend': minor
'@ant-chat/shared': minor
'@ant-chat/web': minor
'@ant-chat/desktop': patch
'@workspace/ui': patch
---

统一右侧辅助栏，支持工作区文件树浏览与文件预览

- 新增统一 `RightSidebar`：标签页模型（文件 / Trace），支持多个文件标签 + 唯一 Trace 标签；窄屏（≤767px）降级为 Sheet，宽屏为可拖拽宽度侧栏；右上角常驻开关按钮。Trace 面板从独立 Sheet 重构为侧栏内嵌内容，入口从标题栏按钮改为右上角开关。
- 新增文件管理器：工作区文件树懒加载（目录展开按需拉取）、目录/文件名称排序、语言推断与图标；文件名模糊搜索；文件树列宽与右侧栏宽度可拖拽调节（树宽持久化，栏宽每次启动恢复默认）。
- 新增文件预览：文本文件（1MB 上限、二进制嗅探，binary/oversize 展示中性提示）、Markdown（Preview/Source 双模式，复用 streamdown 静态渲染）、图片/音视频（原生流式）、Excel/PDF/DOCX（WASM 只读渲染）、不支持类型中性提示；「用默认软件打开」调用系统默认应用。
- 后端新增 RPC：`workspace.listDirectoryEntries` / `workspace.readTextFile` / `workspace.openWithDefaultApp` / `workspace.resolveFileForStream`；路径校验拒绝绝对路径/盘符/反斜杠/`..`，realpath 阻断符号链接逃逸，单目录枚举上限 2000 条。
- 文件流式预览双通道：Web 走本地 HTTP 端点 `/api/workspace/file`（支持 Range），Electron 走自定义 `antchat-ws-file` scheme（protocol.handle + net.fetch）；安全校验统一收敛到后端 `workspace.resolveFileForStream`。
