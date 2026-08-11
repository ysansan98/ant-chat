import type { AgentToolResult, AgentTurnSource, AttachmentOutputBlock, ChannelAttachmentSender, ToolOutputBlocks } from '@ant-chat/shared'
import type { Buffer } from 'node:buffer'
import type { PathPolicy } from '../pathPolicy'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { classifyFile } from '@ant-chat/shared'
import { createNativeTool } from './toolFactory'

/** 与飞书上限对齐：图片 10MB、文件 30MB；超出在工具层尽早报错。 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_FILE_BYTES = 30 * 1024 * 1024

export interface SendAttachmentToolInput {
  path: string
}

export interface SendAttachmentToolOptions {
  turnSource?: AgentTurnSource
  channelAttachmentSender?: ChannelAttachmentSender
}

export async function sendAttachment(input: SendAttachmentToolInput, pathPolicy: PathPolicy, options: SendAttachmentToolOptions = {}): Promise<AgentToolResult> {
  const filePath = pathPolicy.resolveExisting(input.path)
  const bytes = await fs.promises.readFile(filePath)
  const name = path.basename(filePath)
  const mediaType = guessMimeType(name)
  const kind = classifyFile(name, mediaType)
  const attachment = {
    name,
    mediaType,
    kind,
    size: bytes.byteLength,
    data: bytes.toString('base64'),
  }
  if (kind === 'image' && bytes.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, result: `send_attachment 失败：图片不能超过 10MB（当前 ${formatBytes(bytes.byteLength)}）。` }
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return { ok: false, result: `send_attachment 失败：文件不能超过 30MB（当前 ${formatBytes(bytes.byteLength)}）。` }
  }

  // 频道 turn：直接发送到当前会话并返回真实 messageId，失败呈现给模型。
  if (options.channelAttachmentSender && options.turnSource?.type === 'channel') {
    try {
      const result = await options.channelAttachmentSender.send({
        channelAccountId: options.turnSource.channelAccountId,
        externalChatId: options.turnSource.externalChatId,
        attachment,
      })
      return {
        ok: true,
        result: JSON.stringify({
          success: true,
          status: 'sent',
          messageId: result.messageId,
          message: '文件已发送到当前会话。',
          attachment: { name, mediaType, kind, size: bytes.byteLength },
        }),
      }
    }
    catch (error) {
      return {
        ok: false,
        result: `send_attachment 发送失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  // 桌面/自动化 turn：作为附件块附加到回复，由投递层在消息落盘后投影。
  const block = createAttachmentBlock(name, mediaType, kind, bytes)
  return {
    ok: true,
    result: JSON.stringify({
      success: true,
      status: 'attached',
      message: '文件已附加到当前回复。',
      attachment: { name, mediaType, kind, size: bytes.byteLength },
    }),
    diagnostics: { data: { outputBlocks: [block] } satisfies ToolOutputBlocks },
  }
}

export function createSendAttachmentTool(pathPolicy: PathPolicy, unrestricted: boolean, options: SendAttachmentToolOptions = {}) {
  return createNativeTool({
    name: 'send_attachment',
    description: '把指定文件发送给用户：当前会话是消息频道（微信、飞书）时立即作为附件发送并返回真实消息 ID；桌面端会话则附加到回复内容。只接受工作区内或受信任路径下的文件；图片按 image、文档/文本按 document、其余按 file 发送。不要用于读取文件内容，读取请用 read_file。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要发送的文件路径（相对工作区或绝对路径）。' },
      },
      required: ['path'],
    },
    unrestricted,
    inferScope: input => pathPolicy.classifyAccess(String((input as unknown as SendAttachmentToolInput).path || '.')),
    execute: input => sendAttachment(input as unknown as SendAttachmentToolInput, pathPolicy, options),
  })
}

function createAttachmentBlock(name: string, mediaType: string, kind: 'image' | 'document' | 'file', bytes: Buffer): AttachmentOutputBlock {
  const fileId = `att-${randomUUID()}`
  const base = {
    source: { type: 'file_id' as const, file_id: fileId },
    name,
    size: bytes.byteLength,
    data: bytes.toString('base64'),
  }
  if (kind === 'image') {
    return { type: 'image', ...base, mimeType: mediaType }
  }
  if (kind === 'document') {
    return { type: 'document', ...base, media_type: mediaType }
  }
  return { type: 'file', filename: name, ...base, media_type: mediaType }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.mp4': 'video/mp4',
  '.opus': 'audio/opus',
  '.silk': 'audio/silk',
}

/** 轻量扩展名 → MIME 映射；未知类型落 application/octet-stream。 */
function guessMimeType(fileName: string): string {
  const ext = fileName.includes('.') ? `.${fileName.split('.').pop()!.toLowerCase()}` : ''
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream'
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.ceil(bytes / 1024)}KB`
}
