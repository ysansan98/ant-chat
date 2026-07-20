import dayjs from 'dayjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDuration, formatRelativeTime, formatTime } from '../time'

describe('time', () => {
  describe('formatTime', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('formatTime for today', () => {
      const now = new Date(1716489600000)
      vi.setSystemTime(now)
      expect(formatTime(now.getTime())).toBe('02:40')
    })

    it('formatTime for yesterday', () => {
      const now = dayjs(1716403200000)
      vi.setSystemTime(now.unix() * 1000)
      const time = now.subtract(1, 'day').unix() * 1000

      expect(formatTime(time)).toBe('昨天 02:40')
    })

    it('formatTime 今年', () => {
      const now = dayjs(1716403200000)
      vi.setSystemTime(now.unix() * 1000)
      const time = now.subtract(1, 'month').unix() * 1000

      expect(formatTime(time)).toBe('4月23日 02:40')
    })

    it('formatTime 其他时间', () => {
      const now = dayjs(1716403200000)
      vi.setSystemTime(now.unix() * 1000)
      const time = now.subtract(1, 'year').unix() * 1000

      expect(formatTime(time)).toBe('2023年5月23日 02:40')
    })
  })

  describe('formatRelativeTime', () => {
    const now = new Date('2026-07-01T12:00:00+08:00').getTime()

    it.each([
      [30 * 60_000, '30分钟'],
      [3 * 3_600_000, '3小时'],
      [2 * 24 * 3_600_000, '2天'],
      [15 * 24 * 3_600_000, '2周'],
      [65 * 24 * 3_600_000, '2个月'],
      [800 * 24 * 3_600_000, '2年'],
    ])('将 %i 毫秒前格式化为 %s', (elapsed, expected) => {
      expect(formatRelativeTime(now - elapsed, now)).toBe(expected)
    })
  })

  describe('formatDuration', () => {
    it.each([
      [0, '<1ms'],
      [250, '250ms'],
      [1_500, '1.5s'],
      [65_000, '1m 05s'],
    ])('将 %i 毫秒耗时格式化为 %s', (duration, expected) => {
      expect(formatDuration(duration)).toBe(expected)
    })
  })
})
