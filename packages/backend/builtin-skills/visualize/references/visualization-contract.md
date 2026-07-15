# Visualization 样式契约

可视化运行在隔离 iframe 中。宿主创建 iframe 时会先写入当前应用主题，之后在主题切换时通过 MessagePort 更新下列 `--viz-*` token。值由当前应用主题决定，fragment 只能消费变量，不能假设或硬编码具体色值、字体和圆角。

## 主题 token

### 颜色

- 画布与文字：`--viz-background`、`--viz-foreground`
- 表面：`--viz-card`、`--viz-card-foreground`、`--viz-border`、`--viz-input`
- 操作：`--viz-primary`、`--viz-primary-foreground`、`--viz-secondary`、`--viz-secondary-foreground`、`--viz-accent`、`--viz-accent-foreground`、`--viz-ring`
- 辅助和错误：`--viz-muted`、`--viz-muted-foreground`、`--viz-destructive`、`--viz-destructive-foreground`
- 图表序列：`--viz-chart-1` 至 `--viz-chart-5`

### 排版与形状

- 字体：`--viz-font-sans`
- 基准圆角：`--viz-radius`

所有自定义颜色、`fill`、`stroke`、背景、边框、字体和圆角都必须从这些 token 派生。例如：`color: var(--viz-foreground)`、`border-radius: var(--viz-radius)`。

## 可用 primitive

- `.viz-root`：最大宽度 704px 的内容根容器，水平居中。
- `.viz-grid`：响应式卡片网格；默认间距 16px，窄屏自动换列。
- `.viz-row`、`.viz-controls`：可换行的水平控件组；默认间距 8px。
- `.card`：`card` 表面、`border` 边框和宿主圆角的内容容器。
- `.btn`、`button`：主操作，使用 `primary`/`primary-foreground`。
- `.btn-secondary`：次操作，使用 `secondary`/`secondary-foreground`。
- `.form-control`、`.form-select`、`textarea`：输入控件，使用 `input`、`card`、`foreground` 和宿主圆角。
- `.form-check`、`.form-switch`、`.form-range`：原生复选、开关与范围输入的布局和强调色。
- `.text-muted`：辅助文字，使用 `muted-foreground`。
- `.viz-error`：错误状态，使用 `destructive`。

不假设 Tailwind、shadcn、图标库或其他 class 可用。

## 自定义样式

允许 `<style>`、行内 `style` 和脚本修改 `element.style`。自定义规则应以 fragment 的唯一根 id 限定作用域，例如 `#sales-viz .bar`，避免覆盖 `html`、`body` 或基础 primitive。

可以自定义布局、SVG、图表、局部状态和响应式规则；禁止 `@import`、远程字体、外链 `url(...)` 和硬编码设计系统颜色、字体、圆角。

## 表单提交

`<form>` 和 `type="submit"` 可以用于组织交互，但 sandbox 会自动取消原生、`form.submit()` 和 `form.requestSubmit()` 提交，避免 iframe 导航。提交处理器应调用 `window.antChatVisualization.sendFollowUpMessage(...)`；可自行调用 `event.preventDefault()`，但不是必须。
