/**
 * Shipment state machine — D3 OMS Phase 6 Block A slice 1.
 *
 * Validates a proposed status transition on an OrderShipment and
 * tells the caller which timestamp side-effect to apply. Pure
 * synchronous — slice-2 routes wrap with the actual Prisma update
 * inside a transaction that sets shippedAt / deliveredAt = now().
 *
 * The DB CHECK constraint on `order_shipments_timestamps_check`
 * enforces the same invariants at write time as a safety net.
 */
import {
  SHIPMENT_TRANSITIONS,
  type AdvanceShipmentInput,
  type AdvanceShipmentResult,
  type ShipmentStatus,
} from "./types"

const TERMINAL_STATES: ReadonlySet<ShipmentStatus> = new Set([
  "delivered",
  "cancelled",
])

export function advanceShipmentState(
  input: AdvanceShipmentInput
): AdvanceShipmentResult {
  const { from, to } = input

  if (from === to) {
    return {
      ok: false,
      error: `Already in state "${from}" — no-op transition rejected`,
    }
  }

  if (TERMINAL_STATES.has(from)) {
    return {
      ok: false,
      error: `Cannot transition from terminal state "${from}" → "${to}"`,
    }
  }

  const allowed = SHIPMENT_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error: `Invalid shipment transition: "${from}" → "${to}"`,
    }
  }

  // Side-effect derivation: which timestamp does the caller need to set?
  // shipping  = first time moving into in_transit OR exception from pending
  // delivering = moving into delivered (terminal happy path)
  // none      = exception loopback / cancel / in_transit ↔ exception
  let sideEffect: "shipping" | "delivering" | "none"
  if (to === "delivered") {
    sideEffect = "delivering"
  } else if (from === "pending" && (to === "in_transit" || to === "exception")) {
    sideEffect = "shipping"
  } else {
    // exception → in_transit (recovery), in_transit → exception (carrier flag),
    // pending → cancelled: no new timestamp.
    sideEffect = "none"
  }

  return { ok: true, sideEffect }
}

/**
 * Convenience: is this shipment status a no-progression terminal?
 */
export function isTerminalShipmentState(state: ShipmentStatus): boolean {
  return TERMINAL_STATES.has(state)
}
