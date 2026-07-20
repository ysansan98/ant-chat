import dayjs from 'dayjs'

export function getNow() {
  return Date.now()
}

export function formatTime(time: number) {
  const date = dayjs(time)
  const now = dayjs()

  // 如果是今天
  if (date.isSame(now, 'day')) {
    return date.format('HH:mm')
  }

  // 如果是昨天
  if (date.isSame(now.subtract(1, 'day'), 'day')) {
    return `昨天 ${date.format('HH:mm')}`
  }

  // 如果是今年的其他时间
  if (date.isSame(now, 'year')) {
    return date.format('M月D日 HH:mm')
  }

  // 其他情况
  return date.format('YYYY年M月D日 HH:mm')
}

export function formatRelativeTime(time: number, now = Date.now()) {
  const elapsedMs = Math.max(0, now - time)
  const elapsedMinutes = Math.floor(elapsedMs / 60_000)

  if (elapsedMinutes < 1)
    return '刚刚'
  if (elapsedMinutes < 60)
    return `${elapsedMinutes}分钟`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24)
    return `${elapsedHours}小时`

  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 7)
    return `${elapsedDays}天`
  if (elapsedDays < 30)
    return `${Math.floor(elapsedDays / 7)}周`
  if (elapsedDays < 365)
    return `${Math.floor(elapsedDays / 30)}个月`
  return `${Math.floor(elapsedDays / 365)}年`
}

/**
 * 将毫秒耗时格式化为可读字符串。
 * - 小于 1 秒: "800ms"
 * - 小于 60 秒: "12.3s"
 * - 60 秒及以上: "1m 05s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1)
    return '<1ms'

  const seconds = ms / 1000

  if (ms < 1000) {
    return `${Math.floor(ms)}ms`
  }

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`
}
