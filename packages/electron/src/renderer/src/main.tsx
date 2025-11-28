import { enableMapSet } from 'immer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'

import { scan } from 'react-scan'
import router from './routers/index.tsx'
import './index.css'

enableMapSet()

if (import.meta.env.DEV) {
  scan({
    enabled: true,
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
