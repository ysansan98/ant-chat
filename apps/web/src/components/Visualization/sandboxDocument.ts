import { createVisualizationSandboxShell, VISUALIZATION_CSP } from '@ant-chat/shared'
import { getAllowedVisualizationCdnOrigins } from './cdnPolicy'
import { visualizationRuntimeSource } from './runtime/runtimeSource'
import visualizationCss from './visualization.css?inline'

export { VISUALIZATION_CSP }

export function createVisualizationSandboxDocument(fragment: string): string {
  return createVisualizationSandboxShell({
    fragment,
    css: visualizationCss,
    runtime: visualizationRuntimeSource,
    cdnOrigins: getAllowedVisualizationCdnOrigins(),
  })
}
