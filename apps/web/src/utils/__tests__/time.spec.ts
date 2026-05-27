import dayjs from 'dayjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatTime } from '../time'

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
})
