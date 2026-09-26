/**
 * Audit 2026-09-21: «Ср. длительность 169 мин» was the mean of five visits,
 * one of which lasted 787 minutes 9.9 km from the customer. One broken record
 * made the number meaningless. The median is what a typical visit took, and a
 * single forgotten check-out cannot move it.
 *
 * Returns whole minutes, or null when no visit in the list has a duration —
 * the card then shows a dash instead of a zero nobody measured.
 */
export function medianVisitDurationMinutes(visits: ReadonlyArray<{ duration?: number | null }>): number | null {
  const durations = visits
    .map((visit) => visit.duration)
    .filter((duration): duration is number => typeof duration === "number" && Number.isFinite(duration) && duration >= 0)
    .sort((left, right) => left - right)
  if (durations.length === 0) return null
  const middle = Math.floor(durations.length / 2)
  const median = durations.length % 2 === 1
    ? durations[middle]
    : (durations[middle - 1] + durations[middle]) / 2
  return Math.round(median)
}
