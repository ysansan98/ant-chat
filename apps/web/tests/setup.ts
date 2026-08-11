import { vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

Element.prototype.scrollTo = vi.fn()
Element.prototype.scrollIntoView = vi.fn()

if (!globalThis.PointerEvent) {
  class PointerEventMock extends MouseEvent {
    pointerId: number
    pointerType: string
    isPrimary: boolean

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? 'mouse'
      this.isPrimary = init.isPrimary ?? true
    }
  }

  Object.defineProperty(globalThis, 'PointerEvent', {
    value: PointerEventMock,
    writable: true,
  })
}

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'electron', {
    value: {
      ipcRenderer: {
        invoke: vi.fn(),
        on: vi.fn(),
        removeAllListeners: vi.fn(),
        removeListener: vi.fn(),
      },
      process: {
        platform: 'darwin',
      },
    },
    writable: true,
  })
}
