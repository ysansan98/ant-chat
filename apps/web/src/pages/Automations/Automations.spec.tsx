import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomationsPage } from './Automations'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  setEnabled: vi.fn(),
  runNow: vi.fn(),
  listRuns: vi.fn(),
  delete: vi.fn(),
  openWorkspace: vi.fn(),
}))

vi.mock('@/api/automationApi', () => ({ automationApi: { ...mocks, create: vi.fn(), update: vi.fn() } }))
vi.mock('@/api/workspaceApi', () => ({ default: {
  listWorkspaces: vi.fn(async () => ({ workspaces: [{ path: '/workspace/project', displayName: 'project', isDefault: true }] })),
  openWorkspace: mocks.openWorkspace,
} }))
vi.mock('@/api/providerApi', () => ({ providerApi: { getAllAbvailableModels: vi.fn(async () => []) } }))
vi.mock('@/api/skillApi', () => ({ skillApi: { listSkills: vi.fn(async () => ({ rootPath: '', skills: [] })) } }))
vi.mock('@/api/mcpApi', () => ({ getMcpServers: vi.fn(async () => []) }))
vi.mock('@/api/chatApi', () => ({ default: {
  getWorkspaceConversations: vi.fn(async () => ({ data: [], total: 0 })),
  getMessagesByConvId: vi.fn(async () => []),
} }))
vi.mock('@/api/agentApi', () => ({ default: { listActiveTasks: vi.fn(async () => []) } }))

