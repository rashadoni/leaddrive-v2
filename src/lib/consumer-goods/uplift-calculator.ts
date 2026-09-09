/**
 * Uplift + ROI calculator — R4 Phase 5 slice 1.
 *
 * Pure math: given baseline sales, actual sales, and total trade
 * spend over a promo period, compute incremental sales, uplift %,
 * ROI, profitability flag, and spend efficiency.
 *
 * Salesforce CG Cloud convention: ROI = (incremental - spend) / spend.
 * A campaign with ROI > 0 is profitable in the strict sense; we
 * surface a separate `profitable` boolean so callers don't need to
 * special-case the spend==0 null.
 *
 * Pure synchronous. No I/O.
 */
import type { UpliftInput, UpliftResult } from "./types"

export function calculateUplift(input: UpliftInput): UpliftResult {
  const baseline = sanitiseFinite(input.baselineSalesAmount)
  const actual = sanitiseFinite(input.actualSalesAmount)
  const spend = sanitiseFinite(input.totalSpendAmount)

  if (baseline < 0) {
    throw new Error("baselineSalesAmount must be >= 0")
  }
  if (actual < 0) {
    throw new Error("actualSalesAmount must be >= 0")
  }
  if (spend < 0) {
    throw new Error("totalSpendAmount must be >= 0")
  }

  const incrementalSales = actual - baseline
  const upliftPct = baseline === 0 ? null : incrementalSales / baseline
  const roi = spend === 0 ? null : (incrementalSales - spend) / spend
  const spendEfficiency = spend === 0 ? null : incrementalSales / spend
  const profitable = spend > 0 ? incrementalSales > spend : incrementalSales > 0

  return {
    incrementalSales,
    upliftPct,
    roi,
    profitable,
    spendEfficiency,
  }
}

function sanitiseFinite(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Numeric input must be finite (got ${value})`)
  }
  return value
}

/* ─── Tactic roll-up ──────────────────────────────────────────────────── */

import type {
  TacticKind,
  TacticSpendRollup,
} from "./types"

export interface TacticSpendRow {
  tacticId: string
  amount: number
  attributedSalesAmount?: number | null
}

export interface TacticDefinitionRow {
  id: string
  kind: TacticKind
  allocatedBudgetAmount: number
}

/**
 * Roll up trade-spend rows by tacticId, returning one summary per
 * tactic definition (even if no spends exist — `totalSpend: 0`).
 *
 * Caller fetches the spends + the tactic definitions; the engine
 * does the grouping + math. Slice 2's KPI cron writes the result
 * onto a materialised view; slice 1's API returns it inline.
 */
export function rollupTacticSpends(
  tactics: readonly TacticDefinitionRow[],
  spends: readonly TacticSpendRow[]
): TacticSpendRollup[] {
  const byTactic = new Map<string, { totalSpend: number; attributedSales: number }>()
  for (const s of spends) {
    if (!Number.isFinite(s.amount) || s.amount < 0) continue
    const bucket = byTactic.get(s.tacticId) ?? { totalSpend: 0, attributedSales: 0 }
    bucket.totalSpend += s.amount
    if (
      s.attributedSalesAmount != null &&
      Number.isFinite(s.attributedSalesAmount) &&
      s.attributedSalesAmount >= 0
    ) {
      bucket.attributedSales += s.attributedSalesAmount
    }
    byTactic.set(s.tacticId, bucket)
  }

  return tactics.map(t => {
    const bucket = byTactic.get(t.id) ?? { totalSpend: 0, attributedSales: 0 }
    const allocated = t.allocatedBudgetAmount
    const pacingPct = allocated === 0 ? null : bucket.totalSpend / allocated
    const tacticRoi =
      bucket.totalSpend === 0
        ? null
        : (bucket.attributedSales - bucket.totalSpend) / bucket.totalSpend
    return {
      tacticId: t.id,
      kind: t.kind,
      totalSpend: bucket.totalSpend,
      allocatedBudget: allocated,
      pacingPct,
      attributedSales: bucket.attributedSales,
      tacticRoi,
    }
  })
}
