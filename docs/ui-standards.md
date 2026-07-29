# UI 规范（Agent 可读）

本文件是 UI 代码的强制约束。所有新增和修改的 renderer 代码必须遵守。
设计方向：Kami 纸感（详见 `apps/web/DESIGN.md`）——米白背景、低对比边框、克制用色、信息卡片化。

技术栈：Tailwind CSS v4 + shadcn/ui（packages/ui）+ lucide-react 图标。

---

## 1. 颜色

### 规则

只允许使用语义色 token，禁止使用 Tailwind 原始色板（gray-500、red-500 等）。

```tsx
// 正确
<p className="text-muted-foreground">辅助文字</p>
<div className="bg-muted border-border">容器</div>
<span className="text-destructive">错误信息</span>

// 错误 — 切换主题时会失效
<p className="text-gray-500">辅助文字</p>
<div className="bg-slate-100 border-gray-200">容器</div>
```

### 语义色速查

| 用途 | token |
|------|-------|
| 正文 | `text-foreground` |
| 辅助/次要文字 | `text-muted-foreground` |
| 操作/链接 | `text-primary` |
| 危险/错误 | `text-destructive` |
| 页面背景 | `bg-background` |
| 卡片/面板背景 | `bg-card` |
| 次级容器 | `bg-muted` |
| 悬停高亮 | `bg-accent` |
| 边框 | `border-border` |

### 状态色的唯一例外

需要表达"成功/警告/进行中"等语义状态时，使用以下固定映射，不得自选颜色：

| 状态 | 文字 | 背景 | 边框 |
|------|------|------|------|
| 成功 | `text-emerald-700 dark:text-emerald-400` | `bg-emerald-500/10` | `border-emerald-500/30` |
| 警告 | `text-amber-700 dark:text-amber-400` | `bg-amber-500/10` | `border-amber-500/30` |
| 错误 | `text-destructive` | `bg-destructive/10` | `border-destructive/30` |
| 信息 | `text-primary` | `bg-primary/10` | `border-primary/30` |

禁止在状态色之外使用任何原始色板值。

---

## 2. 字号与字重

### 字号层级（只允许这 5 级）

| 层级 | class | 场景 |
|------|-------|------|
| 页面标题 | `text-xl font-semibold` | 设置页标题、对话框标题 |
| 区块标题 | `text-base font-medium` | 卡片标题、分组标题 |
| 正文 | `text-sm` | 列表项、表单标签、段落 |
| 辅助文字 | `text-xs text-muted-foreground` | 时间戳、描述、提示 |
| 微标注 | `text-[11px] text-muted-foreground` | 角标、badge 内文字（仅此一处允许任意值） |

### 禁止

- 禁止 `text-[13px]`、`text-[10px]`、`text-[14px]` 等任意字号。13px 用 `text-xs`（12px）或 `text-sm`（14px）二选一。
- 禁止 `font-bold`（过重，破坏纸感）。需要强调用 `font-semibold`。
- 同一卡片/面板内最多出现 3 种字号。

### 字重

只用 `font-medium`（常规强调）和 `font-semibold`（标题）。正文不加字重 class。

---

## 3. 间距

### 间距阶梯（只允许以下值）

| 级别 | 值 | 场景 |
|------|-----|------|
| 紧凑 | `gap-1` / `p-1` | 图标与文字、badge 内部 |
| 常规 | `gap-2` / `p-2` | 列表项内部、按钮组、表单项 |
| 宽松 | `gap-3` / `p-3` | 卡片内边距、区块内部 |
| 区块 | `gap-4` / `p-4` | 卡片之间、表单分组 |
| 页面 | `p-6` | 页面容器内边距 |
| 大留白 | `gap-8` / `py-8` | 空状态、section 之间 |

### 规则

- 组件内部用 `gap`（flex/grid），不用 margin 撑间距。
- 区块之间用 `space-y-3` 或 `space-y-4`，不逐个子元素加 `mt-*`。
- 允许 Tailwind 标准半级值：`0.5`、`1.5`、`2.5`（如 `gap-1.5`、`py-2.5`、`space-y-1.5`）。
- 禁止 `mt-[13px]`、`w-[347px]` 等任意像素值。宽度用 `max-w-*` 或 `w-full`。
- 禁止 `gap-3.5`、`p-4.5` 等不存在的半级值（Tailwind 预设只到 x.5，不存在 x.5 以上的半级）。

