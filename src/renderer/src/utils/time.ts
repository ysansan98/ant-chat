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
