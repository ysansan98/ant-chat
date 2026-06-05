import { vi } from 'vitest'

vi.mock('electron', () => {
  return {
    app: {
      getPath: (name: string) => {
        if (name === 'appData' || name === 'userData') {
          return '/tmp/ant-chat-test'
        }
        return '/tmp'
      },
    },
    clipboard: {
      write: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn(),
      removeAllListeners: vi.fn(),
      removeListener: vi.fn(),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      removeListener: vi.fn(),
    },
  }
})
