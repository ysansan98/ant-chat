import type { ChannelCardAction, ChannelOutboundContent } from '../channelConnector'

type FeishuCardContent = Exclude<ChannelOutboundContent, { kind: 'text' }>

const statusMeta = {
  running: { title: '正在执行', template: 'blue' },
  awaiting_approval: { title: '等待审批', template: 'orange' },
  success: { title: '执行完成', template: 'green' },
  failed: { title: '执行失败', template: 'red' },
  cancelled: { title: '执行已停止', template: 'grey' },
} as const

export function buildFeishuCard(content: FeishuCardContent): Record<string, unknown> {
  switch (content.kind) {
    case 'execution':
      return buildExecutionCard(content)
    case 'model-selection': {
      const selected = content.models.find(model => model.selected)
      return createCard(content.title, 'blue', '选择后会应用到当前频道会话。', [
        markdown('选择后会应用到当前频道会话。'),
        {
          tag: 'form',
          name: 'model-selection',
          elements: [
            {
              tag: 'select_static',
              name: 'model',
              placeholder: { tag: 'plain_text', content: '请选择模型' },
              ...(selected
                ? { initial_option: selected.value }
                : {}),
              options: content.models.map(model => ({
                text: { tag: 'plain_text', content: model.label },
                value: model.value,
              })),
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '切换模型' },
              type: 'primary',
              width: 'fill',
              name: 'submit',
              form_action_type: 'submit',
              behaviors: [{ type: 'callback', value: { token: content.token } }],
            },
          ],
        },
      ])
    }
    case 'permission-mode-selection': {
      const selected = content.modes.find(mode => mode.selected)
      return createCard(content.title, 'blue', '选择后会应用到当前频道的后续任务。', [
        markdown('权限模式决定频道任务遇到工具操作时，是自动执行还是请求批准。'),
        {
          tag: 'form',
          name: 'permission-mode-selection',
          elements: [
            {
              tag: 'select_static',
              name: 'permissionMode',
              placeholder: { tag: 'plain_text', content: '请选择权限模式' },
              ...(selected ? { initial_option: selected.value } : {}),
              options: content.modes.map(mode => ({
                text: { tag: 'plain_text', content: mode.label },
                value: mode.value,
              })),
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '切换权限模式' },
              type: 'primary',
              width: 'fill',
              name: 'submit',
              form_action_type: 'submit',
              behaviors: [{ type: 'callback', value: { token: content.token } }],
            },
          ],
        },
      ])
    }
    case 'notice':
      return createCard(content.title, noticeTemplate(content.tone), content.text, [markdown(content.text)])
  }
}

function buildExecutionCard(content: Extract<FeishuCardContent, { kind: 'execution' }>): Record<string, unknown> {
  const meta = statusMeta[content.status]
  const elements: Array<Record<string, unknown>> = [
    markdown(content.text.trim() || phaseLabel(content.phase)),
  ]
  if (content.steps.length > 0) {
    elements.push(markdown([
      '**执行过程**',
      ...content.steps.map(step => `${stepIcon(step.status)} ${step.label}`),
    ].join('\n')))
  }
  if (content.visualization) {
    elements.push(markdown(`**${content.visualization.title}**\n${content.visualization.summary}\n\n可在 Ant Chat 桌面端查看完整交互内容。`))
  }
  if (content.pendingAction) {
    elements.push(markdown([
      `**需要审批：${content.pendingAction.toolName}**`,
      content.pendingAction.inputPreview,
      '飞书卡片仅支持本次批准；记住授权请在 Ant Chat 桌面端操作。',
    ].join('\n\n')))
  }
  elements.push(markdown(`---\n模型：${content.model.provider} / ${content.model.model}`))
  elements.push(...(content.actions ?? []).map(actionButton))
  return createCard(meta.title, meta.template, executionSummary(content), elements)
}

function createCard(title: string, template: string, summary: string, elements: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      summary: { content: summary },
    },
    header: {
      title: { tag: 'plain_text', content: title },
      template,
    },
    body: {
      direction: 'vertical',
      padding: '16px 16px 16px 16px',
      elements,
    },
  }
}

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content }
}

function actionButton(action: ChannelCardAction): Record<string, unknown> {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: action.label },
    type: action.style ?? 'default',
    width: 'fill',
    behaviors: [{
      type: 'callback',
      value: { token: action.token },
    }],
  }
}

function noticeTemplate(tone?: 'info' | 'success' | 'warning' | 'error'): string {
  switch (tone) {
    case 'success': return 'green'
    case 'warning': return 'orange'
    case 'error': return 'red'
    default: return 'blue'
  }
}

function executionSummary(content: Extract<FeishuCardContent, { kind: 'execution' }>): string {
  const meta = statusMeta[content.status]
  const detail = content.text.trim() || phaseLabel(content.phase)
  return `${meta.title}：${detail}`.slice(0, 100)
}

function phaseLabel(phase?: Extract<FeishuCardContent, { kind: 'execution' }>['phase']): string {
  return {
    waiting_model: '正在等待模型响应…',
    thinking: '正在思考…',
    generating_response: '正在生成回复…',
    preparing_tool: '正在准备工具…',
    using_tool: '正在使用工具…',
  }[phase ?? 'waiting_model']
}

function stepIcon(status: 'running' | 'success' | 'failed'): string {
  return { running: '◌', success: '✓', failed: '✕' }[status]
}
