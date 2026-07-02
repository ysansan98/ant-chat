import { vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

Element.prototype.scrollTo = vi.fn()

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
