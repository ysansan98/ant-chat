import type { ChannelAttachment } from '../channelConnector'
import type { TransportLogger, weixinPost } from './ilinkHttp'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import process from 'node:process'
import { aes128EcbEncrypt, aesPaddedSize, DEFAULT_CDN_BASE_URL, weixinUploadCiphertext } from './ilinkHttp'

export interface UploadedMedia {
  /** 可直接放进 sendmessage item_list 的媒体条目。 */
  mediaItem: Record<string, unknown>
  /** PKCS7 补位后的密文，作为 mid_size/len 的依据。 */
  ciphertext: Buffer
  plaintextLength: number
}

/**
 * 微信附件加密上传：getuploadurl → AES-128-ECB 加密 → CDN 上传 → 组装媒体条目。
 * 失败直接抛错；iLink 期望 aes_key 为 base64(hex(key))，接收端才可解密。
 */
export async function uploadMediaToIlink(input: {
  post: typeof weixinPost
  baseUrl: string
  botToken: string
  chatId: string
  attachment: ChannelAttachment
  logger?: TransportLogger
}): Promise<UploadedMedia> {
  const plaintext = Buffer.from(input.attachment.data, 'base64')
  const filekey = randomBytes(16).toString('hex')
  const aesKey = randomBytes(16)
  const rawfilemd5 = createHash('md5').update(plaintext).digest('hex')
  // media_type：1=图片，2=视频，3=文件，4=语音。视频/语音原生气泡未验证，
  // document/file 一律按文件（3）发送，与 Hermes 参考实现一致。
  const mediaType = input.attachment.kind === 'image' ? 1 : 3
  const uploadResponse = await input.post<{
    upload_full_url?: string
    upload_param?: string
    ret?: number
    errcode?: number
    errmsg?: string
  }>({
    baseUrl: input.baseUrl,
    path: 'ilink/bot/getuploadurl',
    token: input.botToken,
    logger: input.logger,
    body: {
      filekey,
      media_type: mediaType,
      to_user_id: input.chatId,
      rawsize: plaintext.byteLength,
      rawfilemd5,
      filesize: aesPaddedSize(plaintext.byteLength),
      no_need_thumb: true,
      aeskey: aesKey.toString('hex'),
    },
  })
  const uploadUrl = uploadResponse.upload_full_url
    ?? (uploadResponse.upload_param
      ? `${process.env.WEIXIN_CDN_BASE_URL ?? DEFAULT_CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadResponse.upload_param)}&filekey=${encodeURIComponent(filekey)}`
      : undefined)
  if (!uploadUrl)
    throw new Error('微信 getuploadurl 未返回 upload_full_url 或 upload_param')
  const ciphertext = aes128EcbEncrypt(plaintext, aesKey)
  const encryptQueryParam = await weixinUploadCiphertext({
    uploadUrl,
    ciphertext,
    logger: input.logger,
  })
  // iLink 期望 aes_key 为 base64(hex(key)) 而不是 base64(原始字节)，
  // 否则接收端无法解密，图片显示灰块。
  const aesKeyForApi = Buffer.from(aesKey.toString('hex')).toString('base64')
  const mediaItem = input.attachment.kind === 'image'
    ? {
        type: 2,
        image_item: {
          media: { encrypt_query_param: encryptQueryParam, aes_key: aesKeyForApi, encrypt_type: 1 },
          mid_size: ciphertext.byteLength,
        },
      }
    : {
        type: 4,
        file_item: {
          media: { encrypt_query_param: encryptQueryParam, aes_key: aesKeyForApi, encrypt_type: 1 },
          file_name: input.attachment.name,
          len: String(plaintext.byteLength),
        },
      }
  return { mediaItem, ciphertext, plaintextLength: plaintext.byteLength }
}
