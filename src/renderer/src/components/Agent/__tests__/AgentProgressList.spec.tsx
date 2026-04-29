import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AgentProgressList from '../AgentProgressList'

describe('agentProgressList', () => {
  it('渲染进度项', () => {
    render(<AgentProgressList progress={[{ id: '1', title: '读取目录', status: 'running' }]} />)
    expect(screen.getByText('读取目录')).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
  })
})