const automation = {
  id: 'automation-1',
  name: '每日检查',
  prompt: '检查代码风险',
  workspacePath: '/workspace/project',
  providerId: 'provider-1',
  modelId: 'model-1',
  allowedSkills: [],
  allowedMcpServers: [],
  permissionPolicy: {
    workspaceAccess: 'read' as const,
    allowSelectedSkillRuntime: false,
    allowBrowser: false,
    allowMcpTools: false,
    extraFileRoots: [],
    allowCommandExecution: false,
    commandPatterns: [],
  },
  schedule: { type: 'cron' as const, expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
  enabled: true,
  nextRunAt: Date.now() + 60_000,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

describe('automationsPage', () => {
  beforeEach(() => {
    mocks.list.mockResolvedValue([automation])
    mocks.setEnabled.mockResolvedValue({ ...automation, enabled: false, nextRunAt: undefined })
    mocks.runNow.mockResolvedValue({ id: 'run-1', automationId: automation.id, scheduledAt: Date.now(), status: 'queued', createdAt: Date.now() })
    mocks.listRuns.mockResolvedValue([])
    mocks.delete.mockResolvedValue(null)
    mocks.openWorkspace.mockResolvedValue({ workspaces: [] })
  })

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/chat/automations']}>
        <Routes>
          <Route path="/chat/automations" element={<AutomationsPage />} />
          <Route path="/chat" element={<ChatRoute />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('从运行时加载任务并持久化启停操作', async () => {
    renderPage()
    expect(await screen.findAllByText('每日检查')).toHaveLength(2)

    fireEvent.click(screen.getByRole('switch', { name: '停用每日检查' }))

    expect(mocks.setEnabled).toHaveBeenCalledWith('automation-1', false)
    expect(await screen.findByRole('switch', { name: '启用每日检查' })).not.toBeChecked()
  })

  it('打开运行记录时从后端读取而不是使用模拟数据', async () => {
    renderPage()
    expect(await screen.findAllByText('每日检查')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '运行记录' }))

    expect(mocks.listRuns).toHaveBeenCalledWith('automation-1')
    expect(await screen.findByText('还没有运行记录')).toBeInTheDocument()
  })

  it('从运行记录进入该次执行创建的会话', async () => {
    mocks.listRuns.mockResolvedValue([{
      id: 'run-1',
      automationId: automation.id,
      scheduledAt: Date.now(),
      startedAt: Date.now(),
      finishedAt: Date.now() + 1_000,
      status: 'succeeded',
      conversationId: 'conv-history-1',
      turnId: 'turn-history-1',
      summary: '检查完成',
      createdAt: Date.now(),
    }])
    renderPage()
    await screen.findAllByText('每日检查')

    fireEvent.click(screen.getByRole('button', { name: '运行记录' }))
    fireEvent.click(await screen.findByRole('button', { name: '查看会话' }))

    expect(await screen.findByText('会话页面')).toBeInTheDocument()
    expect(mocks.openWorkspace).toHaveBeenCalledWith('/workspace/project')
  })

  it('从运行记录直接检查该次执行的 Trace', async () => {
    mocks.listRuns.mockResolvedValue([{
      id: 'run-1',
      automationId: automation.id,
      scheduledAt: Date.now(),
      startedAt: Date.now(),
      finishedAt: Date.now() + 1_000,
      status: 'succeeded',
      conversationId: 'conv-history-1',
      turnId: 'turn-history-1',
      summary: '检查完成',
      createdAt: Date.now(),
    }])
    renderPage()
    await screen.findAllByText('每日检查')

    fireEvent.click(screen.getByRole('button', { name: '运行记录' }))
    fireEvent.click(await screen.findByRole('button', { name: '检查 Trace' }))

    expect(await screen.findByText('会话页面')).toBeInTheDocument()
    expect(mocks.openWorkspace).toHaveBeenCalledWith('/workspace/project')
    expect(screen.getByTestId('chat-search')).toHaveTextContent('?traceTurnId=turn-history-1')
  })

  it('创建任务时权限区域跟随上方选择的工作区', async () => {
    renderPage()
    await screen.findAllByText('每日检查')

    fireEvent.click(screen.getByRole('button', { name: '新建自动化' }))

    expect(await screen.findByText('/workspace/project')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /允许浏览器操作/ })).not.toBeChecked()
  })

  it('创建任务时使用平台中立的命令权限配置', async () => {
    renderPage()
    await screen.findAllByText('每日检查')

    fireEvent.click(screen.getByRole('button', { name: '新建自动化' }))

    const commandSwitch = await screen.findByRole('switch', { name: /允许终端命令/ })
    expect(commandSwitch).not.toBeChecked()
    expect(screen.queryByLabelText('允许的命令模式')).not.toBeInTheDocument()

    fireEvent.click(commandSwitch)

    expect(screen.getByLabelText('允许的命令模式')).toBeInTheDocument()
    expect(screen.queryByText(/bash 等终端命令/i)).not.toBeInTheDocument()
  })

  it('创建任务时计划标签明确标识当前选项', async () => {
    renderPage()
    await screen.findAllByText('每日检查')
    fireEvent.click(screen.getByRole('button', { name: '新建自动化' }))

    const periodicTab = await screen.findByRole('tab', { name: '周期执行' })
    expect(periodicTab).toHaveAttribute('aria-selected', 'true')

    const onceTab = screen.getByRole('tab', { name: '仅一次' })
    fireEvent.mouseDown(onceTab, { button: 0, ctrlKey: false })
    fireEvent.click(onceTab)
    await waitFor(() => expect(screen.getByRole('tab', { name: '仅一次' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByLabelText('一次性执行时间')).toBeInTheDocument()
  })

  it('立即运行创建会话后进入对应会话页面', async () => {
    mocks.runNow.mockResolvedValue({
      id: 'run-1',
      automationId: automation.id,
      scheduledAt: Date.now(),
      status: 'running',
      conversationId: 'conv-1',
      createdAt: Date.now(),
    })
    renderPage()
    await screen.findAllByText('每日检查')

    fireEvent.click(screen.getByRole('button', { name: '立即运行' }))

    expect(await screen.findByText('会话页面')).toBeInTheDocument()
    expect(mocks.openWorkspace).toHaveBeenCalledWith('/workspace/project')
  })

  it('省略号菜单提供任务操作并可确认删除', async () => {
    renderPage()
    await screen.findAllByText('每日检查')

    fireEvent.click(screen.getByRole('button', { name: '更多每日检查操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除任务' }))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))

    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith('automation-1'))
    expect(screen.queryByText('检查代码风险')).not.toBeInTheDocument()
  })

  it('列表使用自然语言展示计划而不暴露 cron 表达式', async () => {
    renderPage()

    expect(await screen.findByText('每天 · 09:00')).toBeInTheDocument()
    expect(screen.queryByText('0 9 * * *')).not.toBeInTheDocument()
  })
})

function ChatRoute() {
  const location = useLocation()
  return (
    <div>
      会话页面
      <span data-testid="chat-search">{location.search}</span>
    </div>
  )
}
