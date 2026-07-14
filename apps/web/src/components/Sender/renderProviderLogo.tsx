import { ProviderLogo } from '../Chat/providerLogo'

interface ProviderLogoDisplayProps {
  providerId: string
}

export function ProviderLogoDisplay({ providerId }: ProviderLogoDisplayProps) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-white">
      <ProviderLogo id={providerId} />
    </span>
  )
}
