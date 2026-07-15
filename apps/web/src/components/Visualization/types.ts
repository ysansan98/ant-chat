import type {
  FrameToHostMessage,
  HostToFrameMessage,
  VisualizationTheme as SharedVisualizationTheme,
  VisualizationBlock,
} from '@ant-chat/shared'
import { VISUALIZATION_FORMAT } from '@ant-chat/shared'

export { VISUALIZATION_FORMAT }

export type VisualizationBlockLike = VisualizationBlock
export type VisualizationTheme = SharedVisualizationTheme
export type HostToFrame = HostToFrameMessage
export type FrameToHost = FrameToHostMessage

export function isVisualizationBlock(value: unknown): value is VisualizationBlockLike {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const block = value as Partial<VisualizationBlockLike>
  return block.type === 'visualization'
    && block.format === VISUALIZATION_FORMAT
    && Boolean(block.source && block.source.type === 'file_id')
    && typeof block.title === 'string'
    && typeof block.summary === 'string'
    && typeof block.size === 'number'
    && typeof block.sha256 === 'string'
}

export function getVisualizationArtifactId(block: VisualizationBlockLike): string {
  return block.source.file_id
}
