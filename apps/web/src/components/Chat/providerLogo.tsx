function getProviderLogoUrl(providerId: string) {
  if (!providerId) {
    return null
  }
  const normalized = providerId.toLowerCase().trim()
  if (!normalized) {
    return null
  }
  return `https://models.dev/logos/${encodeURIComponent(normalized)}.svg`
}

interface ProviderLogoProps {
  id: string
  name?: string
  size?: number
  className?: string
}

export function ProviderLogo({ id, name, size = 16, className }: ProviderLogoProps) {
  const logoUrl = getProviderLogoUrl(id)
  if (!logoUrl) {
    return null
  }
  return <img src={logoUrl} alt={name || id} className={className} style={{ width: size, height: size }} />
}
