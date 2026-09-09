/**
 * Donor giving roll-up — R9 Phase 5 slice 1.
 *
 * Given a flat array of `DonationRow`s for a single donor, produce
 * a `DonorRollup` covering:
 *   - lifetime total + count + largest gift
 *   - first + most recent gift dates
 *   - recurring vs one-time split
 *   - per-year buckets (last 5 calendar years, descending)
 *   - per-program buckets (descending by total)
 *
 * Pure synchronous. No I/O. Caller fetches donations + invokes;
 * slice-2 KPI cron writes the result onto a materialised view.
 */
import type { DonationRow, DonorRollup } from "./types"

export interface AggregateDonorGivingInput {
  donorId: string
  donations: readonly DonationRow[]
  /**
   * Cap on per-year buckets returned (most recent N years). Default 5.
   * Set higher in slice 2's KPI cron when full-history reporting needs it.
   */
  maxYearBuckets?: number
}

const DEFAULT_MAX_YEAR_BUCKETS = 5

export function aggregateDonorGiving(input: AggregateDonorGivingInput): DonorRollup {
  const { donorId, donations } = input
  const maxYearBuckets = input.maxYearBuckets ?? DEFAULT_MAX_YEAR_BUCKETS

  let lifetimeTotal = 0
  let donationCount = 0
  let largestGift = 0
  let firstGiftAt: Date | null = null
  let mostRecentGiftAt: Date | null = null
  let recurringTotal = 0
  let oneTimeTotal = 0

  // Defensive — skip rows that aren't for this donor or have invalid
  // amounts. We don't throw — slice-2 cron processes millions of
  // rows and shouldn't poison a tenant's roll-up over one bad row.
  const yearBuckets = new Map<number, { total: number; count: number }>()
  const programBuckets = new Map<string, { total: number; count: number }>()

  for (const d of donations) {
    if (d.donorId !== donorId) continue
    if (!Number.isFinite(d.amount) || d.amount < 0) continue
    if (!(d.receivedAt instanceof Date) || Number.isNaN(d.receivedAt.getTime())) continue

    donationCount++
    lifetimeTotal += d.amount
    if (d.amount > largestGift) largestGift = d.amount
    if (firstGiftAt === null || d.receivedAt < firstGiftAt) firstGiftAt = d.receivedAt
    if (mostRecentGiftAt === null || d.receivedAt > mostRecentGiftAt) mostRecentGiftAt = d.receivedAt
    if (d.donationType === "recurring") recurringTotal += d.amount
    else oneTimeTotal += d.amount

    const year = d.receivedAt.getUTCFullYear()
    const yb = yearBuckets.get(year) ?? { total: 0, count: 0 }
    yb.total += d.amount
    yb.count += 1
    yearBuckets.set(year, yb)

    if (d.programId) {
      const pb = programBuckets.get(d.programId) ?? { total: 0, count: 0 }
      pb.total += d.amount
      pb.count += 1
      programBuckets.set(d.programId, pb)
    }
  }

  const byYear = [...yearBuckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, maxYearBuckets)
    .map(([year, { total, count }]) => ({ year, total, count }))

  const byProgram = [...programBuckets.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([programId, { total, count }]) => ({ programId, total, count }))

  return {
    donorId,
    lifetimeTotal,
    donationCount,
    largestGift,
    firstGiftAt,
    mostRecentGiftAt,
    recurringTotal,
    oneTimeTotal,
    byYear,
    byProgram,
  }
}
