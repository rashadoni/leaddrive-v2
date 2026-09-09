export const PHARMACY_PROMOTION_SECONDARY_COLUMNS = [
  "promotion",
  "employee",
  "planFact",
  "factPoints",
  "rewardPoints",
  "difference",
  "review",
  "source",
] as const

export type PharmacyPromotionSecondaryColumn = typeof PHARMACY_PROMOTION_SECONDARY_COLUMNS[number]

/**
 * Restores only the UI columns owned by this release. Unknown or empty input
 * falls back to the complete safe view, so a stale saved view cannot hide the
 * registry or inject arbitrary identifiers into the renderer.
 */
export function pharmacyPromotionColumnsFromParam(
  value: string | null,
): Set<PharmacyPromotionSecondaryColumn> {
  if (!value) return new Set(PHARMACY_PROMOTION_SECONDARY_COLUMNS)
  const allowed = new Set<string>(PHARMACY_PROMOTION_SECONDARY_COLUMNS)
  const selected = value
    .split(",")
    .map((column) => column.trim())
    .filter((column): column is PharmacyPromotionSecondaryColumn => allowed.has(column))
  return selected.length > 0
    ? new Set(selected)
    : new Set(PHARMACY_PROMOTION_SECONDARY_COLUMNS)
}
