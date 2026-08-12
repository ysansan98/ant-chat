import { setWasmSource as setDocxWasmSource } from '@extend-ai/react-docx'
import docxWasmUrl from '@extend-ai/react-docx/docx_wasm_bg.wasm?url'

/**
 * WASM 资源配置：Excel（@dukelib/sheets-wasm）与 DOCX 的 WASM 模块。
 *
 * Vite ?url import 在 dev（dev server URL）与 prod（hash 命名的静态资源 URL）下
 * 都能正确解析；Electron prod 用 file:// 加载，相对路径相对于 index.html 解析，
 * WASM 在 out/renderer/assets/ 下可正确加载。
 *
 * setWasmSource 必须在首次解析 workbook 前调用一次，且源不可在初始化后变更。
 */
import { setWasmSource as setXlsxWasmSource } from '@extend-ai/react-xlsx'
import xlsxWasmUrl from '@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm?url'

let initialized = false

/** 初始化 Excel 与 DOCX 的 WASM 资源路径（幂等，仅首次生效）。 */
export function initPreviewWasm(): void {
  if (initialized) {
    return
  }
  initialized = true
  setXlsxWasmSource(xlsxWasmUrl)
  setDocxWasmSource(docxWasmUrl)
}
