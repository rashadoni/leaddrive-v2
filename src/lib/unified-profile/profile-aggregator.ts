/**
 * Profile aggregator — G1 Phase 6 Block B slice 1.
 *
 * Given the source records linked to a profile + the invoices
 * attached to its underlying contact / company, compute the
 * materialized columns:
 *   • totalSpent — sum of `paid` invoices in the profile's
 *                  `primaryCurrency`
 *   • lifetimeOrderCount — count of `paid` invoices
 *   • firstSeenAt — earliest first-seen across all source records
 *   • lastSeenAt — latest last-seen across all source records
 *   • channelsActive — comma-separated source-type tags that
 *                      contributed AT LEAST ONE timestamp
 *   • crossCurrencyTotals — per-currency totals for invoices NOT
 *                           in primaryCurrency (slice-3 FX wires
 *                           these into totalSpent)
 *
 * Pure synchronous. Slice-2 cron loads source + invoice rows from
 * Prisma + calls this. The DB CHECK `unified_profiles_total_spent_check`
 * + `_order_count_check` + `_seen_order_check` (firstSeen ≤ lastSeen)
 * are the backstops.
 */
import type {
  AggregateProfileInput,
  AggregateProfileResult,
  AggregatorSourceRow,
  ProfileSourceType,
} from "./types"

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Pick the MIN / MAX of two nullable Date instances. null acts as
 * "no constraint" — anything wins over null on both sides.
 */
function minDate(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b
  if (b === null) return a
  return a.getTime() <= b.getTime() ? a : b
}
function maxDate(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b
  if (b === null) return a
  return a.getTime() >= b.getTime() ? a : b
}

export function aggregateProfile(
  input: AggregateProfileInput
): AggregateProfileResult {
  const { sources, invoices, primaryCurrency } = input

  // ── Source-side: first/last seen + channels ─────────────────
  let firstSeenAt: Date | null = null
  let lastSeenAt: Date | null = null
  const channels = new Set<ProfileSourceType>()
  for (const s of sources) {
    if (s.firstSeenAt instanceof Date) {
      firstSeenAt = minDate(firstSeenAt, s.firstSeenAt)
    }
    if (s.lastSeenAt instanceof Date) {
      lastSeenAt = maxDate(lastSeenAt, s.lastSeenAt)
    }
    // A source contributes its channel tag if it has ANY timestamp.
    if (s.firstSeenAt || s.lastSeenAt) {
      channels.add(s.sourceType)
    }
  }

  // Sort channels deterministically — stable output for tests / UI /
  // segmentation indexes. Returned as `ProfileSourceType[]` matching
  // the Postgres `channelsActive` array column.
  const channelsActive: ProfileSourceType[] = Array.from(channels).sort()

  // ── Invoice-side: totalSpent + count + cross-currency ───────
  let totalSpent = 0
  let lifetimeOrderCount = 0
  const crossCurrencyTotals: Record<string, number> = {}

  for (const inv of invoices) {
    if (inv.status !== "paid") continue
    if (!Number.isFinite(inv.totalAmount) || inv.totalAmount < 0) {
      // Defensive — bad invoice data shouldn't poison the aggregate.
      continue
    }
    if (inv.currency === primaryCurrency) {
      totalSpent += inv.totalAmount
      lifetimeOrderCount += 1
    } else {
      // Track per-currency totals separately. Slice-3 FX-converts.
      const prev = crossCurrencyTotals[inv.currency] ?? 0
      crossCurrencyTotals[inv.currency] = prev + inv.totalAmount
      // Cross-currency invoices DO count toward lifetimeOrderCount
      // — the customer placed an order, currency just differs. Slice-2
      // reporting may split if needed.
      lifetimeOrderCount += 1
    }
  }

  // Round all currency totals to 2dp (cents).
  totalSpent = round2(totalSpent)
  for (const code of Object.keys(crossCurrencyTotals)) {
    crossCurrencyTotals[code] = round2(crossCurrencyTotals[code])
  }

  return {
    totalSpent,
    lifetimeOrderCount,
    firstSeenAt,
    lastSeenAt,
    channelsActive,
    crossCurrencyTotals,
  }
}

/**
 * Convenience predicate — used by slice-2 cron to skip sources that
 * have NO temporal signal (a Lead row created but never updated
 * still has `createdAt`; this filter is for the slice-3 case where
 * a source has been created without any interaction record).
 */
export function hasSignal(s: AggregatorSourceRow): boolean {
  return s.firstSeenAt !== null || s.lastSeenAt !== null
}
