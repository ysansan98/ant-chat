import { describe, expect, it } from 'vitest'
import { getNextRunAt, validateSchedule } from '../schedule'

describe('自动化计划', () => {
  it('按指定时区计算 cron 的下一次执行时间', () => {
    const after = Date.parse('2026-07-02T00:00:00.000Z')
    const next = getNextRunAt({ type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' }, after)

    expect(new Date(next!).toISOString()).toBe('2026-07-02T01:00:00.000Z')
  })

  it('拒绝过去的一次性任务和非五段 cron', () => {
    expect(() => validateSchedule({ type: 'once', runAt: 100 }, 100)).toThrow('必须晚于当前时间')
    expect(() => validateSchedule({ type: 'cron', expression: '0 0 9 * * *', timezone: 'Asia/Shanghai' }, 100)).toThrow('五段格式')
  })
})
