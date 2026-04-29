import log from 'electron-log'
import { vi } from 'vitest'
import '@testing-library/jest-dom'

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
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  }
})

log.transports.file.setAppName('test')

Object.defineProperty(window, 'electron', {
  value: {
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  },
  writable: true,
})
