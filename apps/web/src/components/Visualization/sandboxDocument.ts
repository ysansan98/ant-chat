import type { VisualizationTheme } from '@ant-chat/shared'
import { createVisualizationSandboxShell, VISUALIZATION_CSP } from '@ant-chat/shared'
import { getAllowedVisualizationCdnOrigins } from './cdnPolicy'
import { visualizationRuntimeSource } from './runtime/runtimeSource'
import visualizationCss from './visualization.css?inline'

export { VISUALIZATION_CSP }

function createVisualizationThemeCss(theme: VisualizationTheme): string {
  const declarations = Object.entries(theme.tokens).map(([key, value]) => {
    const cssName = `--viz-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`
    return `${cssName}:${value.replace(/[{};]/g, '')}`
  })
  declarations.push(`--viz-mode:${theme.mode}`, `color-scheme:${theme.mode}`)
  return `:root{${declarations.join(';')};}`
}

export function createVisualizationSandboxDocument(fragment: string, theme: VisualizationTheme): string {
  return createVisualizationSandboxShell({
    fragment,
    css: visualizationCss,
    themeCss: createVisualizationThemeCss(theme),
    runtime: visualizationRuntimeSource,
    cdnOrigins: getAllowedVisualizationCdnOrigins(),
  })
}
