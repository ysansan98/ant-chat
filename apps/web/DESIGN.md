## 1. 设计关键词

**Kami 纸感 / Paper UI**

整体气质：

> 米白纸张背景、深蓝黑文字、低对比边框、柔和阴影、信息卡片化、强调色克制使用。

适合：

- 文档站
- 知识库
- Issue / Note 系统
- AI Chat / Agent Workspace
- 个人工具产品
- 本地优先应用

---

## 2. 色彩系统

### Tailwind v4 / shadcn tokens

```css
@import 'tailwindcss';
@import 'tw-animate-css';

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(0.972 0.012 88);
  --foreground: oklch(0.205 0.035 255);

  --card: oklch(0.985 0.008 88);
  --card-foreground: oklch(0.205 0.035 255);

  --popover: oklch(0.985 0.008 88);
  --popover-foreground: oklch(0.205 0.035 255);

  --primary: oklch(0.315 0.075 255);
  --primary-foreground: oklch(0.985 0.005 88);

  --secondary: oklch(0.93 0.014 88);
  --secondary-foreground: oklch(0.28 0.035 255);

  --muted: oklch(0.925 0.012 88);
  --muted-foreground: oklch(0.47 0.025 255);

  --accent: oklch(0.69 0.135 230);
  --accent-foreground: oklch(0.12 0.03 255);

  --destructive: oklch(0.57 0.18 25);
  --destructive-foreground: oklch(0.98 0.005 88);

  --border: oklch(0.86 0.012 88);
  --input: oklch(0.86 0.012 88);
  --ring: oklch(0.52 0.09 230);

  --radius: 0.75rem;
}

.dark {
  --background: oklch(0.18 0.015 255);
  --foreground: oklch(0.94 0.008 88);

  --card: oklch(0.22 0.018 255);
  --card-foreground: oklch(0.94 0.008 88);

  --popover: oklch(0.22 0.018 255);
  --popover-foreground: oklch(0.94 0.008 88);

  --primary: oklch(0.78 0.06 230);
  --primary-foreground: oklch(0.16 0.02 255);

  --secondary: oklch(0.27 0.018 255);
  --secondary-foreground: oklch(0.9 0.008 88);

  --muted: oklch(0.28 0.018 255);
  --muted-foreground: oklch(0.68 0.015 88);

  --accent: oklch(0.68 0.12 230);
  --accent-foreground: oklch(0.12 0.03 255);

  --destructive: oklch(0.62 0.17 25);
  --destructive-foreground: oklch(0.98 0.005 88);

  --border: oklch(0.32 0.018 255);
  --input: oklch(0.32 0.018 255);
  --ring: oklch(0.64 0.1 230);
}
```

---

## 3. Tailwind v4 theme 映射

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);

  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);

  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);

  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);

  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);

  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);

  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);

  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);

  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}
```

---

## 4. 全局基础样式

```css
@layer base {
  * {
    @apply border-border outline-ring/50;
  }

  html {
    @apply scroll-smooth;
  }

  body {
    @apply bg-background text-foreground antialiased;
    font-feature-settings:
      'rlig' 1,
      'calt' 1;
  }

  ::selection {
    @apply bg-accent/25 text-foreground;
  }
}
```

---

## 5. 字体建议

### 中文

建议：

```css
font-family: 'LXGW WenKai Screen', 'Noto Serif SC', 'Source Han Serif SC', serif;
```

如果想更接近截图里的纸张文档感，可以标题用衬线，正文用系统无衬线。

```css
--font-sans: 'Inter', 'Noto Sans SC', system-ui, sans-serif;
--font-serif: 'Noto Serif SC', 'Source Han Serif SC', serif;
--font-mono: 'JetBrains Mono', 'SFMono-Regular', monospace;
```

---

## 6. 排版系统

```text
<h1 className="text-5xl font-semibold tracking-tight text-foreground">
  Kami 纸
</h1>

<p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
  轻盈、纸感、低饱和，适合文档、知识库和本地优先工具。
</p>

