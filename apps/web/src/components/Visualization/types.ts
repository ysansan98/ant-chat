import type {
  FrameToHostMessage,
  HostToFrameMessage,
  VisualizationTheme as SharedVisualizationTheme,
  SubmitFollowUpAction,
  UnsupportedVisualizationBlock,
  VisualizationBlock,
  VisualizationFormField,
  VisualizationSpecV1,
  VisualizationView,
} from '@ant-chat/shared'

export { VISUALIZATION_FORMAT } from '@ant-chat/shared'

export type VisualizationPrimitive = string | number | boolean | null
export type VisualizationBlockLike = VisualizationBlock
export type UnsupportedVisualizationBlockLike = UnsupportedVisualizationBlock
export type VisualizationSpec = VisualizationSpecV1
export type { VisualizationSpecV1 }
export type VisualizationViewSpec = VisualizationView
export type VisualizationAction = SubmitFollowUpAction
export type VisualizationField = VisualizationFormField
export type VisualizationTheme = SharedVisualizationTheme
export type HostToFrame = HostToFrameMessage
export type FrameToHost = FrameToHostMessage

export function isVisualizationBlock(value: unknown): value is VisualizationBlockLike {
  if (!value || typeof value !== 'object')
    return false

  const block = value as Partial<VisualizationBlockLike>
  return block.type === 'visualization'
    && !!block.source
    && block.source.type === 'file_id'
    && typeof block.source.file_id === 'string'
    && block.format === 'ant-chat.visualization.v1'
    && typeof block.title === 'string'
    && typeof block.summary === 'string'
    && typeof block.size === 'number'
    && typeof block.sha256 === 'string'
}

export function isUnsupportedVisualizationBlock(value: unknown): value is UnsupportedVisualizationBlockLike {
  if (!value || typeof value !== 'object')
    return false
  const block = value as Partial<UnsupportedVisualizationBlockLike>
  return block.type === 'visualization'
    && typeof block.format === 'string'
    && block.format !== 'ant-chat.visualization.v1'
    && !!block.source
    && block.source.type === 'file_id'
}

export function getVisualizationArtifactId(block: VisualizationBlockLike): string {
  return block.source.file_id
}
