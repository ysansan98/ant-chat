import { useMemo } from 'react'
import { buildReferenceInputParts } from './inputReferences'

interface ReferenceInputOverlayProps {
  text: string
  confirmedFileReferences: string[]
  confirmedSkillReference?: string
  scrollTop: number
}

export function ReferenceInputOverlay({
  text,
  confirmedFileReferences,
  confirmedSkillReference,
  scrollTop,
}: ReferenceInputOverlayProps) {
  const parts = useMemo(
    () => buildReferenceInputParts(text, confirmedFileReferences, confirmedSkillReference),
    [text, confirmedFileReferences, confirmedSkillReference],
  )

  return (
    <div
      aria-hidden="true"
      className="
        pointer-events-none absolute inset-0 z-0 max-h-48 min-h-24 overflow-hidden p-1 text-left
        text-sm wrap-break-word whitespace-pre-wrap
      "
    >
      <div style={{ transform: `translateY(-${scrollTop}px)` }}>
        {parts.map((part) => {
          if (part.type === 'text') {
            return <span key={`${part.offset}-text`}>{part.text}</span>
          }

          return (
            <span
              key={`${part.offset}-${part.type}-${part.text}`}
              data-testid="reference-token"
              className="rounded-sm bg-primary/10 text-primary ring-2 ring-primary/10"
            >
              {part.text}
            </span>
          )
        })}
      </div>
    </div>
  )
}
