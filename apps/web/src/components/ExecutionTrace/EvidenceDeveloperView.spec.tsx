import type { ToolCallEvidenceView } from './evidenceModel'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EvidenceDetailView } from './EvidenceDeveloperView'

describe('执行轨迹命令详情', () => {
  it('展示命令实际使用的解释器', () => {
    const view: ToolCallEvidenceView = {
      type: 'tool-call',
      pending: false,
      toolName: 'execute_command',
      operationType: 'command',
      interpreter: 'powershell7',
      scope: 'workspace',
    }

    render(<EvidenceDetailView view={view} />)

    expect(screen.getAllByText('powershell7').length).toBeGreaterThan(0)
    expect(screen.getByText('解释器')).toBeInTheDocument()
  })
})
