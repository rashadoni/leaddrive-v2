/**
 * Case-insensitive substring match for any keyword in `text`. Returns the
 * matched keyword (preserving its original casing) or null.
 *
 * Dependency-free on purpose: pollers and tests need the real matcher without
 * pulling ingest-mention's transitive graph (workflow-engine → next-auth).
 */
export function findMatchedKeyword(text: string, keywords: string[] | null | undefined): string | null {
  if (!text || !keywords || keywords.length === 0) return null
  const lower = text.toLowerCase()
  for (const kw of keywords) {
    const trimmed = kw.trim()
    if (!trimmed) continue
    if (lower.includes(trimmed.toLowerCase())) return trimmed
  }
  return null
}
