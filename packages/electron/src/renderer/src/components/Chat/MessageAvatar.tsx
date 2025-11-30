import type { IMessage, IMessageAI } from '@ant-chat/shared'
import { RobotFilled, SmileFilled, UserOutlined } from '@ant-design/icons'
import { Role } from '@/constants'
import { getProviderLogo } from './providerLogo'

interface MessageAvatarProps {
  message: IMessage
}

export function MessageAvatar({ message }: MessageAvatarProps) {
  const { role } = message

  const defaultAvatar = (
    <div className={`
      flex h-8 w-8 items-center justify-center rounded-full bg-[#69b1ff] text-lg text-white
    `}
    >
      <RobotFilled />
    </div>
  )

  if (role === Role.USER) {
    return (
      <div className={`
        flex h-8 w-8 items-center justify-center rounded-full bg-[#87d068] text-lg text-white
      `}
      >
        <UserOutlined />
      </div>
    )
  }

  if (role === Role.SYSTEM) {
    return (
      <div className={`
        flex h-8 w-8 items-center justify-center rounded-full bg-[#DE732D] text-lg text-white
      `}
      >
        <SmileFilled />
      </div>
    )
  }

  if (role === Role.AI) {
    const { modelInfo } = message as IMessageAI
    if (!modelInfo) {
      return defaultAvatar
    }

    const provider = modelInfo?.provider.toLowerCase()
    const ProviderLogo = getProviderLogo(provider || '')

    if (ProviderLogo) {
      return (
        <div className={`
          flex h-8 w-8 items-center justify-center rounded-full border border-solid
          border-(--border-color) bg-white text-lg
        `}
        >
          <ProviderLogo />
        </div>
      )
    }

    return defaultAvatar
  }

  return defaultAvatar
}
