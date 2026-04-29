import type { IAttachment } from '@ant-chat/shared'

export function shouldStartAgentTask(prompt: string, attachments: IAttachment[]): boolean {
  if (attachments.length > 0) {
    return true
  }

  return /检查|分析|修改|重构|项目|代码|文件|目录|运行|命令|patch|grep|read|write/i.test(prompt)
}
