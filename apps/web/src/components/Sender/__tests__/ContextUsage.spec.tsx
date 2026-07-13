import { render, screen } from '@testing-library/react'
import { ContextUsage, ContextUsageTrigger } from '@workspace/ui/components/context-usage'
import { describe, expect, it } from 'vitest'

describe('contextUsage', () => {
  it('使用上下文窗口计算并展示占用比例', () => {
    render(
      <ContextUsage contextLength={100_000} usedTokens={25_000}>
        <ContextUsageTrigger />
      </ContextUsage>,
    )

    expect(screen.getByRole('button')).toHaveTextContent('25%')
  })
})