### 页面容器标准

```tsx
// 设置页：使用 SettingsPageLayout 组件，不要自建容器
<SettingsPageLayout title="标题" variant="narrow">
  {children}
</SettingsPageLayout>

// 非设置页的通用内容区
<div className="flex h-full flex-col overflow-y-auto p-6">
  <div className="mx-auto w-full max-w-3xl">
    {children}
  </div>
</div>
```

---

## 4. 圆角

### 层级规则

| 层级 | class | 场景 |
|------|-------|------|
| 小型元素 | `rounded-sm` | badge、tag、小按钮 |
| 常规交互 | `rounded-md` | 按钮、输入框、下拉项 |
| 卡片/面板 | `rounded-lg` | Card、对话框内容区 |
| 大容器 | `rounded-xl` | 模态框、Sheet、大面板 |
| 胶囊 | `rounded-full` | 头像、圆形图标按钮、pill badge |

### 禁止

- 同一层级混用圆角（如一个卡片 `rounded-lg`，内部子卡片 `rounded-xl`）。
- 嵌套元素圆角不得大于父容器。
- 禁止 `rounded-2xl`、`rounded-3xl`、`rounded-4xl`（过大，不符合纸感）。

---

## 5. 边框与阴影

### 原则：边框优先，阴影克制

- 默认分隔用 `border border-border`。
- 卡片标准样式：`rounded-lg border border-border bg-card`。
- 阴影只用于浮层：popover/dropdown 用 `shadow-md`，模态框用 `shadow-lg`。
- 禁止给普通卡片加 `shadow-*`（用边框 + 背景色区分层级）。
- 需要弱化边框时用 `border-border/70`（透明度），不换颜色。

---

## 6. 交互状态

### 所有可点击元素必须有 hover + transition

```tsx
// 列表项 / 可点击行
className="cursor-pointer rounded-md px-3 py-2 transition-colors hover:bg-accent"

// 图标按钮
className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"

// 文字链接
className="text-primary underline-offset-4 transition-colors hover:underline"
```

### 规则

- 每个可交互元素必须有 `transition-colors`（或 `transition-opacity`）。
- hover 背景统一用 `hover:bg-accent`，不用 `hover:bg-gray-100`、`hover:bg-black/5`。
- hover 文字统一用 `hover:text-foreground`。
- 禁用状态：`opacity-50 pointer-events-none`。
- focus 状态由 shadcn 组件内置处理（`ring-ring`），不要自定义。

### 动画

- 展开/收起：`duration-200 ease-out`。
- 淡入：`duration-150 ease-out`。
- 侧边栏等大面积过渡：`duration-300`。
- 必须尊重 `prefers-reduced-motion`（全局 CSS 已处理，自定义动画需自行加 media query）。
- 禁止 `transition-all`（性能差，且会导致意外属性被动画化）。用 `transition-colors`、`transition-opacity`、`transition-transform` 明确指定。

---

## 7. 按钮

### variant 选择

| 场景 | variant | 示例 |
|------|---------|------|
| 页面主操作（每页最多 1 个） | `default` | "保存设置" |
| 常规操作 | `outline` | "添加规则"、"导出" |
| 工具栏/行内操作 | `ghost` | 图标按钮、"取消" |
| 危险操作 | `destructive` | "删除"、"清空" |
| 次要确认 | `secondary` | "稍后再说" |

### 规则

- 同一视口内 `default` 按钮最多 1 个。
- 图标按钮用 `variant="ghost" size="icon"`。
- 按钮文字用 `text-sm font-medium`，不加额外字号 class。
- 按钮组间距：`gap-2`。

---

## 8. 组件使用规范

### 空状态

必须使用 `EmptyState` 组件（`@workspace/ui/components/empty-state`），禁止自己拼凑空状态 UI。

