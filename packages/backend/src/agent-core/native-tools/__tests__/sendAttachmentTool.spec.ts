import type { AttachmentOutputBlock, ChannelAttachmentSender } from '@ant-chat/shared'
import { WORKSPACE_INVALID_PATH } from '@ant-chat/shared'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPathPolicy } from '../pathPolicy'
import { sendAttachment } from '../tools/sendAttachmentTool'

describe('send_attachment 工具', () => {
  let workspacePath: string

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-attachment-'))
  })

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true })
  })

  function writeFile(name: string, content: Buffer | string): string {
    const filePath = path.join(workspacePath, name)
    fs.writeFileSync(filePath, content)
    return name
  }

  function extractBlock(result: Awaited<ReturnType<typeof sendAttachment>>): AttachmentOutputBlock {
    const blocks = (result.diagnostics?.data as { outputBlocks?: AttachmentOutputBlock[] }).outputBlocks ?? []
    expect(blocks).toHaveLength(1)
    return blocks[0]!
  }

  it('文本文件按 document 块产出，携带文件名、MIME、大小与 base64 字节', async () => {
    const name = writeFile('报告.txt', '报告内容')
    const result = await sendAttachment({ path: name }, createPathPolicy(workspacePath))

    expect(result.ok).toBe(true)
    const block = extractBlock(result)
    expect(block.type).toBe('document')
    expect(block).toMatchObject({
      source: { type: 'file_id', file_id: expect.stringMatching(/^att-/) },
      name: '报告.txt',
      media_type: 'text/plain',
      size: Buffer.byteLength('报告内容', 'utf8'),
    })
    expect(block.data).toBe(Buffer.from('报告内容', 'utf8').toString('base64'))
  })

  it('图片按 image 产出，未知二进制按 file 产出', async () => {
    const image = writeFile('photo.png', Buffer.from([0x89, 0x50, 0x4E, 0x47]))
    const binary = writeFile('archive.bin', Buffer.from([1, 2, 3]))

    const imageResult = await sendAttachment({ path: image }, createPathPolicy(workspacePath))
    expect(extractBlock(imageResult)).toMatchObject({ type: 'image', mimeType: 'image/png' })

    const binaryResult = await sendAttachment({ path: binary }, createPathPolicy(workspacePath))
    expect(extractBlock(binaryResult)).toMatchObject({
      type: 'file',
      filename: 'archive.bin',
      media_type: 'application/octet-stream',
    })
  })

  it('超过图片 10MB / 文件 30MB 上限时返回失败而不是产物块', async () => {
    const bigImage = writeFile('big.jpg', Buffer.alloc(10 * 1024 * 1024 + 1))
    const bigFile = writeFile('big.bin', Buffer.alloc(30 * 1024 * 1024 + 1))
    const policy = createPathPolicy(workspacePath)

    await expect(sendAttachment({ path: bigImage }, policy)).resolves.toMatchObject({
      ok: false,
      result: expect.stringContaining('不能超过 10MB'),
    })
    await expect(sendAttachment({ path: bigFile }, policy)).resolves.toMatchObject({
      ok: false,
      result: expect.stringContaining('不能超过 30MB'),
    })
  })

  it('工作区外路径被拒绝，不读取文件', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-outside-'))
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')

    await expect(sendAttachment({ path: path.join(outside, 'secret.txt') }, createPathPolicy(workspacePath)))
      .rejects
      .toThrow(WORKSPACE_INVALID_PATH)
    fs.rmSync(outside, { recursive: true, force: true })
  })

  it('频道 turn 直接发送并返回真实消息 ID，不产出附件块', async () => {
    const name = writeFile('报告.txt', '报告内容')
    const sender: ChannelAttachmentSender = {
      send: vi.fn(async () => ({ messageId: 'outbound-1' })),
    }

    const result = await sendAttachment({ path: name }, createPathPolicy(workspacePath), {
      turnSource: {
        type: 'channel',
        channelType: 'weixin',
        channelAccountId: 'account-1',
        externalUserId: 'user-1',
        externalChatId: 'chat-1',
        externalMessageId: 'inbound-1',
      },
      channelAttachmentSender: sender,
    })

    expect(result.ok).toBe(true)
    expect(JSON.parse(result.result)).toEqual(expect.objectContaining({
      success: true,
      status: 'sent',
      messageId: 'outbound-1',
      attachment: { name: '报告.txt', mediaType: 'text/plain', kind: 'document', size: Buffer.byteLength('报告内容', 'utf8') },
    }))
    expect(result.diagnostics).toBeUndefined()
    expect(sender.send).toHaveBeenCalledWith({
      channelAccountId: 'account-1',
      externalChatId: 'chat-1',
      attachment: expect.objectContaining({
        name: '报告.txt',
        mediaType: 'text/plain',
        kind: 'document',
        data: Buffer.from('报告内容', 'utf8').toString('base64'),
      }),
    })
  })

  it('频道发送失败时把错误呈现给模型，不产出附件块', async () => {
    const name = writeFile('报告.txt', '内容')
    const sender: ChannelAttachmentSender = {
      send: vi.fn(async () => {
        throw new Error('微信会话已过期')
      }),
    }

    const result = await sendAttachment({ path: name }, createPathPolicy(workspacePath), {
      turnSource: {
        type: 'channel',
        channelType: 'feishu',
        channelAccountId: 'account-1',
        externalUserId: 'user-1',
        externalChatId: 'chat-1',
        externalMessageId: 'inbound-1',
      },
      channelAttachmentSender: sender,
    })

    expect(result.ok).toBe(false)
    expect(result.result).toContain('发送失败')
    expect(result.result).toContain('微信会话已过期')
    expect(result.diagnostics).toBeUndefined()
  })
})
