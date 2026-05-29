import type { UpdateAgentProfileInput } from '@ant-chat/shared'
import { getAppTransport } from './transports/appTransport'

export const profileApi = {
  async getProfile() {
    return (await getAppTransport()).profile.getProfile()
  },

  async updateProfile(input: UpdateAgentProfileInput) {
    return (await getAppTransport()).profile.updateProfile(input)
  },

  async rollbackSoul() {
    return (await getAppTransport()).profile.rollbackSoul()
  },
}
