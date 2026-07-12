import { enableMapSet } from 'immer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'

import { applyInitialTheme } from './hooks/useThemeApplier.ts'
import router from './routers/index.tsx'
import '@workspace/ui/globals.css'
import './index.css'

// React 启动前使用本地缓存应用首帧主题
applyInitialTheme()

enableMapSet()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
