/**
 * Consumer Goods Cloud (TPM + Retail Execution) types — R4 Phase 5 slice 1.
 *
 * Salesforce CG Cloud analogue. Builds on LeadDrive's existing MTM
 * (Mobile Trade Marketing) module: TradePromotion + PromotionTactic
 * + TradeSpend feed Trade Promotion Management; RetailExecutionAudit
 * extends MtmVisit with planogram-compliance / OSA / share-of-shelf
 * scoring.
 *
 * Slice 1: schema + pure helpers + CRUD routes. Slice 2: KPI rollup
 * crons + dashboards + uplift-prediction integration with H3.
 */

export type PromotionStatus = "planned" | "active" | "completed" | "cancelled"

export type TacticKind = "discount" | "display" | "sample" | "coupon" | "bundle"

/* ─── Uplift / ROI ────────────────────────────────────────────────────── */

export interface UpliftInput {
  /** Baseline sales over a comparable pre-promo period (same currency). */
  baselineSalesAmount: number
  /** Actual sales over the promo period. */
  actualSalesAmount: number
  /** Total trade spend across all tactics during the promo period. */
  totalSpendAmount: number
}

export interface UpliftResult {
  /** Incremental sales above baseline (may be negative). */
  incrementalSales: number
  /** % uplift relative to baseline; null when baseline is 0 (no comparable). */
  upliftPct: number | null
  /**
   * ROI = (incrementalSales - totalSpend) / totalSpend. Null when
   * totalSpend is 0 (no investment → ROI undefined).
   */
  roi: number | null
  /** Whether the campaign was profitable (incrementalSales > totalSpend). */
  profitable: boolean
  /** Per-currency-of-spend incremental sales (efficiency). Null when totalSpend is 0. */
  spendEfficiency: number | null
}

/* ─── Planogram / audit scoring ───────────────────────────────────────── */

export interface PlanogramSpec {
  /**
   * Expected facings per SKU on the shelf. A "facing" is one product
   * unit visible to the shopper. 4 facings = 4 product units in the
   * front row.
   */
  facingsByProduct: Record<string, number>
  /** SKUs that MUST be present on the shelf (subset of facingsByProduct). */
  requiredProducts: string[]
  /** Expected share-of-shelf for this brand (0..1). Optional. */
  expectedShareOfShelf?: number
}

export interface AuditObservations {
  /** Agent-observed facing count per SKU. */
  facingsByProduct: Record<string, number>
  /** SKUs the agent confirmed visible on the shelf. */
  productsPresent: string[]
  /** Number of price tags found correctly placed + accurate. */
  priceTagsCorrect: number
  /** Total price tags inspected. */
  priceTagsTotal: number
  /** Total facings of competitor + own brand combined — for share-of-shelf math. */
  totalShelfFacings?: number
}

export interface ScorePenalty {
  /** Stable code: missing_required_product | priceTag_inaccurate | osa_below_target | ... */
  code: string
  /** Human-readable description. */
  message: string
  /**
   * Score-points-relative contribution of this rule's failure.
   *
   * NOTE: penalty weights are NOT a strict decomposition — summing
   * `penalties[].weight` does NOT equal `100 - totalScore` when one of
   * the four sub-scores is null (e.g. share-of-shelf when
   * expectedShareOfShelf is unset, priceTagAccuracy when no tags
   * inspected). Treat the field as a UI-friendly relative magnitude
   * for sorting penalties by impact, not as an absolute deficit.
   */
  weight: number
}

export interface ScoreBreakdown {
  /** On-Shelf Availability: fraction of required products present (0..1). */
  osaScore: number
  /** Share-of-Shelf: actual / expected (capped at 1.0). null when expected not set. */
  shareOfShelfScore: number | null
  /** Planogram Compliance: facings actual / facings expected averaged across SKUs. */
  planogramComplianceScore: number
  /** Price-tag accuracy: correct / total. null when no tags inspected. */
  priceTagAccuracy: number | null
  /** Weighted total 0..100. */
  totalScore: number
  /** Per-rule penalties — drives the UI's "why is the score X" panel. */
  penalties: ScorePenalty[]
}

/* ─── Tactic roll-up ──────────────────────────────────────────────────── */

export interface TacticSpendRollup {
  tacticId: string
  kind: TacticKind
  /** Sum of TradeSpend.amount for the tactic. */
  totalSpend: number
  /** Allocated budget from PromotionTactic.allocatedBudgetAmount. */
  allocatedBudget: number
  /** Pacing: actual / allocated (0..1+ if over budget). Null when allocated is 0. */
  pacingPct: number | null
  /** Sum of TradeSpend.attributedSalesAmount where present. */
  attributedSales: number
  /** Per-spend ROI for this tactic. Null when totalSpend is 0. */
  tacticRoi: number | null
}
