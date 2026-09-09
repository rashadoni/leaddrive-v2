/**
 * Stock-movement validator — D7 Phase 6 Block A slice 1.
 *
 * Given a (type, quantityDelta, column) tuple, validate that:
 *   1. quantityDelta is a non-zero finite integer
 *   2. The sign matches the type per MOVEMENT_TYPE_RULES
 *   3. The column matches the type per MOVEMENT_TYPE_RULES
 *
 * Pure synchronous. Slice-2 StockMovement POST route wraps this with
 * Prisma I/O. The DB CHECK constraints at `stock_movements_type_check`
 * + `_column_check` + `_delta_nonzero_check` + `_sign_check` are the
 * backstop — this helper surfaces specific errors at the request
 * boundary so the operator sees what to fix.
 */
import {
  MOVEMENT_TYPE_RULES,
  type ValidateMovementInput,
  type ValidateMovementResult,
} from "./types"

export function validateStockMovement(
  input: ValidateMovementInput
): ValidateMovementResult {
  const errors: string[] = []
  const { type, quantityDelta, column } = input

  if (!Number.isInteger(quantityDelta)) {
    errors.push(`quantityDelta must be an integer; got ${quantityDelta}`)
  }
  if (quantityDelta === 0) {
    errors.push("quantityDelta must be non-zero (zero-delta movements are not allowed)")
  }

  // Bail out if delta is malformed — the sign/column checks below
  // are not meaningful with a NaN or zero delta.
  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const rule = MOVEMENT_TYPE_RULES[type]

  // sign check
  if (rule.sign === "positive" && quantityDelta < 0) {
    errors.push(
      `Movement type "${type}" requires positive quantityDelta; got ${quantityDelta}`
    )
  }
  if (rule.sign === "negative" && quantityDelta > 0) {
    errors.push(
      `Movement type "${type}" requires negative quantityDelta; got ${quantityDelta}`
    )
  }

  // column check
  if (column !== rule.column) {
    errors.push(
      `Movement type "${type}" affects column "${rule.column}"; got "${column}"`
    )
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true }
}
