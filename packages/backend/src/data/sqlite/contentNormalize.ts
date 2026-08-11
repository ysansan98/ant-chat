/**
 * 旧格式 image-block → 统一 image（type + media_type 字段归一）。
 *
 * image 类型统一之前持久化的消息可能残留 image-block 块；schema 已收窄后
 * image-block 不再是合法成员，所有持久化读取路径都必须先归一再解析，
 * 避免旧消息图片附件静默丢失或 MessageContentSchema 严格解析抛 ZodError。
 */
export function normalizeLegacyContentBlock(block: unknown): unknown {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    return block
  }
  const candidate = block as Record<string, unknown>
  if (candidate.type !== 'image-block') {
    return block
  }
  const { media_type, ...rest } = candidate
  return {
    ...rest,
    type: 'image',
    ...(media_type !== undefined ? { mimeType: media_type } : {}),
  }
}

/** 归一整个消息 content 数组（非数组原样返回）。 */
export function normalizeLegacyMessageContent(content: unknown): unknown {
  return Array.isArray(content) ? content.map(normalizeLegacyContentBlock) : content
}
