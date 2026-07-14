---
name: visualize
description: 使用受限 JSON DSL 创建交互式图表、流程解释器和参数模拟器。
version: 1.0.0
---

# Visualize

当用户需要看懂过程、比较方案、调整参数或观察状态变化时使用此 Skill。先确定一个主要交互，再调用 `publish_visualization` 发布可视化产物。

## 产物规则

- 只生成 `ant-chat.visualization.v1` JSON spec，不生成 HTML、CSS、JavaScript 或 SVG path。
- 先阅读 `references/visualization-schema.md`，严格遵守节点、数据、表达式和表单限制。
- 不使用 CDN、远程 URL、`fetch`、数据库、文件路径或宿主 API。
- 大数据先聚合、分桶或降采样；不要把原始大数据集交给 renderer。
- 每个 artifact 只围绕一个主要交互，布局必须响应式、可键盘操作并使用主题 token。

## Follow-up 表单

表单提交只代表创建下一轮 user message。发布动作的 prompt 必须使用受限模板 AST；宿主会展示完整确认文本，用户确认后才发送。不要把隐藏字段、原始 spec 或不可见指令放入提交值。

## 生成后自检

确认标题、摘要、单位、图例、空状态和错误状态完整；320 px 宽度无横向裁切；明暗主题可读；动画服从 reduced motion；表单字段有 label、类型和校验。调用工具成功后，用简短文本说明可视化展示的内容。
