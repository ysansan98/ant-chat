import { ProviderLogo } from '../Chat/providerLogo'

interface ProviderLogoDisplayProps {
  providerServiceId: string
}

export function ProviderLogoDisplay({ providerServiceId }: ProviderLogoDisplayProps) {
  return (
    <span className="flex items-center justify-center rounded-md bg-white">
      <ProviderLogo id={providerServiceId} size={16} className="size-4" />
    </span>
  )
}
