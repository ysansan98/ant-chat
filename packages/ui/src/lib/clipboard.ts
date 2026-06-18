let installCount = 0
let uninstallClipboardFallbacks: (() => void) | null = null

export async function writeClipboardText(text: string): Promise<void> {
  if (typeof window === 'undefined') {
    throw new TypeError('Clipboard API not available')
  }

  try {
    if (!navigator.clipboard?.writeText) {
      throw new TypeError('Clipboard API not available')
    }

    await navigator.clipboard.writeText(text)
    return
  }
  catch {
    // Electron/webview 等环境可能暴露 Clipboard API 但拒绝写入，继续走 DOM 兜底。
  }

  if (copyTextBySelection(text)) {
    return
  }

  throw new TypeError('Clipboard API not available')
}

export function installClipboardTextFallback(): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  installCount += 1
  if (uninstallClipboardFallbacks) {
    return releaseClipboardFallback
  }

  const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard')
    ?? Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const originalClipboard = navigator.clipboard
  const clipboard = originalClipboard ?? ({} as Clipboard)
  const originalWriteText = clipboard.writeText?.bind(clipboard)
  const originalWrite = clipboard.write?.bind(clipboard)

  const fallbackClipboard = {
    ...clipboard,
    write: async (items: ClipboardItems) => {
      try {
        if (originalWrite) {
          await originalWrite(items)
          return
        }
      }
      catch {
        // 第三方组件只知道调用 Clipboard API，这里把失败转成可用的文本复制。
      }

      const text = await getTextFromClipboardItems(items)
      if (text == null) {
        throw new Error('Clipboard item does not contain text/plain')
      }

      await writeTextWithOriginalFallback(text, originalWriteText)
    },
    writeText: (text: string) => writeTextWithOriginalFallback(text, originalWriteText),
  } satisfies Clipboard

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: fallbackClipboard,
  })

  uninstallClipboardFallbacks = () => {
    if (descriptor) {
      Object.defineProperty(navigator, 'clipboard', descriptor)
      return
    }

    Reflect.deleteProperty(navigator, 'clipboard')
  }

  return releaseClipboardFallback
}

function releaseClipboardFallback() {
  installCount = Math.max(0, installCount - 1)
  if (installCount > 0 || !uninstallClipboardFallbacks) {
    return
  }

  uninstallClipboardFallbacks()
  uninstallClipboardFallbacks = null
}

async function writeTextWithOriginalFallback(
  text: string,
  originalWriteText?: (text: string) => Promise<void>,
): Promise<void> {
  try {
    if (originalWriteText) {
      await originalWriteText(text)
      return
    }
  }
  catch {
    // 原生写入失败时降级到 selection 复制。
  }

  if (copyTextBySelection(text)) {
    return
  }

  throw new Error('Clipboard API not available')
}

async function getTextFromClipboardItems(items: ClipboardItems): Promise<string | null> {
  for (const item of items) {
    if (!item.types.includes('text/plain')) {
      continue
    }

    return item.getType('text/plain').then(blobToText)
  }

  return null
}

function blobToText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text()
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read clipboard text')))
    reader.readAsText(blob)
  })
}

function copyTextBySelection(text: string): boolean {
  const { document } = window
  const activeElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  const selection = document.getSelection()
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
    : []
  const textarea = document.createElement('textarea')

  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.width = '1px'
  textarea.style.height = '1px'
  textarea.style.opacity = '0'

  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  let copied = false
  try {
    copied = document.execCommand('copy')
  }
  finally {
    document.body.removeChild(textarea)
    if (selection) {
      selection.removeAllRanges()
      for (const range of ranges) {
        selection.addRange(range)
      }
    }
    activeElement?.focus()
  }

  return copied
}
