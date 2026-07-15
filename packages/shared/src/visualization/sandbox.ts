import { validateVisualizationHtmlFragment } from '../schemas/visualization'

export const VISUALIZATION_CSP = 'default-src \'none\'; connect-src \'none\'; img-src data:; media-src \'none\'; font-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'; worker-src \'none\''

export const VISUALIZATION_PREVIEW_THEME_CSS: string = `:root {
  --viz-mode: light;
  --viz-background: Canvas;
  --viz-foreground: CanvasText;
  --viz-card: Canvas;
  --viz-card-foreground: CanvasText;
  --viz-primary: Highlight;
  --viz-primary-foreground: HighlightText;
  --viz-secondary: ButtonFace;
  --viz-secondary-foreground: ButtonText;
  --viz-muted: ButtonFace;
  --viz-muted-foreground: GrayText;
  --viz-accent: Highlight;
  --viz-accent-foreground: HighlightText;
  --viz-destructive: CanvasText;
  --viz-destructive-foreground: Canvas;
  --viz-border: ButtonBorder;
  --viz-input: Field;
  --viz-ring: Highlight;
  --viz-font-sans: ui-sans-serif, system-ui, sans-serif;
  --viz-radius: 0.625rem;
  --viz-chart-1: CanvasText;
  --viz-chart-2: CanvasText;
  --viz-chart-3: CanvasText;
  --viz-chart-4: CanvasText;
  --viz-chart-5: CanvasText;
  color-scheme: light;
}`

export function createVisualizationSandboxShell(options: {
  fragment: string
  css: string
  themeCss: string
  runtime: string
  cdnOrigins: readonly string[]
}): string {
  const policyError = validateVisualizationHtmlFragment(options.fragment)
  if (policyError)
    throw new Error(`可视化 HTML 校验失败：${policyError}`)
  // fragment 运行在 opaque-origin iframe 中，只能经受控 MessagePort 请求 follow-up。
  // 因此允许内联样式和事件属性，避免模型为等价写法产生失败重试。
  const csp = `${VISUALIZATION_CSP}; script-src 'unsafe-inline' ${options.cdnOrigins.join(' ')}; style-src 'unsafe-inline' ${options.cdnOrigins.join(' ')}`
  const runtime = options.runtime.replace(/<\/script/gi, '<\\/script')
  const themeCss = options.themeCss.replace(/<\/style/gi, '<\\/style')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${options.css}</style><style id="ant-chat-viz-theme">${themeCss}</style><script>${runtime}</script></head><body style="background:var(--viz-background)"><main class="viz-root">${options.fragment}</main></body></html>`
}
