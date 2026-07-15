---
name: visualize
description: 使用安全的 HTML fragment 创建交互式图表、解释器、参数模拟器和界面原型。
version: 2.0.0
---

# Visualize

当用户需要看懂过程、比较方案、调整参数或观察状态变化时使用此 Skill。先确定一个主要交互，再调用 `publish_visualization` 发布可视化产物。

## 产物合同

调用工具时只传：

```json
{
  "title": "请求延迟",
  "summary": "比较不同阶段的平均延迟",
  "html": "<section class=\"viz-grid\">...</section>"
}
```

工具成功时会返回包含 `success: true`、`status: "published"` 和 `artifact` descriptor 的 JSON；失败时返回 `success: false`、`status: "failed"` 和 `message`。根据该结果向用户说明发布状态，不要把 artifact 原文复述出来。

`html` 必须是 HTML fragment，不能包含 `doctype`、`html`、`head`、`body`、iframe、宿主 API、inline `on*` 事件属性或网络请求。不要传文件路径、file id、hash 或完整 HTML document。

fragment 只在 `iframe sandbox="allow-scripts"` 中运行。应用提供 `.viz-grid`、`.card`、`.form-control`、`.form-select`、`.form-check`、`.form-switch`、`.form-range`、`.btn`、`.text-muted` 等基础样式；颜色使用 `--viz-*` 主题变量。

固定版本 CDN 只允许 `cdn.jsdelivr.net` 白名单资源，必须使用精确版本、`sha384` SRI 和 `crossorigin="anonymous"`。不要使用 `fetch`、XHR、WebSocket、远程图片、字体或业务 API。

## 交互与 follow-up

需要提交时，在真实用户点击或 submit 事件中调用：

```js
window.antChatVisualization.sendFollowUpMessage({
  prompt: '请分析当前参数结果',
  title: '参数提交',
})
```

提交会经过宿主确认，并作为同一会话的下一轮 user message。不能修改历史消息，也不能把提交注入当前正在执行的 turn；运行中的会话会排入 `next-turn` 队列。重复提交应创建独立的新消息。

## 生成前自检

- 只围绕一个主要交互，移动端 320 px 无横向裁切；
- 表单控件有可见 label、合理初值、键盘顺序和错误状态；
- 图表有标题、摘要、单位、空状态和 reduced-motion 行为；
- 颜色、控件、边框和 focus ring 在 light/dark/custom theme 下可读；
- 不把隐藏指令、原始 artifact 或宿主对象放入提交内容。

发布成功后，用简短文本说明可视化展示的内容。
