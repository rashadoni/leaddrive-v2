/**
 * The conversion probability a scoring model produced for a lead — or null.
 *
 * Screens used to fill the gap with `Math.round(score × 0.85)`: a probability
 * no model estimated, printed as a percentage. On 2026-09-21 not one of the 106
 * open leads on prod carried a stored probability, so every ring in the leads
 * «Top leads» panel was the score times 0.85.
 *
 * One writer stores `conversionProb`: Da Vinci scoring (POST
 * /api/v1/lead-scoring), and it stamps `aiPowered: true` only on results the
 * model itself returned. Its rule-based fallback adds up points and has no
 * probability model, so it stores none. The heuristic in
 * src/lib/ai/lead-scoring.ts — what the scoring cron and every lead event run —
 * produces no probability either, and rewrites `scoreDetails` without one.
 */
export function modelConversionProbability(scoreDetails: unknown): number | null {
  if (!scoreDetails || typeof scoreDetails !== "object" || Array.isArray(scoreDetails)) return null
  const details = scoreDetails as Record<string, unknown>
  if (details.aiPowered !== true) return null
  const value = details.conversionProb
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return null
  return Math.round(value)
}

/**
 * Highest (or lowest) probability first; a lead without one goes after every
 * lead that has one, whichever the direction — no value is made up for it.
 */
export function compareProbabilities(a: number | null, b: number | null, direction: "asc" | "desc"): number {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1
  return direction === "desc" ? b - a : a - b
}

/** The mean over the leads the model estimated, with how many that is; null when none. */
export function averageProbability(values: readonly (number | null)[]): { value: number; count: number } | null {
  const known = values.filter((v): v is number => v != null)
  if (known.length === 0) return null
  return { value: Math.round(known.reduce((sum, v) => sum + v, 0) / known.length), count: known.length }
}
