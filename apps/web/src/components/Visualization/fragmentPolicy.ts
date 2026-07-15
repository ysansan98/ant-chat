import { validateVisualizationHtmlFragment } from '@ant-chat/shared'

export { validateVisualizationHtmlFragment }

export function assertVisualizationHtmlFragment(fragment: string): void {
  const error = validateVisualizationHtmlFragment(fragment)
  if (error)
    throw new Error(`可视化 HTML 校验失败：${error}`)
}
