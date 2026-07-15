#!/usr/bin/env node
/* eslint-disable antfu/no-import-dist */
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createVisualizationSandboxShell, getAllowedVisualizationCdnOrigins, VISUALIZATION_PREVIEW_THEME_CSS, visualizationRuntimeSource } from '../packages/shared/dist/index.mjs'

const args = process.argv.slice(2)
const serve = args[0] === '--serve'
const inputPath = args[serve ? 1 : 0]
const outputPath = args[serve ? 2 : 1] ?? 'visualization-preview.html'

if (!inputPath) {
  console.error('用法：pnpm visualize:render <fragment.html> [output.html]')
  console.error('或：pnpm visualize:render --serve <fragment.html>')
  process.exit(1)
}

const fragment = await readFile(inputPath, 'utf8')
const cssPath = fileURLToPath(new URL('../apps/web/src/components/Visualization/visualization.css', import.meta.url))
const css = await readFile(cssPath, 'utf8')
const document = createVisualizationSandboxShell({
  fragment,
  css,
  themeCss: VISUALIZATION_PREVIEW_THEME_CSS,
  runtime: visualizationRuntimeSource,
  cdnOrigins: getAllowedVisualizationCdnOrigins(),
})

if (!serve) {
  await writeFile(outputPath, document, 'utf8')
  console.log(`已生成 ${outputPath}`)
}
else {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(document)
  })
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (address && typeof address === 'object')
      console.log(`可视化预览：http://127.0.0.1:${address.port}`)
  })
}
