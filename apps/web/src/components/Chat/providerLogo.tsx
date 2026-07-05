import React from 'react'

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

const cache = new Map<string, string>()

async function getCachedLogoUrl(providerId: string): Promise<string | null> {
  const url = getProviderLogoUrl(providerId)
  if (!url)
    return null

  const cached = cache.get(url)
  if (cached)
    return cached

  try {
    const res = await fetch(url)
    if (!res.ok) {
      cache.set(url, url) // 失败时直接用原 URL 让浏览器兜底
      return url
    }
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    cache.set(url, blobUrl)
    return blobUrl
  }
  catch {
    return url
  }
}

interface ProviderLogoProps {
  id: string
  name?: string
  size?: number
  className?: string
}

export function ProviderLogo({ id, name, size = 16, className }: ProviderLogoProps) {
  const logoUrl = getProviderLogoUrl(id)

  // 初始用原 URL（浏览器会请求一次），缓存就绪后切到 blob URL
  const initialSrc = logoUrl && cache.get(logoUrl) ? cache.get(logoUrl)! : logoUrl
  const [src, updateSrc] = React.useReducer(
    (_state: string | null, nextSrc: string | null) => nextSrc,
    initialSrc,
  )

  React.useEffect(() => {
    if (!logoUrl) {
      updateSrc(null)
      return
    }

    // 缓存命中直接使用
    if (cache.has(logoUrl)) {
      updateSrc(cache.get(logoUrl)!)
      return
    }

    // 缓存未命中时异步请求并缓存
    let cancelled = false
    getCachedLogoUrl(id).then((result) => {
      if (!cancelled)
        updateSrc(result)
    })
    return () => {
      cancelled = true
    }
  }, [id, logoUrl])

  if (!src)
    return null

  return <img src={src} alt={name || id} className={className} style={{ width: size, height: size }} />
}
