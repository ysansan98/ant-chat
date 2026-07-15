# Visualization HTML Fragment Schema

`publish_visualization({ title, summary, html })` 的共享合同定义在 `@ant-chat/shared`。

## 最小示例

```html
<section class="card" aria-labelledby="latency-title">
  <h2 id="latency-title">请求延迟</h2>
  <p class="text-muted">比较不同阶段的平均延迟</p>
  <div class="viz-grid">
    <label
      >阶段<select class="form-select" id="stage">
        <option>排队</option>
        <option>执行</option>
      </select></label
    >
    <output class="card" id="result">38 ms</output>
  </div>
</section>
```

## 安全限制

- 只允许 fragment，不允许完整 document、iframe、object、embed、base、meta refresh；
- 禁止 `javascript:`、`vbscript:`、inline `on*` 事件属性、`fetch`、XHR、WebSocket、EventSource、sendBeacon；
- 禁止访问父窗口、Electron、进程、数据库、文件系统、RPC 和宿主 DOM；
- 外部 script/link 只能使用固定 HTTPS CDN URL、精确版本、sha384 SRI 和 anonymous CORS；
- CSP 使用 `connect-src 'none'`、`img-src data:`、`font-src 'none'`；
- UTF-8 HTML 上限为 2 MiB，artifact 由后端计算 sha256 并生成新的 file id。

工具结果使用 JSON envelope：成功为 `{ "success": true, "status": "published", "message": "...", "artifact": { "title", "summary", "format", "size", "sha256" } }`；失败为 `{ "success": false, "status": "failed", "message": "..." }`。

## 交互边界

fragment 可以使用原生 HTML/CSS/JS 和内联数据。只有真实用户 click/submit 后的短时 gesture token 才能调用 `window.antChatVisualization.sendFollowUpMessage`。该调用只传 `prompt` 和可选 `title`，宿主确认后创建下一轮 user message。

本地预览：

```bash
pnpm visualize:render fragment.html preview.html
pnpm visualize:render --serve fragment.html
```

该命令只依赖 Node.js，不依赖 Python。
