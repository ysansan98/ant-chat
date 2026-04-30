// Shim for `from 'shiki'` — re-exports only what consumers need,
// using our granular language set instead of bundling all 350+ languages.
//
// Used by:
//   - @streamdown/code (via Vite alias) — needs createHighlighter, bundledLanguagesInfo, bundledLanguages
//   - code-block.tsx (via Vite alias) — needs createBundledHighlighter, createJavaScriptRegexEngine

import type { ShikiLang } from './shiki-langs'
// Re-export everything from @shikijs/core (createBundledHighlighter, types, etc.)
import { createBundledHighlighter } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import { SHIKI_LANGUAGES } from './shiki-langs'

export * from '@shikijs/core'
// createJavaScriptRegexEngine lives in @shikijs/engine-javascript, but shiki re-exports it
export { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from '@shikijs/engine-javascript'

// --- bundledLanguagesInfo ---
// @streamdown/code uses this to build a language alias map.

export const bundledLanguagesInfo = Object.entries(SHIKI_LANGUAGES).map(([id]) => ({
  id,
  name: id,
  aliases: [] as string[],
}))

// --- bundledLanguages ---
// @streamdown/code only reads Object.keys() to get the set of supported languages.

export const bundledLanguages: Record<string, () => Promise<unknown>> = Object.fromEntries(
  Object.entries(SHIKI_LANGUAGES).map(([id, loader]) => [id as string, loader as () => Promise<unknown>]),
)

// --- createHighlighter ---
// Matches shiki's createHighlighter({ themes, langs, engine }) API,
// but backed by our granular bundle.

const factory = createBundledHighlighter({
  langs: SHIKI_LANGUAGES,
  themes: {
    'github-light': () => import('@shikijs/themes/github-light'),
    'github-dark': () => import('@shikijs/themes/github-dark'),
  },
  engine: () => createJavaScriptRegexEngine(),
})

export function createHighlighter(options: { themes: string[], langs: string[], engine?: unknown }) {
  // Filter out plaintext fallback which has no grammar — shiki handles 'text' internally
  const validLangs = options.langs.filter((l): l is ShikiLang => l in SHIKI_LANGUAGES)
  const langs = validLangs.length > 0 ? validLangs : ['typescript' as ShikiLang]

  return factory({
    langs,
    themes: options.themes as ['github-light', 'github-dark'],
    // engine is pre-configured in the factory; ignore the passed one
  })
}
