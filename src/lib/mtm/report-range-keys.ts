/**
 * The days right before a report's period, as many as it has: what the page
 * compares each figure with. Plain date keys (YYYY-MM-DD), no timezone — the
 * API turns them into the organization's days.
 */
export function previousRangeKeys(from: string, to: string): { from: string; to: string } {
  const day = 86_400_000
  const start = Date.parse(`${from}T00:00:00Z`)
  const length = Math.round((Date.parse(`${to}T00:00:00Z`) - start) / day) + 1
  const key = (time: number) => new Date(time).toISOString().slice(0, 10)
  return { from: key(start - length * day), to: key(start - day) }
}
