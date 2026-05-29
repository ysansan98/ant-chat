import { vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

Element.prototype.scrollTo = vi.fn()

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'electron', {
    value: {
      ipcRenderer: {
        invoke: vi.fn(),
        on: vi.fn(),
        removeAllListeners: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    writable: true,
  })
}