```tsx
import { EmptyState } from '@workspace/ui/components/empty-state'

<EmptyState
  icon={<ShieldIcon />}
  title="暂无权限规则"
  description="可以在这里主动添加，或在 Agent 审批时明确选择记住授权。"
/>
```

### 加载状态

- 局部加载：使用 `Spinner`（`@workspace/ui/components/spinner`）。
- 页面/区块加载：使用 `Skeleton`（`@workspace/ui/components/skeleton`）模拟内容形状。
- 禁止用纯文字"加载中..."作为加载状态。

### 对话框 / Sheet

- 确认操作用 `AlertDialog`。
- 表单/详情用 `Dialog` 或 `Sheet`（右侧抽屉）。
- 标题用 `text-base font-medium`，描述用 `text-sm text-muted-foreground`。

### 表单

- 使用 `Field` / `FieldLabel` / `FieldDescription` 组合（`@workspace/ui/components/field`）。
- 标签：`text-sm font-medium`。
- 描述：`text-xs text-muted-foreground`。
- 表单项间距：`space-y-4` 或 `gap-4`。

---

## 9. 图标

- 统一使用 `lucide-react`。
- 尺寸：行内图标 `size={16}`（`h-4 w-4`），独立图标按钮内 `size={18}`（`h-[18px] w-[18px]`），空状态图标 `size={24}`（`h-6 w-6`）。
- 颜色继承文字色，不单独设置（除非状态图标需要 `text-emerald-*` 等）。
- 禁止引入其他图标库。

---

## 10. 禁止清单

| 禁止 | 替代 |
|------|------|
| `style={{...}}` 内联样式 | Tailwind class（动态值用 CSS 变量） |
| `text-gray-*`、`bg-blue-*` 等原始色 | 语义 token |
| `text-[13px]`、`text-[10px]` | `text-xs` 或 `text-sm` |
| `font-bold` | `font-semibold` |
| `transition-all` | `transition-colors` / `transition-opacity` / `transition-transform` |
| `shadow-*` 用于非浮层元素 | `border border-border` |
| `rounded-2xl` 及以上 | `rounded-xl` 为上限 |
| `mt-[13px]`、`w-[347px]` 等任意像素值 | Tailwind 预设值（含标准半级 0.5/1.5/2.5） |
| 纯文字空状态 / 加载状态 | `EmptyState` / `Skeleton` / `Spinner` |
| antd / @ant-design 组件 | shadcn/ui 对应组件 |
| `hover:bg-gray-100`、`hover:bg-black/5` | `hover:bg-accent` |

---

## 11. Before / After 示例

### 列表项

```tsx
// Before — demo 感：无 hover、无过渡、原始色、任意字号
<div className="flex items-center gap-2.5 px-3 py-2" onClick={handleClick}>
  <span className="text-[13px] text-gray-700">{name}</span>
  <span className="text-[11px] text-gray-400">{time}</span>
</div>

// After — 有交互反馈、语义色、规范字号
<div
  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-accent"
  onClick={handleClick}
>
  <span className="text-sm text-foreground">{name}</span>
  <span className="text-xs text-muted-foreground">{time}</span>
</div>
```

### 卡片

```tsx
// Before — 阴影过重、圆角过大、内部间距随意
<div className="rounded-2xl bg-white p-5 shadow-lg">
  <h3 className="text-[14px] font-bold text-gray-900">标题</h3>
  <p className="mt-1.5 text-[13px] text-gray-500">描述内容</p>
</div>

// After — 纸感：边框分隔、克制圆角、规范层级
<div className="rounded-lg border border-border bg-card p-4">
  <h3 className="text-base font-medium text-foreground">标题</h3>
  <p className="mt-2 text-sm text-muted-foreground">描述内容</p>
</div>
```

---

## 12. 主题兼容

项目支持多主题（default / airbnb / cursor，各有 light/dark）。所有颜色必须走 CSS 变量，确保切换主题时 UI 自动适配。

验证方法：切换到 dark mode 和 airbnb 主题，页面上不应出现"刺眼的白色块"或"看不清的深色文字"。如果出现，说明某处硬编码了颜色。
