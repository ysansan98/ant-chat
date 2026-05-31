import { ProviderLogo } from '../Chat/providerLogo'

interface ProviderLogoDisplayProps {
  providerId: string
}

export function ProviderLogoDisplay({ providerId }: ProviderLogoDisplayProps) {
  return (
    <span className="flex items-center justify-center rounded-md bg-white">
      <ProviderLogo id={providerId} size={16} className="size-4" />
    </span>
  )
}