<h2 className="mt-16 text-2xl font-semibold tracking-tight">
  基础组件
</h2>

<p className="mt-2 text-sm leading-7 text-muted-foreground">
  使用充足留白和低对比边框建立安静的阅读节奏。
</p>
```

推荐字号：

| 场景     | class                                   |
| -------- | --------------------------------------- |
| 大标题   | `text-5xl font-semibold tracking-tight` |
| 页面标题 | `text-3xl font-semibold tracking-tight` |
| 分组标题 | `text-2xl font-semibold`                |
| 卡片标题 | `text-base font-medium`                 |
| 正文     | `text-sm leading-7`                     |
| 辅助文字 | `text-xs text-muted-foreground`         |

---

## 7. 卡片风格

```text
<Card className="border-border/70 bg-card/80 shadow-sm">
  <CardHeader>
    <CardTitle className="text-base font-medium">Design Tokens</CardTitle>
    <CardDescription>
      用低对比边框和柔和背景承载信息。
    </CardDescription>
  </CardHeader>
  <CardContent>
    ...
  </CardContent>
</Card>
```

推荐 class：

```text
"rounded-xl border border-border/70 bg-card/80 shadow-sm"
```

---

## 8. Button 风格

```text
<Button className="rounded-full">
  Primary
</Button>

<Button variant="secondary" className="rounded-full">
  Secondary
</Button>

<Button variant="outline" className="rounded-full bg-card/60">
  Outline
</Button>

<Button variant="ghost" className="rounded-full">
  Ghost
</Button>
```

按钮气质建议：

- 少用大面积纯色
- 主按钮用深蓝黑
- 次按钮用米白 / 灰白
- 圆角偏大，接近胶囊形

---

## 9. 输入框

```text
<Input
  placeholder="Search notes..."
  className="h-10 rounded-xl bg-card/70 border-border/70"
/>

<Textarea
  placeholder="Write something..."
  className="min-h-32 rounded-xl bg-card/70 border-border/70"
/>
```

---

## 10. Badge

```text
<Badge variant="secondary" className="rounded-full">
  Local First
</Badge>

<Badge className="rounded-full bg-primary text-primary-foreground">
  Kami
</Badge>

<Badge variant="outline" className="rounded-full bg-card/60">
  Draft
</Badge>
```

---

## 11. 页面布局模板

```text
export function KamiPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <section className="mb-20">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Design System
          </p>

          <h1 className="max-w-3xl text-5xl font-semibold tracking-tight">
            Kami 纸
          </h1>

          <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground">
            一套低饱和、纸张感、适合知识型产品的 shadcn + Tailwind CSS v4 设计系统。
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-card/80 p-5 shadow-sm">
            <h3 className="text-base font-medium">Paper Surface</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              使用米白背景和低对比边框。
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/80 p-5 shadow-sm">
            <h3 className="text-base font-medium">Quiet Contrast</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              信息层级依赖字号、留白和透明度。
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/80 p-5 shadow-sm">
            <h3 className="text-base font-medium">Soft Accent</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              蓝色只作为操作与焦点色使用。
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
```

---

## 12. 组件风格规范

| 组件       | 风格建议                                           |
| ---------- | -------------------------------------------------- |
| Card       | `bg-card/80 border-border/70 shadow-sm rounded-xl` |
| Button     | `rounded-full`，主按钮深蓝黑                       |
| Input      | `bg-card/70 rounded-xl`                            |
| Dialog     | 纸张卡片感，避免纯白                               |
| Dropdown   | `bg-popover/95 backdrop-blur`                      |
| Sidebar    | 米白背景，选中项浅蓝或深蓝                         |
| Table      | 低对比分割线，行高宽松                             |
| Code Block | 深色背景，圆角大一点                               |
| Badge      | 胶囊形，小字号                                     |

---

## 13. 推荐 shadcn 配置倾向

```json
{
  "style": "new-york",
  "baseColor": "neutral",
  "cssVariables": true,
  "iconLibrary": "lucide"
}
```

这套图的气质更接近 `new-york`，比 `default` 更克制、更文档化。
