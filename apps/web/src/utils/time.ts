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

/**
 * 将毫秒耗时格式化为可读字符串。
 * - 小于 1 秒: "0.8s"
 * - 小于 60 秒: "12.3s"
 * - 60 秒及以上: "1m 05s"
 */
export function formatDuration(ms: number): string {
  const seconds = ms / 1000

  if (seconds < 1) {
    return `${seconds.toFixed(1)}s`
  }

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`
}
