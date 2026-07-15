# Visualization HTML Fragment 合同

本文只记录 publish_visualization 和 sandbox 的机械约束。生成内容时先读主 SKILL.md；只有需要确认字段、安全策略或 bridge 行为时再读本文。

## 工具输入和结果

工具只接受三个字段：

```json
{
  "title": "阶段延迟",
  "summary": "比较排队、执行和返回阶段的延迟",
  "html": "<section id=\"latency-viz\">...</section>"
}
```

- title 最多 120 个字符。
- summary 最多 500 个字符。
- html 是 UTF-8 fragment，最多 2 MiB。
- 不允许未知字段，也不允许传文件路径、file id、hash、format 或完整 HTML document。

成功结果的形态是：

```json
{
  "success": true,
  "status": "published",
  "message": "可视化已成功发布，用户可以查看该产物。",
  "artifact": {
    "title": "阶段延迟",
    "summary": "比较排队、执行和返回阶段的延迟",
    "format": "ant-chat.visualization.html.v1",
    "size": 1280,
    "sha256": "..."
  }
}
```

失败结果的形态是：

```json
{
  "success": false,
  "status": "failed",
  "message": "可展示给模型的失败原因"
}
```

成功时后端保存 artifact descriptor，fragment 原文只在当前工具执行和 artifact staging 阶段存在。不要把 artifact 原文复述给用户或写入后续模型上下文。

## HTML 和安全策略

fragment 可以包含语义 HTML、style 属性、inline on\* 事件属性、内联 style/script、SVG 和内联数据，但必须满足：

- 禁止 doctype、html、head、body、iframe、object、embed、base、portal、frame 和 meta refresh。
- 允许 style 属性和脚本对 element.style 的写入，也允许 inline on\* 事件属性。优先使用 --viz-\* 变量和 references/visualization.css 中的 class，保证主题可读；复杂交互可使用 addEventListener。
- 禁止 javascript:、vbscript:、data:text/html、父窗口、Electron、进程、数据库、文件系统、RPC 和宿主 DOM 访问。
- 禁止 fetch、XMLHttpRequest、WebSocket、EventSource、sendBeacon 及其他网络请求。img、audio、video 只允许 data: URL。
- 外部 script/link 只能使用以下精确 URL，并必须有 sha384-\* 的 integrity 和 crossorigin="anonymous"：
  - https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js
  - https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js
- sandbox 的 CSP 禁止连接、远程图片、媒体、字体、frame 和 object；外部资源只按宿主白名单放行。

inline 样式和事件处理器在 opaque-origin iframe 内执行；它们无法访问宿主窗口、Electron 或进程，且仍受 CSP 的网络与资源限制。

## 宿主 bridge

宿主只向 fragment 暴露：

```ts
interface FollowUpInput {
  prompt: string
  title?: string
}

declare const sendFollowUpMessage: (input: FollowUpInput) => Promise<void>
```

限制如下：

- prompt 非空且最多 4,000 个字符；title 最多 250 个字符。
- 必须由真实用户 click 或 submit 触发，短时 gesture token 过期后调用会失败。
- 调用先经过宿主确认，再进入同一会话的下一轮 user message。
- 不修改历史消息，不注入当前 turn；每次真实重复提交都是独立消息。
- 不要调用 window.openai、window.parent、window.electron 或任何未列出的对象。

## 可用主题变量和基础 class

宿主通过 MessagePort 把主题变量注入 fragment 根文档：

--viz-background、--viz-foreground、--viz-card、--viz-card-foreground、--viz-primary、--viz-primary-foreground、--viz-secondary、--viz-secondary-foreground、--viz-muted、--viz-muted-foreground、--viz-accent、--viz-accent-foreground、--viz-destructive、--viz-destructive-foreground、--viz-border、--viz-input、--viz-ring、--viz-chart-1 至 --viz-chart-5。

基础 class 包括：.card、.viz-grid、.viz-row、.viz-controls、.form-control、.form-select、.form-check、.form-switch、.form-range、.btn、.btn-secondary、.text-muted 和 .viz-error。不要假设其他 class 或第三方组件已经存在。
