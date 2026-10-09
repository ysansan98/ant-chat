/**
 * 内置 Integration 的运行时探测结果。
 *
 * 探测用于回答"这个服务商现在能不能用"（例如 magpie 是否在本机运行），
 * 不参与配置校验：探测失败只表示当前不可用，不代表用户配置有误。
 */
export interface ProviderIntegrationProbe {
  id: string
  label: string
  available: boolean
  /** 探测到的服务版本；服务未提供时为 undefined。 */
  version?: string
  /** 探测成功的 API 地址（含 `/v1` 等前缀），供一键接入纠正 baseUrl。 */
  baseUrl?: string
}
