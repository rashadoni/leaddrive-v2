/**
 * Inventory Management types — D7 Phase 6 Block A slice 1.
 *
 * Salesforce Inventory Cloud analogue. Four pure-helper workflows:
 *
 *   1. Movement validator — given a (type, quantityDelta, column)
 *      tuple, verify the sign matches the type AND the operation
 *      makes sense for the column.
 *   2. Available-quantity calculator — `available = onHand - reserved`
 *      with overflow / underflow guards.
 *   3. Reservation engine — reserve / release stock with cap math
 *      (cannot reserve > available, cannot release > reserved).
 *   4. Low-stock detector — given an inventory item + threshold,
 *      decide whether to emit a LowStockAlert.
 */

/* ─── StockMovement type registry ─────────────────────────────────────── */

/**
 * Tuple of valid movement types — single source of truth. Matches the
 * DB CHECK at migration `stock_movements_type_check`.
 *
 *   receipt          — inbound goods received from a supplier
 *   shipment         — outbound goods shipped to a customer
 *   reservation      — soft-allocation when a cart line is added
 *   release          — reservation undone (cart abandoned / item removed)
 *   transfer_in      — incoming leg of a multi-warehouse transfer
 *   transfer_out     — outgoing leg of a multi-warehouse transfer
 *   adjustment_in    — operator-correction adding stock (recount up)
 *   adjustment_out   — operator-correction removing stock (recount down)
 *   loss             — write-off (damaged / stolen / expired)
 */
export const STOCK_MOVEMENT_TYPES = [
  "receipt",
  "shipment",
  "reservation",
  "release",
  "transfer_in",
  "transfer_out",
  "adjustment_in",
  "adjustment_out",
  "loss",
] as const

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number]

/** Which InventoryItem column this movement affects. */
export const STOCK_MOVEMENT_COLUMNS = ["onHand", "reserved"] as const
export type StockMovementColumn = (typeof STOCK_MOVEMENT_COLUMNS)[number]

/**
 * For each movement type, the expected sign of `quantityDelta` AND
 * which column it touches. Helper enforces this so a raw write that
 * disagrees (e.g. negative receipt, or a reservation on onHand) is
 * caught at the boundary BEFORE the DB CHECK fires a generic error.
 */
export const MOVEMENT_TYPE_RULES: Readonly<
  Record<
    StockMovementType,
    { sign: "positive" | "negative"; column: StockMovementColumn }
  >
> = {
  receipt: { sign: "positive", column: "onHand" },
  shipment: { sign: "negative", column: "onHand" },
  reservation: { sign: "negative", column: "reserved" },
  release: { sign: "positive", column: "reserved" },
  transfer_in: { sign: "positive", column: "onHand" },
  transfer_out: { sign: "negative", column: "onHand" },
  adjustment_in: { sign: "positive", column: "onHand" },
  adjustment_out: { sign: "negative", column: "onHand" },
  loss: { sign: "negative", column: "onHand" },
}

/**
 * NB on `reservation` / `release` column semantics: both rules above
 * say `column: "reserved"`, but the sign is COUNTER-INTUITIVE.
 *
 *   reservation: customer adds 3 widgets to cart →
 *     `quantityReserved` should INCREASE by 3, NOT decrease.
 *     We model `quantityDelta = -3` (sign-of-availability) and
 *     the reservation-engine applies `reserved -= quantityDelta`,
 *     i.e. `reserved += 3`.
 *
 *   release: customer abandons → `quantityReserved` should DECREASE.
 *     We model `quantityDelta = +3` (sign-of-availability), engine
 *     applies `reserved -= quantityDelta` = `reserved -= 3`.
 *
 * This keeps the sign-of-quantityDelta consistent with "available
 * stock change" across ALL movement types — a positive delta always
 * means MORE available stock; negative always means LESS. The
 * reservation-engine's update formula handles the column-write
 * direction internally.
 */

/* ─── Movement validator ──────────────────────────────────────────────── */

export interface ValidateMovementInput {
  type: StockMovementType
  /** Signed: positive for inbound, negative for outbound. Never 0. */
  quantityDelta: number
  /** Caller-supplied column. Must match MOVEMENT_TYPE_RULES[type].column. */
  column: StockMovementColumn
}

export interface ValidateMovementOk {
  ok: true
}

export interface ValidateMovementFail {
  ok: false
  errors: string[]
}

export type ValidateMovementResult = ValidateMovementOk | ValidateMovementFail

/* ─── Available-quantity calculator ───────────────────────────────────── */

export interface InventoryQuantities {
  quantityOnHand: number
  quantityReserved: number
}

export interface AvailableQuantityResult {
  available: number
  /**
   * Whether the result violates the DB invariant (reserved > onHand).
   * Should NEVER be true with healthy data — surfaces an alert when
   * a corrupted row is read. Caller logs + treats `available` as 0.
   */
  isCorrupted: boolean
}

/* ─── Reservation engine ──────────────────────────────────────────────── */

export interface ReserveStockInput {
  current: InventoryQuantities
  /** Number of units to reserve. Must be > 0. */
  units: number
}

export interface ReleaseStockInput {
  current: InventoryQuantities
  /** Number of units to release. Must be > 0 AND ≤ current.quantityReserved. */
  units: number
}

export interface MutateStockOk {
  ok: true
  /** New (quantityOnHand, quantityReserved) after the operation. */
  next: InventoryQuantities
  /**
   * Signed delta for the StockMovement audit row. Matches the
   * convention documented in MOVEMENT_TYPE_RULES — positive for
   * release (more available), negative for reservation (less available).
   */
  quantityDelta: number
}

export interface MutateStockFail {
  ok: false
  error: string
}

export type MutateStockResult = MutateStockOk | MutateStockFail

/* ─── Low-stock detector ──────────────────────────────────────────────── */

export interface DetectLowStockInput {
  current: InventoryQuantities
  /** Per-item override; null → use tenant default. */
  itemThreshold: number | null
  /** Tenant-level default (applied when itemThreshold is null). */
  tenantDefaultThreshold: number
  /** Has an unresolved alert already been emitted for this item? Slice-2 cron passes this. */
  hasOpenAlert: boolean
}

export type DetectLowStockResult =
  | { kind: "none"; reason: string }
  | { kind: "shouldEmit"; effectiveThreshold: number; available: number }
  | { kind: "shouldResolve"; reason: string }
  /**
   * Distinct discriminant for corrupted inventory rows (reserved >
   * onHand, negative quantities, NaN, etc.). Slice-2 cron MUST handle
   * this branch — either by emitting a high-priority corruption alert
   * via a different channel (Slack admin chan, on-call) OR by writing
   * an audit row + skipping low-stock detection. Returning a generic
   * "none" would silently hide low-stock signals AND data corruption
   * at the same time — architect P2 closure.
   */
  | { kind: "corrupted"; reason: string }
  /**
   * Misconfigured threshold (negative, NaN, non-integer). Same class
   * of bug as `corrupted` — it's a tenant-config integrity issue,
   * not stock state. Slice-2 cron MUST escalate to the admin-config
   * monitor channel (NOT a regular low-stock alert) so the operator
   * can fix the threshold setting. Closes the architect's note that
   * the "silent-hide of integrity issues" pattern recurred between
   * the corrupted-row path and the invalid-threshold path.
   */
  | { kind: "misconfigured"; reason: string }
