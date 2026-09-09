/**
 * Available-quantity calculator — D7 Phase 6 Block A slice 1.
 *
 * `available = onHand - reserved`. Used by:
 *   • the reservation engine to decide whether more units can be reserved
 *   • the low-stock detector to compare against threshold
 *   • the headless-commerce catalog (slice-2) to show "in stock"
 *
 * Corruption guard: the DB CHECK `inventory_items_reserved_le_on_hand_check`
 * forbids reserved > onHand, but the helper still defensively detects
 * it (returns `isCorrupted: true` + clamps available to 0) so a row
 * that somehow got past the check (raw SQL, migration script, etc.)
 * doesn't produce a negative `available` that breaks downstream math.
 */
import type {
  AvailableQuantityResult,
  InventoryQuantities,
} from "./types"

export function calculateAvailable(
  q: InventoryQuantities
): AvailableQuantityResult {
  // Defensive: non-integer / NaN coerces to a corrupted result rather
  // than NaN-poisoning downstream calculations.
  if (
    !Number.isFinite(q.quantityOnHand) ||
    !Number.isFinite(q.quantityReserved) ||
    !Number.isInteger(q.quantityOnHand) ||
    !Number.isInteger(q.quantityReserved)
  ) {
    return { available: 0, isCorrupted: true }
  }
  if (q.quantityOnHand < 0 || q.quantityReserved < 0) {
    return { available: 0, isCorrupted: true }
  }
  if (q.quantityReserved > q.quantityOnHand) {
    // DB CHECK should have prevented this. Treat available as 0 and
    // surface corruption to the caller.
    return { available: 0, isCorrupted: true }
  }

  return {
    available: q.quantityOnHand - q.quantityReserved,
    isCorrupted: false,
  }
}
