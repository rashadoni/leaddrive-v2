/**
 * Format decimal SLA hours (e.g. 0.5, 2.25) as a compact "Xh Ym" / "Xm" / "Xh" label, rounded to
 * whole minutes so a value stored as a repeating fraction (20 min → 0.3333h) still reads as "20m".
 */
export function formatSlaHours(hours: number): string {
  const totalMin = Math.round((hours || 0) * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
