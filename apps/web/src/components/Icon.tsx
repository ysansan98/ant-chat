import { useToken } from '@/utils'

interface IconProps {
  name: string
  classNames?: string
  style?: React.CSSProperties
  onClick?: () => void
}

export default function Icon({ name, classNames, style, onClick }: IconProps) {
  const { token } = useToken()

  const _style = {
    cursor: onClick ? 'pointer' : '',
    backgroundColor: token.colorText,
    ...style,
  }

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`
        h-[1em] w-[1em] bg-(--ant-color-text)
        ${name}
        ${classNames}
      `}
      style={_style}
      onClick={onClick}
      onKeyDown={onClick
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onClick()
            }
          }
        : undefined}
    />
  )
}
