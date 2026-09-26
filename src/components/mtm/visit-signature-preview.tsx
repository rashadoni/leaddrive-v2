/**
 * The customer's finger-drawn signature from the field app, drawn as one path.
 * The path is re-checked against the validator's character set before it is
 * rendered, so stored evidence can only ever draw lines.
 */
export function SignaturePreview({ evidence, label, className = "mt-3" }: {
  evidence?: Record<string, unknown> | null
  label: string
  className?: string
}) {
  const path = typeof evidence?.svgPath === "string" && /^[MLQCZmlqcz0-9.,\s-]+$/.test(evidence.svgPath) ? evidence.svgPath : null
  const width = typeof evidence?.widthPx === "number" ? evidence.widthPx : 0
  const height = typeof evidence?.heightPx === "number" ? evidence.heightPx : 0
  if (!path || !width || !height) return null
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={`${className} h-24 w-full max-w-sm rounded-md border border-zinc-200 bg-white dark:border-zinc-700`} role="img" aria-label={label}>
      <path d={path} fill="none" stroke="#13231f" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
