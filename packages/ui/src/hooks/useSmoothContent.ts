import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

interface SmoothStore {
  buffer: string
  displayed: string
  listeners: Set<() => void>
  pos: number
}

/**
 * RAF-driven content smoother for streaming markdown rendering.
 *
 * Shows content immediately on mount, then uses RAF to smooth the reveal
 * of new characters that arrive during streaming. When `isAnimating`
 * transitions to false (stream ended), remaining content is flushed.
 *
 * @reference Simplified implementation inspired by lobe-ui's `useSmoothStreamContent`.
 * @see https://github.com/lobehub/lobe-ui/blob/main/src/Markdown/SyntaxMarkdown/useSmoothStreamContent.ts
 */
export function useSmoothContent(
  content: string,
  isAnimating: boolean,
  cps = 40,
): string {
  const storeRef = useRef<SmoothStore>({
    buffer: content,
    displayed: content,
    listeners: new Set(),
    pos: content.length,
  })
  const rafRef = useRef(0)
  const lastTimeRef = useRef(0)

  const subscribe = useCallback((listener: () => void) => {
    const { listeners } = storeRef.current
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const getSnapshot = useCallback(() => storeRef.current.displayed, [])

  const displayed = useSyncExternalStore(subscribe, getSnapshot)

  useEffect(() => {
    const store = storeRef.current
    const prevLen = store.buffer.length
    store.buffer = content

    const notify = () => {
      for (const fn of store.listeners) fn()
    }

    if (!isAnimating) {
      store.displayed = content
      store.pos = content.length
      cancelAnimationFrame(rafRef.current)
      notify()
      return
    }

    // Content shrunk or replaced — reset immediately
    if (content.length < prevLen) {
      store.displayed = content
      store.pos = content.length
      cancelAnimationFrame(rafRef.current)
      notify()
      return
    }

    // Already caught up — nothing to reveal
    if (store.pos >= content.length)
      return

    // Content grew — reveal new chars via RAF
    lastTimeRef.current = performance.now()

    const tick = (now: number) => {
      const dt = (now - lastTimeRef.current) / 1000
      lastTimeRef.current = now

      const charsToAdd = Math.max(1, Math.round(cps * dt))
      const newPos = Math.min(store.pos + charsToAdd, store.buffer.length)

      if (newPos !== store.pos) {
        store.pos = newPos
        store.displayed = store.buffer.slice(0, newPos)
        notify()
      }

      if (newPos < store.buffer.length) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(rafRef.current)
  }, [content, isAnimating, cps])

  return displayed
}
