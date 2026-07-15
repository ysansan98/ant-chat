import { getAllowedVisualizationCdnOrigins, isAllowedVisualizationCdnUrl } from '@ant-chat/shared'

export { getAllowedVisualizationCdnOrigins, isAllowedVisualizationCdnUrl }

export function validateVisualizationCdnUrl(url: string): string | null {
  return isAllowedVisualizationCdnUrl(url) ? null : `外部资源不在固定 CDN 白名单：${url}`
}
