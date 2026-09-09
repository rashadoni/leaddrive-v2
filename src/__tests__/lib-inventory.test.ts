/**
 * Tests for D7 Inventory Management slice 1 — movement-validator +
 * available-quantity + reservation-engine + low-stock-detector pure
 * helpers. No DB.
 */
import { describe, expect, it } from "vitest"
import { validateStockMovement } from "@/lib/inventory/movement-validator"
import { calculateAvailable } from "@/lib/inventory/available-quantity"
import {
  releaseStock,
  reserveStock,
} from "@/lib/inventory/reservation-engine"
import { detectLowStock } from "@/lib/inventory/low-stock-detector"
import {
  MOVEMENT_TYPE_RULES,
  STOCK_MOVEMENT_TYPES,
  type InventoryQuantities,
  type StockMovementType,
} from "@/lib/inventory/types"

/* ─── validateStockMovement ───────────────────────────────────────────── */

describe("D7 — validateStockMovement", () => {
  it("accepts every documented (type, sign, column) combination", () => {
    for (const type of STOCK_MOVEMENT_TYPES) {
      const rule = MOVEMENT_TYPE_RULES[type]
      const delta = rule.sign === "positive" ? 1 : -1
      const r = validateStockMovement({ type, quantityDelta: delta, column: rule.column })
      expect(r.ok).toBe(true)
    }
  })

  it("rejects zero quantityDelta", () => {
    const r = validateStockMovement({ type: "receipt", quantityDelta: 0, column: "onHand" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/non-zero/)
  })

  it("rejects non-integer quantityDelta", () => {
    const r = validateStockMovement({ type: "receipt", quantityDelta: 1.5, column: "onHand" })
    expect(r.ok).toBe(false)
  })

  it("rejects NaN quantityDelta", () => {
    const r = validateStockMovement({ type: "receipt", quantityDelta: Number.NaN, column: "onHand" })
    expect(r.ok).toBe(false)
  })

  it("rejects mismatched sign (e.g. shipment with positive delta)", () => {
    const r = validateStockMovement({ type: "shipment", quantityDelta: 5, column: "onHand" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/requires negative/)
  })

  it("rejects mismatched sign (e.g. receipt with negative delta)", () => {
    const r = validateStockMovement({ type: "receipt", quantityDelta: -5, column: "onHand" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/requires positive/)
  })

  it("rejects mismatched column (e.g. reservation on onHand)", () => {
    const r = validateStockMovement({ type: "reservation", quantityDelta: -5, column: "onHand" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/affects column "reserved"/)
  })

  it("rejects mismatched column (e.g. receipt on reserved)", () => {
    const r = validateStockMovement({ type: "receipt", quantityDelta: 5, column: "reserved" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/affects column "onHand"/)
  })

  it("reports BOTH sign and column errors when both wrong", () => {
    // shipment requires negative + onHand; supply positive + reserved → 2 errors.
    const r = validateStockMovement({ type: "shipment", quantityDelta: 5, column: "reserved" })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toHaveLength(2)
      expect(r.errors.some((e) => e.match(/requires negative/))).toBe(true)
      expect(r.errors.some((e) => e.match(/affects column "onHand"/))).toBe(true)
    }
  })
})

/* ─── calculateAvailable ──────────────────────────────────────────────── */

describe("D7 — calculateAvailable", () => {
  it("returns onHand - reserved on a healthy row", () => {
    const r = calculateAvailable({ quantityOnHand: 100, quantityReserved: 30 })
    expect(r.available).toBe(70)
    expect(r.isCorrupted).toBe(false)
  })

  it("returns 0 when fully reserved", () => {
    const r = calculateAvailable({ quantityOnHand: 100, quantityReserved: 100 })
    expect(r.available).toBe(0)
    expect(r.isCorrupted).toBe(false)
  })

  it("flags isCorrupted when reserved > onHand (DB CHECK regression)", () => {
    const r = calculateAvailable({ quantityOnHand: 50, quantityReserved: 100 })
    expect(r.available).toBe(0) // clamped
    expect(r.isCorrupted).toBe(true)
  })

  it("flags isCorrupted on negative onHand", () => {
    const r = calculateAvailable({ quantityOnHand: -5, quantityReserved: 0 })
    expect(r.isCorrupted).toBe(true)
    expect(r.available).toBe(0)
  })

  it("flags isCorrupted on negative reserved", () => {
    const r = calculateAvailable({ quantityOnHand: 10, quantityReserved: -1 })
    expect(r.isCorrupted).toBe(true)
  })

  it("flags isCorrupted on non-integer quantities (NaN-poisoning guard)", () => {
    const r = calculateAvailable({ quantityOnHand: 10.5, quantityReserved: 0 })
    expect(r.isCorrupted).toBe(true)
  })

  it("flags isCorrupted on NaN quantities", () => {
    const r = calculateAvailable({ quantityOnHand: Number.NaN, quantityReserved: 0 })
    expect(r.isCorrupted).toBe(true)
  })
})

/* ─── reserveStock ────────────────────────────────────────────────────── */

describe("D7 — reserveStock", () => {
  const CURRENT: InventoryQuantities = { quantityOnHand: 100, quantityReserved: 30 }

  it("reserves units, increments quantityReserved, leaves onHand alone", () => {
    const r = reserveStock({ current: CURRENT, units: 5 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.next.quantityOnHand).toBe(100)
      expect(r.next.quantityReserved).toBe(35)
      // quantityDelta is "sign-of-availability" — negative means less available.
      expect(r.quantityDelta).toBe(-5)
    }
  })

  it("can reserve exactly the available headroom", () => {
    // available = 100 - 30 = 70; reserve all 70.
    const r = reserveStock({ current: CURRENT, units: 70 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.next.quantityReserved).toBe(100)
      // Post-condition: reserved == onHand → available is now 0.
      expect(r.next.quantityOnHand).toBe(r.next.quantityReserved)
    }
  })

  it("rejects reservation exceeding available", () => {
    const r = reserveStock({ current: CURRENT, units: 71 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/only 70 available/)
  })

  it("rejects zero units", () => {
    const r = reserveStock({ current: CURRENT, units: 0 })
    expect(r.ok).toBe(false)
  })

  it("rejects negative units", () => {
    const r = reserveStock({ current: CURRENT, units: -5 })
    expect(r.ok).toBe(false)
  })

  it("rejects non-integer units", () => {
    const r = reserveStock({ current: CURRENT, units: 1.5 })
    expect(r.ok).toBe(false)
  })

  it("rejects on corrupted current row", () => {
    const r = reserveStock({
      current: { quantityOnHand: 50, quantityReserved: 100 }, // reserved > onHand
      units: 1,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/corrupted/)
  })
})

/* ─── releaseStock ────────────────────────────────────────────────────── */

describe("D7 — releaseStock", () => {
  const CURRENT: InventoryQuantities = { quantityOnHand: 100, quantityReserved: 30 }

  it("releases units, decrements quantityReserved, leaves onHand alone", () => {
    const r = releaseStock({ current: CURRENT, units: 10 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.next.quantityOnHand).toBe(100)
      expect(r.next.quantityReserved).toBe(20)
      // sign-of-availability: positive → more available.
      expect(r.quantityDelta).toBe(+10)
    }
  })

  it("can release exactly all reserved", () => {
    const r = releaseStock({ current: CURRENT, units: 30 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.next.quantityReserved).toBe(0)
  })

  it("rejects releasing more than reserved", () => {
    const r = releaseStock({ current: CURRENT, units: 31 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/only 30 reserved/)
  })

  it("rejects zero / negative / non-integer units", () => {
    for (const units of [0, -1, 1.5]) {
      const r = releaseStock({ current: CURRENT, units })
      expect(r.ok).toBe(false)
    }
  })
})

/* ─── detectLowStock ──────────────────────────────────────────────────── */

describe("D7 — detectLowStock", () => {
  const STOCKED: InventoryQuantities = { quantityOnHand: 100, quantityReserved: 20 } // avail=80
  const LOW: InventoryQuantities = { quantityOnHand: 8, quantityReserved: 3 } // avail=5
  const EMPTY: InventoryQuantities = { quantityOnHand: 0, quantityReserved: 0 } // avail=0

  it("returns 'none' when available > threshold AND no open alert", () => {
    const r = detectLowStock({
      current: STOCKED,
      itemThreshold: null,
      tenantDefaultThreshold: 10,
      hasOpenAlert: false,
    })
    expect(r.kind).toBe("none")
  })

  it("returns 'shouldEmit' when available <= threshold AND no open alert", () => {
    const r = detectLowStock({
      current: LOW,
      itemThreshold: null,
      tenantDefaultThreshold: 10,
      hasOpenAlert: false,
    })
    expect(r.kind).toBe("shouldEmit")
    if (r.kind === "shouldEmit") {
      expect(r.effectiveThreshold).toBe(10)
      expect(r.available).toBe(5)
    }
  })

  it("returns 'none' when available <= threshold but open alert exists (no re-fire)", () => {
    const r = detectLowStock({
      current: LOW,
      itemThreshold: null,
      tenantDefaultThreshold: 10,
      hasOpenAlert: true,
    })
    expect(r.kind).toBe("none")
    if (r.kind === "none") expect(r.reason).toMatch(/Already has an open alert/)
  })

  it("returns 'shouldResolve' when available > threshold AND open alert exists (stock recovered)", () => {
    const r = detectLowStock({
      current: STOCKED,
      itemThreshold: null,
      tenantDefaultThreshold: 10,
      hasOpenAlert: true,
    })
    expect(r.kind).toBe("shouldResolve")
  })

  it("per-item threshold overrides tenant default", () => {
    // Item threshold = 100; available (LOW)=5 → 5 <= 100 → should emit.
    const r = detectLowStock({
      current: LOW,
      itemThreshold: 100,
      tenantDefaultThreshold: 1,
      hasOpenAlert: false,
    })
    expect(r.kind).toBe("shouldEmit")
    if (r.kind === "shouldEmit") expect(r.effectiveThreshold).toBe(100)
  })

  it("per-item threshold = 0 (zero override, NOT null) honoured", () => {
    // available (EMPTY) = 0 <= 0 → should emit.
    const r = detectLowStock({
      current: EMPTY,
      itemThreshold: 0,
      tenantDefaultThreshold: 10,
      hasOpenAlert: false,
    })
    expect(r.kind).toBe("shouldEmit")
    if (r.kind === "shouldEmit") expect(r.effectiveThreshold).toBe(0)
  })

  it("threshold exactly equal to available counts as below (<=)", () => {
    const r = detectLowStock({
      current: LOW, // avail=5
      itemThreshold: 5,
      tenantDefaultThreshold: 0,
      hasOpenAlert: false,
    })
    expect(r.kind).toBe("shouldEmit")
  })

  it("returns 'corrupted' (distinct discriminant) for corrupted current row — cron MUST escalate via separate channel", () => {
    // Architect P2 closure: returning generic "none" would silently hide
    // both the corruption AND the low-stock signal. The distinct
    // discriminant forces the cron to branch and route to corruption-
    // monitor instead of treating it as an "all clear".
    const r = detectLowStock({
      current: { quantityOnHand: 5, quantityReserved: 10 }, // corrupted
      itemThreshold: null,
      tenantDefaultThreshold: 1,
      hasOpenAlert: false,
    })
    expect(r.kind).toBe("corrupted")
    if (r.kind === "corrupted") expect(r.reason).toMatch(/corruption-monitor escalation/i)
  })

  it("returns 'corrupted' even when an open alert exists (corruption takes priority)", () => {
    // A row that is BOTH below threshold AND corrupted should report
    // corruption — not "no re-fire". Open-alert state is irrelevant
    // when the underlying data is bad.
    const r = detectLowStock({
      current: { quantityOnHand: 5, quantityReserved: 10 },
      itemThreshold: null,
      tenantDefaultThreshold: 1,
      hasOpenAlert: true,
    })
    expect(r.kind).toBe("corrupted")
  })

  it("returns 'misconfigured' on invalid threshold (negative, NaN, non-integer) — admin-config-monitor escalation", () => {
    // Same silent-hide concern as the corrupted-row path — a negative
    // / NaN / non-integer threshold is a tenant-config integrity issue,
    // not a "stock fine, no alert needed" condition. Distinct
    // discriminant forces the cron to route to admin-config-monitor.
    for (const itemThreshold of [-1, Number.NaN, 1.5]) {
      const r = detectLowStock({
        current: LOW,
        itemThreshold,
        tenantDefaultThreshold: 10,
        hasOpenAlert: false,
      })
      expect(r.kind).toBe("misconfigured")
      if (r.kind === "misconfigured") expect(r.reason).toMatch(/admin-config-monitor escalation/i)
    }
  })

  it("returns 'misconfigured' even with open alert (config integrity takes priority)", () => {
    const r = detectLowStock({
      current: LOW,
      itemThreshold: -5,
      tenantDefaultThreshold: 10,
      hasOpenAlert: true,
    })
    expect(r.kind).toBe("misconfigured")
  })

  it("returns 'misconfigured' on bad tenant default (item override null + tenant value invalid)", () => {
    // Tenant misconfiguration also triggers — not just item-level overrides.
    const r = detectLowStock({
      current: LOW,
      itemThreshold: null,
      tenantDefaultThreshold: -10,
      hasOpenAlert: false,
    })
    expect(r.kind).toBe("misconfigured")
  })
})

/* ─── End-to-end sequence guard ───────────────────────────────────────── */

describe("D7 — reserve → release sequence", () => {
  it("net-zero (reserve N then release N) returns to original quantities", () => {
    const start: InventoryQuantities = { quantityOnHand: 50, quantityReserved: 10 }
    const r1 = reserveStock({ current: start, units: 7 })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = releaseStock({ current: r1.next, units: 7 })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.next).toEqual(start)
    // Audit-row deltas should cancel out: -7 + 7 = 0.
    expect(r1.quantityDelta + r2.quantityDelta).toBe(0)
  })
})

/* ─── Type-tuple completeness ─────────────────────────────────────────── */

describe("D7 — type registry completeness", () => {
  it("MOVEMENT_TYPE_RULES has a rule for every STOCK_MOVEMENT_TYPES entry", () => {
    for (const t of STOCK_MOVEMENT_TYPES) {
      expect(MOVEMENT_TYPE_RULES[t as StockMovementType]).toBeDefined()
    }
  })

  it("MOVEMENT_TYPE_RULES has NO extra keys beyond STOCK_MOVEMENT_TYPES (drift guard)", () => {
    expect(Object.keys(MOVEMENT_TYPE_RULES).sort()).toEqual(
      [...STOCK_MOVEMENT_TYPES].sort()
    )
  })
})
