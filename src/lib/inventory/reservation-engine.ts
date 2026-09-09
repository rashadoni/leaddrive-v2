/**
 * Reservation engine — D7 Phase 6 Block A slice 1.
 *
 * Pure helpers to compute the next (quantityOnHand, quantityReserved)
 * tuple after a reservation or release. Slice-2 cart-add-item path
 * pipes through `reserveStock`; cart-remove-item / abandon path uses
 * `releaseStock`.
 *
 * Invariants enforced:
 *   • units must be a positive integer
 *   • reserveStock fails when `units > available` (cap math)
 *   • releaseStock fails when `units > current.quantityReserved`
 *   • quantityOnHand is NEVER touched by either operation
 *     (only reservation/release affect `quantityReserved`)
 *
 * `quantityDelta` returned for the StockMovement audit row uses the
 * "sign-of-availability" convention from types.ts:
 *   reservation → quantityDelta = -units (less available)
 *   release     → quantityDelta = +units (more available)
 */
import { calculateAvailable } from "./available-quantity"
import type {
  InventoryQuantities,
  MutateStockResult,
  ReleaseStockInput,
  ReserveStockInput,
} from "./types"

function validateUnits(units: number, label: string): string | null {
  if (!Number.isInteger(units)) return `${label}: units must be an integer; got ${units}`
  if (units <= 0) return `${label}: units must be > 0; got ${units}`
  return null
}

export function reserveStock(input: ReserveStockInput): MutateStockResult {
  const { current, units } = input

  const unitsErr = validateUnits(units, "reserveStock")
  if (unitsErr) return { ok: false, error: unitsErr }

  const avail = calculateAvailable(current)
  if (avail.isCorrupted) {
    return {
      ok: false,
      error: "reserveStock: current inventory row is corrupted (reserved > onHand or non-integer)",
    }
  }
  if (units > avail.available) {
    return {
      ok: false,
      error: `reserveStock: requested ${units} but only ${avail.available} available (onHand=${current.quantityOnHand}, reserved=${current.quantityReserved})`,
    }
  }

  const next: InventoryQuantities = {
    quantityOnHand: current.quantityOnHand,
    quantityReserved: current.quantityReserved + units,
  }
  return {
    ok: true,
    next,
    quantityDelta: -units, // negative → less available
  }
}

export function releaseStock(input: ReleaseStockInput): MutateStockResult {
  const { current, units } = input

  const unitsErr = validateUnits(units, "releaseStock")
  if (unitsErr) return { ok: false, error: unitsErr }

  if (units > current.quantityReserved) {
    return {
      ok: false,
      error: `releaseStock: requested ${units} but only ${current.quantityReserved} reserved`,
    }
  }

  const next: InventoryQuantities = {
    quantityOnHand: current.quantityOnHand,
    quantityReserved: current.quantityReserved - units,
  }
  return {
    ok: true,
    next,
    quantityDelta: +units, // positive → more available
  }
}
