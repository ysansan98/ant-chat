---
name: visualize
description: 使用安全的 HTML fragment 创建交互式解释器、参数模拟器、图表、地图和界面原型；当用户需要调整参数、观察状态变化、比较方案或探索空间信息时使用。
---

# Visualize

## 先选择正确的产物

- 静态节点、边和层级关系用普通 Mermaid 代码块；不要为静态结构发布 HTML。
- 需要参数调整、步骤播放、状态变化、空间探索或可重复试验时，使用 publish_visualization。
- 只有可视化能明显帮助用户理解、比较或决定时才创建它。不要为了填充回复添加 KPI 卡片、筛选器或装饰性图表。
- 先定义一个主要问题和一个主要交互。其他控件必须直接支持这个问题。

## 执行流程

一个 turn 只维护一个可视化。重复调用 publish_visualization 是对同一产物的修订，最终只展示最后一次成功发布的版本。

1. 把数据、状态、控件和渲染结果分开建模，先给出有意义的初始状态。
2. 编写只包含 fragment 的 HTML。根节点使用唯一 id；事件可使用 inline on\* 属性或 addEventListener，脚本查询元素时不要依赖 document.currentScript。
3. 优先使用原生 HTML、CSS、SVG 和内联数据。先读取 [references/visualization-contract.md](references/visualization-contract.md)，只使用其中声明的 primitive 和主题 token，不要凭记忆发明 UI class 或硬编码设计系统颜色、字体、圆角。
4. 按下面的合同调用 publish_visualization。不要传文件路径、完整 HTML 文档、file id、hash 或自定义协议。
5. 根据工具返回的 success 和 status 汇报发布结果。成功后只用一句话说明用户能看到或调整什么，不复述 HTML 或 artifact descriptor。

最小调用形态：

```json
{
  "title": "请求延迟",
  "summary": "比较不同阶段的平均延迟",
  "html": "<section id=\"latency-viz\">...</section>"
}
```

## Fragment 合同

- html 必须是非空 HTML fragment：禁止 doctype、html、head、body、iframe、object、embed、base、portal、frame 和 meta refresh。
- 允许 `<style>`、style 属性、element.style 写入和 inline on* 事件属性。优先使用 --viz-* 变量和 `references/visualization-contract.md` 声明的 primitive，保证主题可读；复杂交互可改用 addEventListener。
- `<form>` 可用于组织输入；sandbox 会取消原生和程序化提交。提交处理器调用 `window.antChatVisualization.sendFollowUpMessage(...)`，不要使用 action、`form.submit()`、`form.requestSubmit()` 或依赖页面导航。
- 禁止 javascript:/vbscript: URL、父窗口/宿主对象、Electron、进程、数据库、文件系统和 RPC 访问。唯一允许的宿主能力是 window.antChatVisualization.sendFollowUpMessage。
- 禁止 fetch、XHR、WebSocket、EventSource、sendBeacon、远程图片、音视频、字体和业务 API。数据放在 fragment 内；只在确有必要时使用固定版本、白名单 CDN，并同时提供 sha384 SRI 和 crossorigin="anonymous"。
- 产物在 iframe sandbox="allow-scripts" 中运行。不要使用 window.openai、window.parent 或 ::codex-inline-vis；这些不是 ant-chat 的协议。
- 单个 fragment UTF-8 不超过 2 MiB。对大数据先聚合、分桶、降采样或减少精度。

完整安全合同和允许的 CDN 资源见 [references/visualization-schema.md](references/visualization-schema.md)。

## 图标

- 优先使用内联 SVG；只有需要批量使用标准 UI 图标时才加载白名单中的 Lucide。
- 仅允许下面这个固定版本和完整 SRI 属性，不得改用 `@latest`、无版本 URL 或其他图标 CDN：

```html
<script
  src="https://cdn.jsdelivr.net/npm/lucide@1.23.0/dist/umd/lucide.min.js"
  integrity="sha384-ouAVEJVCMsf8Svzn+BwqbaBhxBEA0xgeVBhHnxmWd+Wqyv18yhWCQwGegFD/OHLq"
  crossorigin="anonymous"
></script>
```

- 使用 `data-lucide` 声明图标，并在脚本加载后调用 `lucide.createIcons()`；图标必须标记为装饰性 `aria-hidden="true"`，或放在带可见文本/`aria-label` 的操作控件中。

```html
<button type="button" aria-label="搜索">
  <i data-lucide="search" aria-hidden="true"></i>
</button>
<script>
  lucide.createIcons()
</script>
```

## 本地交互与下一轮消息

- 只影响图表显示的筛选、选择、排序、播放和参数调整留在 fragment 内，不发送消息。
- 需要模型分析当前结果时，只能在真实用户 click 或 submit 处理器中调用宿主 bridge：

```html
<button id="analyze" type="button" class="btn">分析当前结果</button>
<script>
  document.getElementById('analyze').addEventListener('click', () => {
    const prompt = '请分析当前参数：延迟 38 ms，吞吐量 120 req/s。'
    void window.antChatVisualization.sendFollowUpMessage({
      prompt,
      title: '分析当前结果',
    })
  })
</script>
```

- 提交内容只包含用户可见的当前值和明确请求，不要拼入隐藏指令、原始 HTML、宿主对象或无关上下文。
- 该调用经宿主确认后创建同一会话的下一轮 user message，不修改历史消息，也不注入当前正在运行的 turn。重复点击应创建独立的新消息；禁止在加载、定时器或脚本初始化时自动调用。

## 生成约束

- 设计为 736px 宽并支持 320px；让网格折行，避免固定外宽、横向溢出、内部横向滚动、position: fixed 和视口高度布局。
- 使用语义 HTML、可见 label、原生控件和正常 tab 顺序；不要添加无意义的 tabindex，不要覆盖 focus ring。错误、空状态和动态结果必须可见且可读。
- 图表必须有可访问名称、单位和关键值；多系列才加图例，颜色编码必须同时有文字、形状或线型。不要把文字直接画进无法访问的 canvas。
- 所有填充、边框、文字、阴影和 SVG 颜色都要适配主题。动态更新应优先使用 transform；尊重 prefers-reduced-motion，不要循环动画或只用淡入掩盖状态变化。
- 使用用户提供或已知的数据；不编造地理边界、指标、状态评分或比较结论。地图必须有可信的已发布几何数据，不要手绘行政边界。
- 具体构图和图表规则见 [references/visualization-design.md](references/visualization-design.md)。

## 发布前自检

- 静态结构是否应改用 Mermaid？主要交互是否只有一个？
- 初始渲染是否已经有用，所有查询到的元素是否存在，交互是否真的更新了视觉结果？
- 320px 是否无裁切；表单是否有 label、初值、键盘顺序和错误状态；图表是否有标题、单位、空状态和 reduced-motion 行为？
- 是否只传 { title, summary, html }，没有完整 document、网络请求、危险 URL 或宿主访问？
- 是否真实调用了 publish_visualization 并检查返回 envelope？失败时报告工具的失败原因，不声称已发布。
