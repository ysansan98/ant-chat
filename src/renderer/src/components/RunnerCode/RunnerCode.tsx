import { Drawer } from 'antd'
import React from 'react'
import Loading from '../Loading'
import { useRunnerCodeContext } from './context/useRunnerCodeContext'

const MermaidDiagram = React.lazy(() => import('@/components/MermaidCanvas'))
const RenderHTML = React.lazy(() => import('./RenderHTML'))

function RunnerCode() {
  const { config, resetConfig } = useRunnerCodeContext()

  const open = !!(config?.code && config?.language)

  return (
    <Drawer
      title="Runner Code"
      open={open}
      onClose={() => {
        resetConfig()
      }}
      placement="bottom"
      size={window.innerHeight - 80}
    >

      <React.Suspense fallback={<Loading />}>
        {
          config.language === 'mermaid' && (
            <MermaidDiagram>
              {config.code}
            </MermaidDiagram>
          )
        }
        {
          config.language === 'html' && (
            <RenderHTML />
          )
        }
      </React.Suspense>

    </Drawer>
  )
}

export default RunnerCode
