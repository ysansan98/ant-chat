import { enableMapSet } from 'immer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'

import router from './routers/index.tsx'
import './index.css'

enableMapSet()

if (import.meta.env.DEV) {
  import('react-scan').then((module) => {
    module.scan(
      {
        enabled: true,
      },
    )
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
