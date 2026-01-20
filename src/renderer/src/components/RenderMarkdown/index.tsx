import type { RenderMarkdownProps } from './RenderMarkdown'
import React from 'react'
import Loading from '../Loading'

const RenderMarkdown = React.lazy(() => import('./RenderMarkdown'))

export default function (props: RenderMarkdownProps) {
  return (
    <React.Suspense fallback={<Loading />}>
      <RenderMarkdown {...props} />
    </React.Suspense>
  )
}
