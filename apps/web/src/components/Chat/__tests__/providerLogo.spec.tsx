import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderLogo } from '../providerLogo'

describe('providerLogo', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('内置图标使用打包资源，不请求 models.dev', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    render(<ProviderLogo id="magpie" name="Magpie" />)

    const img = await screen.findByRole('img')
    const src = img.getAttribute('src')
    expect(src).toBeTruthy()
    expect(src).not.toContain('models.dev')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('未内置的 provider 仍从 models.dev 目录取图', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: false }) as Response)
    vi.stubGlobal('fetch', fetchSpy)

    render(<ProviderLogo id="openai" name="OpenAI" />)

    const img = await screen.findByRole('img')
    expect(img.getAttribute('src')).toContain('models.dev/logos/openai.svg')
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
  })
})
