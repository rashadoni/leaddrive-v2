/**
 * Tests for R6 Energy & Utilities Cloud slice 1 — 4 pure helpers + types.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import {
  allowedNextCustomer,
  allowedNextMeter,
  allowedNextOutage,
  canTransitionOutage,
  allowedNextServiceCall,
  isCustomerTerminal,
  isMeterTerminal,
  isOutageTerminal,
  isServiceCallTerminal,
  transitionCustomer,
  transitionMeter,
  transitionOutage,
  transitionServiceCall,
} from "@/lib/energy-utilities/state-machine"
import { validateMeterReading } from "@/lib/energy-utilities/meter-reading-validator"
import { calculateOutageImpact } from "@/lib/energy-utilities/outage-impact-calculator"
import {
  __ROUTER_INTERNALS,
  routeServiceCall,
} from "@/lib/energy-utilities/service-call-router"
import {
  COMMODITY_TYPES,
  CUSTOMER_CLASSES,
  CUSTOMER_STATUSES,
  CUSTOMER_TRANSITIONS,
  METER_STATUSES,
  METER_TRANSITIONS,
  OUTAGE_CAUSES,
  OUTAGE_SEVERITIES,
  OUTAGE_STATUSES,
  OUTAGE_TRANSITIONS,
  READING_QUALITIES,
  READING_SOURCES,
  SERVICE_CALL_PRIORITIES,
  SERVICE_CALL_STATUSES,
  SERVICE_CALL_TRANSITIONS,
  SERVICE_CALL_TYPES,
  type CustomerStatus,
  type MeterStatus,
  type OutageStatus,
  type ServiceCallStatus,
} from "@/lib/energy-utilities/types"

/* ─── Drift guards — enum cardinality ────────────────────────────────── */

describe("R6 — enum drift guards", () => {
  it("customer classes cardinality is 6", () => {
    expect(CUSTOMER_CLASSES).toHaveLength(6)
    expect(new Set(CUSTOMER_CLASSES).size).toBe(6)
  })

  it("customer statuses cardinality is 4", () => {
    expect(CUSTOMER_STATUSES).toHaveLength(4)
  })

  it("commodity types cardinality is 5", () => {
    expect(COMMODITY_TYPES).toHaveLength(5)
  })

  it("meter statuses cardinality is 4", () => {
    expect(METER_STATUSES).toHaveLength(4)
  })

  it("reading sources cardinality is 6 (slice-2: + meter_replacement)", () => {
    expect(READING_SOURCES).toHaveLength(6)
  })

  it("reading qualities cardinality is 3", () => {
    expect(READING_QUALITIES).toHaveLength(3)
  })

  it("outage causes cardinality is 6", () => {
    expect(OUTAGE_CAUSES).toHaveLength(6)
  })

  it("outage severities cardinality is 4", () => {
    expect(OUTAGE_SEVERITIES).toHaveLength(4)
  })

  it("outage statuses cardinality is 4", () => {
    expect(OUTAGE_STATUSES).toHaveLength(4)
  })

  it("service call types cardinality is 9", () => {
    expect(SERVICE_CALL_TYPES).toHaveLength(9)
  })

  it("service call priorities cardinality is 4", () => {
    expect(SERVICE_CALL_PRIORITIES).toHaveLength(4)
  })

  it("service call statuses cardinality is 5", () => {
    expect(SERVICE_CALL_STATUSES).toHaveLength(5)
  })

  it("every customer transition target is itself a valid status", () => {
    for (const s of CUSTOMER_STATUSES) {
      for (const t of CUSTOMER_TRANSITIONS[s]) {
        expect(CUSTOMER_STATUSES).toContain(t)
      }
    }
  })

  it("every meter transition target is itself a valid status", () => {
    for (const s of METER_STATUSES) {
      for (const t of METER_TRANSITIONS[s]) {
        expect(METER_STATUSES).toContain(t)
      }
    }
  })

  it("every outage transition target is itself a valid status", () => {
    for (const s of OUTAGE_STATUSES) {
      for (const t of OUTAGE_TRANSITIONS[s]) {
        expect(OUTAGE_STATUSES).toContain(t)
      }
    }
  })

  it("every service call transition target is itself a valid status", () => {
    for (const s of SERVICE_CALL_STATUSES) {
      for (const t of SERVICE_CALL_TRANSITIONS[s]) {
        expect(SERVICE_CALL_STATUSES).toContain(t)
      }
    }
  })
})

/* ─── Customer state machine ─────────────────────────────────────────── */

describe("R6 — customer state machine", () => {
  it("prospect → active legal", () => {
    expect(transitionCustomer("prospect", "active").ok).toBe(true)
  })

  it("active → suspended → active round-trip legal", () => {
    expect(transitionCustomer("active", "suspended").ok).toBe(true)
    expect(transitionCustomer("suspended", "active").ok).toBe(true)
  })

  it("terminated is terminal", () => {
    for (const t of CUSTOMER_STATUSES) {
      if (t === "terminated") continue
      expect(transitionCustomer("terminated", t).ok).toBe(false)
    }
    expect(isCustomerTerminal("terminated")).toBe(true)
  })

  it("no-op rejected", () => {
    expect(transitionCustomer("active", "active").ok).toBe(false)
  })

  it("unknown statuses rejected", () => {
    expect(transitionCustomer("xx" as CustomerStatus, "active").ok).toBe(false)
    expect(transitionCustomer("active", "yy" as CustomerStatus).ok).toBe(false)
    expect(transitionCustomer(null, "active").ok).toBe(false)
  })

  it("prospect can short-circuit to terminated (operator cancellation)", () => {
    expect(transitionCustomer("prospect", "terminated").ok).toBe(true)
  })

  it("active → prospect rejected (no demotion)", () => {
    expect(transitionCustomer("active", "prospect").ok).toBe(false)
  })

  it("allowedNextCustomer surfaces table", () => {
    expect([...allowedNextCustomer("active")]).toEqual([
      "suspended",
      "terminated",
    ])
    expect([...allowedNextCustomer("terminated")]).toEqual([])
  })
})

/* ─── Meter state machine ────────────────────────────────────────────── */

describe("R6 — meter state machine", () => {
  it("pending_install → active legal", () => {
    expect(transitionMeter("pending_install", "active").ok).toBe(true)
  })

  it("active → disconnected → active (reconnection) legal", () => {
    expect(transitionMeter("active", "disconnected").ok).toBe(true)
    expect(transitionMeter("disconnected", "active").ok).toBe(true)
  })

  it("retired is terminal", () => {
    expect(isMeterTerminal("retired")).toBe(true)
    for (const t of METER_STATUSES) {
      if (t === "retired") continue
      expect(transitionMeter("retired", t).ok).toBe(false)
    }
  })

  it("pending_install → retired legal (cancelled install)", () => {
    expect(transitionMeter("pending_install", "retired").ok).toBe(true)
  })

  it("pending_install → disconnected rejected (skip active)", () => {
    expect(transitionMeter("pending_install", "disconnected").ok).toBe(false)
  })

  it("disconnected → retired legal", () => {
    expect(transitionMeter("disconnected", "retired").ok).toBe(true)
  })
})

/* ─── Outage state machine ───────────────────────────────────────────── */

describe("R6 — outage state machine", () => {
  it("pending → active legal", () => {
    expect(transitionOutage("pending", "active").ok).toBe(true)
  })

  it("active → resolved legal", () => {
    expect(transitionOutage("active", "resolved").ok).toBe(true)
  })

  it("active → cancelled rejected (must resolve)", () => {
    // Once an outage is active, you can only resolve it. Cancel is for
    // planned outages that haven't started.
    expect(transitionOutage("active", "cancelled").ok).toBe(false)
  })

  it("pending → cancelled legal", () => {
    expect(transitionOutage("pending", "cancelled").ok).toBe(true)
  })

  it("resolved + cancelled terminal", () => {
    expect(isOutageTerminal("resolved")).toBe(true)
    expect(isOutageTerminal("cancelled")).toBe(true)
  })

  it("active → pending rejected (no demotion)", () => {
    expect(transitionOutage("active", "pending").ok).toBe(false)
  })

  it("allowedNextOutage surfaces table", () => {
    expect([...allowedNextOutage("pending")]).toEqual(["active", "cancelled"])
    expect([...allowedNextOutage("active")]).toEqual(["resolved"])
    expect([...allowedNextOutage("resolved")]).toEqual([])
  })

  it("DOCUMENTED slice-1 split: pending → cancelled accepted by helper, even though DB CHECK requires scheduledStartAt", () => {
    // Pin the documented behavior in transitionOutage's JSDoc:
    // the state machine is pure (legal-transition only); the DB
    // outages_cancelled_coherence_check enforces scheduledStartAt
    // separately. Slice-2 wraps with canTransitionOutage (below).
    expect(transitionOutage("pending", "cancelled").ok).toBe(true)
  })
})

/* ─── Context-aware outage transition (slice-2 wrapper) ─────────────── */

describe("R6 — canTransitionOutage (slice-2 context-aware wrapper)", () => {
  it("planned outage: pending → cancelled allowed (scheduledStartAt set)", () => {
    const r = canTransitionOutage("pending", "cancelled", {
      scheduledStartAt: new Date("2026-06-01T22:00:00Z"),
    })
    expect(r.ok).toBe(true)
  })

  it("unplanned outage: pending → cancelled REJECTED (no scheduledStartAt)", () => {
    // The whole point of the wrapper: equipment_failure outage has
    // no scheduledStartAt, so cancellation is operator-error.
    const r = canTransitionOutage("pending", "cancelled", {
      scheduledStartAt: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("Unplanned outages cannot be cancelled")
    }
  })

  it("non-cancel transitions ignore scheduledStartAt context", () => {
    // pending → active for an unplanned outage (the normal path)
    // must succeed regardless of scheduledStartAt being null.
    const r = canTransitionOutage("pending", "active", {
      scheduledStartAt: null,
    })
    expect(r.ok).toBe(true)
  })

  it("illegal transition still rejected (active → cancelled is illegal regardless of context)", () => {
    // Once active, an outage is RESOLVED — cancellation is illegal
    // per the slice-1 state machine, and the wrapper short-circuits
    // on that before checking context.
    const r = canTransitionOutage("active", "cancelled", {
      scheduledStartAt: new Date("2026-06-01T22:00:00Z"),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // Pure state-machine error, NOT the context error.
      expect(r.error).toContain("illegal outage transition")
    }
  })
})

/* ─── Service call state machine ─────────────────────────────────────── */

describe("R6 — service call state machine", () => {
  it("received → dispatched → in_progress → resolved happy path", () => {
    expect(transitionServiceCall("received", "dispatched").ok).toBe(true)
    expect(transitionServiceCall("dispatched", "in_progress").ok).toBe(true)
    expect(transitionServiceCall("in_progress", "resolved").ok).toBe(true)
  })

  it("can cancel from any non-terminal state", () => {
    expect(transitionServiceCall("received", "cancelled").ok).toBe(true)
    expect(transitionServiceCall("dispatched", "cancelled").ok).toBe(true)
    expect(transitionServiceCall("in_progress", "cancelled").ok).toBe(true)
  })

  it("cannot skip dispatched (received → in_progress blocked)", () => {
    expect(transitionServiceCall("received", "in_progress").ok).toBe(false)
  })

  it("cannot re-resolve from cancelled", () => {
    expect(transitionServiceCall("cancelled", "resolved").ok).toBe(false)
  })

  it("resolved + cancelled terminal", () => {
    expect(isServiceCallTerminal("resolved")).toBe(true)
    expect(isServiceCallTerminal("cancelled")).toBe(true)
  })

  it("allowedNextServiceCall surfaces full table", () => {
    expect([...allowedNextServiceCall("dispatched")]).toEqual([
      "in_progress",
      "cancelled",
    ])
  })

  it("non-string state rejected", () => {
    expect(transitionServiceCall(42, "dispatched").ok).toBe(false)
  })
})

/* ─── Meter reading validator ────────────────────────────────────────── */

describe("R6 — meter reading validator", () => {
  const baseValid = {
    source: "ami" as const,
    quality: "raw" as const,
    readingAt: new Date("2026-05-15T10:00:00Z"),
    cumulativeValue: 1500.5,
    unit: "kWh",
    prior: null,
  }

  it("happy path — first reading (no prior)", () => {
    expect(validateMeterReading(baseValid)).toEqual({ ok: true })
  })

  it("happy path — subsequent reading with consistent unit", () => {
    expect(
      validateMeterReading({
        ...baseValid,
        readingAt: new Date("2026-05-16T10:00:00Z"),
        cumulativeValue: 1525.75,
        prior: {
          readingAt: new Date("2026-05-15T10:00:00Z"),
          cumulativeValue: 1500.5,
          unit: "kWh",
        },
      })
    ).toEqual({ ok: true })
  })

  it("rejects counter rollback without correction", () => {
    const r = validateMeterReading({
      ...baseValid,
      readingAt: new Date("2026-05-16T10:00:00Z"),
      cumulativeValue: 1400.0, // less than prior
      prior: {
        readingAt: new Date("2026-05-15T10:00:00Z"),
        cumulativeValue: 1500.5,
        unit: "kWh",
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("cumulativeValue")
  })

  it("allows counter rollback with source=corrected + supersedesReadingId", () => {
    const r = validateMeterReading({
      ...baseValid,
      source: "corrected",
      supersedesReadingId: "read-123",
      readingAt: new Date("2026-05-16T10:00:00Z"),
      cumulativeValue: 1400.0,
      prior: {
        readingAt: new Date("2026-05-15T10:00:00Z"),
        cumulativeValue: 1500.5,
        unit: "kWh",
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects source=corrected without supersedesReadingId", () => {
    const r = validateMeterReading({
      ...baseValid,
      source: "corrected",
      cumulativeValue: 1400.0,
      prior: {
        readingAt: new Date("2026-05-15T10:00:00Z"),
        cumulativeValue: 1500.5,
        unit: "kWh",
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("supersedesReadingId")
  })

  // ── Slice-2 meter_replacement source ──────────────────────────

  it("allows counter rollback with source=meter_replacement (no supersedes link)", () => {
    // New physical meter installed; counter resets to 0 even though
    // prior meter read 1500.5. No supersedesReadingId required.
    const r = validateMeterReading({
      ...baseValid,
      source: "meter_replacement",
      cumulativeValue: 0,
      readingAt: new Date("2026-05-16T10:00:00Z"),
      prior: {
        readingAt: new Date("2026-05-15T10:00:00Z"),
        cumulativeValue: 1500.5,
        unit: "kWh",
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects source=meter_replacement WITH supersedesReadingId (wrong semantic)", () => {
    // meter_replacement is "new meter, fresh series" — not "this row
    // supersedes that one". Mixing the two would corrupt audit trail.
    const r = validateMeterReading({
      ...baseValid,
      source: "meter_replacement",
      supersedesReadingId: "read-old-meter-final",
      cumulativeValue: 0,
      readingAt: new Date("2026-05-16T10:00:00Z"),
      prior: {
        readingAt: new Date("2026-05-15T10:00:00Z"),
        cumulativeValue: 1500.5,
        unit: "kWh",
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("supersedesReadingId")
  })

  it("meter_replacement skips intervalValue coherence check", () => {
    // intervalValue against old-meter cumulative is nonsensical.
    // Caller may supply intervalValue (e.g. consumption on the new
    // meter since installation, against the NEW meter's start point);
    // the validator skips the cross-meter math check entirely.
    const r = validateMeterReading({
      ...baseValid,
      source: "meter_replacement",
      cumulativeValue: 0,
      intervalValue: 0,
      readingAt: new Date("2026-05-16T10:00:00Z"),
      prior: {
        readingAt: new Date("2026-05-15T10:00:00Z"),
        cumulativeValue: 1500.5,
        unit: "kWh",
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects readingAt <= prior.readingAt (time monotonicity)", () => {
    const r = validateMeterReading({
      ...baseValid,
      readingAt: new Date("2026-05-15T10:00:00Z"),
      prior: {
        readingAt: new Date("2026-05-15T10:00:00Z"),
        cumulativeValue: 1500.0,
        unit: "kWh",
      },
      cumulativeValue: 1501,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("readingAt")
  })

  it("rejects unit mismatch with prior", () => {
    const r = validateMeterReading({
      ...baseValid,
      readingAt: new Date("2026-05-16T10:00:00Z"),
      unit: "m3", // wrong: prior was kWh
      cumulativeValue: 1525,
      prior: {
        readingAt: new Date("2026-05-15T10:00:00Z"),
        cumulativeValue: 1500,
        unit: "kWh",
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("unit")
  })

  it("rejects unknown source", () => {
    const r = validateMeterReading({
      ...baseValid,
      source: "satellite" as never,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("source")
  })

  it("rejects unknown quality", () => {
    const r = validateMeterReading({
      ...baseValid,
      quality: "perfect" as never,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("quality")
  })

  it("rejects negative cumulativeValue", () => {
    const r = validateMeterReading({ ...baseValid, cumulativeValue: -10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("cumulativeValue")
  })

  it("rejects empty unit string", () => {
    const r = validateMeterReading({ ...baseValid, unit: "" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("unit")
  })

  it("rejects unit longer than 16 chars (matches DB CHECK)", () => {
    const r = validateMeterReading({
      ...baseValid,
      unit: "very-long-unit-name-here",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("unit")
  })

  it("rejects non-finite readingAt", () => {
    const r = validateMeterReading({
      ...baseValid,
      readingAt: new Date("invalid"),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("readingAt")
  })

  it("rejects non-finite cumulative", () => {
    const r = validateMeterReading({ ...baseValid, cumulativeValue: Infinity })
    expect(r.ok).toBe(false)
  })

  it("validates intervalValue against (cumulative - prior.cumulative)", () => {
    const r = validateMeterReading({
      ...baseValid,
      readingAt: new Date("2026-05-16T10:00:00Z"),
      cumulativeValue: 1525.5,
      intervalValue: 25.0,
      prior: {
        readingAt: new Date("2026-05-15T10:00:00Z"),
        cumulativeValue: 1500.5,
        unit: "kWh",
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects intervalValue mismatch outside tolerance", () => {
    const r = validateMeterReading({
      ...baseValid,
      readingAt: new Date("2026-05-16T10:00:00Z"),
      cumulativeValue: 1525.5,
      intervalValue: 99.0, // wrong — expected 25.0
      prior: {
        readingAt: new Date("2026-05-15T10:00:00Z"),
        cumulativeValue: 1500.5,
        unit: "kWh",
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("intervalValue")
  })

  it("accepts intervalValue within tolerance (floating-point noise)", () => {
    const r = validateMeterReading({
      ...baseValid,
      readingAt: new Date("2026-05-16T10:00:00Z"),
      cumulativeValue: 1525.5001,
      intervalValue: 25.0,
      intervalTolerance: 0.001,
      prior: {
        readingAt: new Date("2026-05-15T10:00:00Z"),
        cumulativeValue: 1500.5,
        unit: "kWh",
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects non-finite intervalValue", () => {
    const r = validateMeterReading({ ...baseValid, intervalValue: Number.NaN })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("intervalValue")
  })
})

/* ─── Outage impact calculator ───────────────────────────────────────── */

describe("R6 — outage impact calculator", () => {
  it("bulk window — 60min × 100 meters = 6000 CMI", () => {
    const r = calculateOutageImpact({
      actualStartAt: new Date("2026-05-15T10:00:00Z"),
      actualEndAt: new Date("2026-05-15T11:00:00Z"),
      affectedMeterCount: 100,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.outageDurationMinutes).toBe(60)
      expect(r.summary.customerMinutesInterrupted).toBe(6000)
      expect(r.summary.averagePerMeterMinutes).toBe(60)
    }
  })

  it("partial restoration — some meters restored early", () => {
    // 60min total window; 3 of 5 meters restored at 30min mark.
    // 3 × 30 + 2 × 60 = 210 CMI
    const r = calculateOutageImpact({
      actualStartAt: new Date("2026-05-15T10:00:00Z"),
      actualEndAt: new Date("2026-05-15T11:00:00Z"),
      affectedMeterCount: 5,
      perMeterRestorations: [
        { restoredAt: new Date("2026-05-15T10:30:00Z") },
        { restoredAt: new Date("2026-05-15T10:30:00Z") },
        { restoredAt: new Date("2026-05-15T10:30:00Z") },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.customerMinutesInterrupted).toBe(210)
      expect(r.summary.averagePerMeterMinutes).toBe(42)
    }
  })

  it("zero meters affected — CMI 0, average 0 (avoid NaN)", () => {
    const r = calculateOutageImpact({
      actualStartAt: new Date("2026-05-15T10:00:00Z"),
      actualEndAt: new Date("2026-05-15T11:00:00Z"),
      affectedMeterCount: 0,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.customerMinutesInterrupted).toBe(0)
      expect(r.summary.averagePerMeterMinutes).toBe(0)
    }
  })

  it("rejects actualEnd ≤ actualStart", () => {
    const r = calculateOutageImpact({
      actualStartAt: new Date("2026-05-15T10:00:00Z"),
      actualEndAt: new Date("2026-05-15T10:00:00Z"),
      affectedMeterCount: 1,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-finite Date", () => {
    const r = calculateOutageImpact({
      actualStartAt: new Date("invalid"),
      actualEndAt: new Date("2026-05-15T11:00:00Z"),
      affectedMeterCount: 1,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative affectedMeterCount", () => {
    const r = calculateOutageImpact({
      actualStartAt: new Date("2026-05-15T10:00:00Z"),
      actualEndAt: new Date("2026-05-15T11:00:00Z"),
      affectedMeterCount: -1,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-integer affectedMeterCount", () => {
    const r = calculateOutageImpact({
      actualStartAt: new Date("2026-05-15T10:00:00Z"),
      actualEndAt: new Date("2026-05-15T11:00:00Z"),
      affectedMeterCount: 1.5,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects perMeterRestorations.length > affectedMeterCount", () => {
    const r = calculateOutageImpact({
      actualStartAt: new Date("2026-05-15T10:00:00Z"),
      actualEndAt: new Date("2026-05-15T11:00:00Z"),
      affectedMeterCount: 2,
      perMeterRestorations: [
        { restoredAt: new Date("2026-05-15T10:30:00Z") },
        { restoredAt: new Date("2026-05-15T10:30:00Z") },
        { restoredAt: new Date("2026-05-15T10:30:00Z") },
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects restoredAt before actualStartAt", () => {
    const r = calculateOutageImpact({
      actualStartAt: new Date("2026-05-15T10:00:00Z"),
      actualEndAt: new Date("2026-05-15T11:00:00Z"),
      affectedMeterCount: 1,
      perMeterRestorations: [
        { restoredAt: new Date("2026-05-15T09:30:00Z") },
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects restoredAt after actualEndAt", () => {
    const r = calculateOutageImpact({
      actualStartAt: new Date("2026-05-15T10:00:00Z"),
      actualEndAt: new Date("2026-05-15T11:00:00Z"),
      affectedMeterCount: 1,
      perMeterRestorations: [
        { restoredAt: new Date("2026-05-15T12:00:00Z") },
      ],
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── Service call router ────────────────────────────────────────────── */

describe("R6 — service call router", () => {
  it("outage_report → outages queue, baseline urgent", () => {
    const r = routeServiceCall({ callType: "outage_report" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.queueSlug).toBe("outages")
      expect(r.route.suggestedPriority).toBe("urgent")
    }
  })

  it("outage_report with critical severity → emergency", () => {
    const r = routeServiceCall({
      callType: "outage_report",
      outageSeverity: "critical",
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.suggestedPriority).toBe("emergency")
    }
  })

  it("outage_report with minor severity does NOT downgrade urgent baseline", () => {
    const r = routeServiceCall({
      callType: "outage_report",
      outageSeverity: "minor",
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // baseline urgent (rank 2) > minor->routine (rank 0), so urgent wins
      expect(r.route.suggestedPriority).toBe("urgent")
    }
  })

  it("billing_dispute → billing queue, routine", () => {
    const r = routeServiceCall({ callType: "billing_dispute" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.queueSlug).toBe("billing")
      expect(r.route.suggestedPriority).toBe("routine")
    }
  })

  it("new_connection → connections queue", () => {
    const r = routeServiceCall({ callType: "new_connection" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.route.queueSlug).toBe("connections")
  })

  it("meter_inspection → field-service queue", () => {
    const r = routeServiceCall({ callType: "meter_inspection" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.route.queueSlug).toBe("field-service")
  })

  it("priorityOverride wins over base + severity bump", () => {
    const r = routeServiceCall({
      callType: "outage_report",
      outageSeverity: "critical",
      priorityOverride: "routine", // operator dismisses severity bump
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.route.suggestedPriority).toBe("routine")
  })

  it("rejects unknown callType", () => {
    const r = routeServiceCall({ callType: "alien_visit" as never })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown priorityOverride", () => {
    const r = routeServiceCall({
      callType: "billing_dispute",
      priorityOverride: "supreme" as never,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown outageSeverity", () => {
    const r = routeServiceCall({
      callType: "outage_report",
      outageSeverity: "armageddon" as never,
    })
    expect(r.ok).toBe(false)
  })

  it("ROUTING_TABLE pins every callType", () => {
    for (const t of SERVICE_CALL_TYPES) {
      expect(__ROUTER_INTERNALS.ROUTING_TABLE[t]).toBeDefined()
      const entry = __ROUTER_INTERNALS.ROUTING_TABLE[t]
      expect(entry.queueSlug.length).toBeGreaterThan(0)
      expect(SERVICE_CALL_PRIORITIES).toContain(entry.basePriority)
    }
  })

  it("SEVERITY_TO_PRIORITY covers every outage severity", () => {
    for (const s of OUTAGE_SEVERITIES) {
      expect(__ROUTER_INTERNALS.SEVERITY_TO_PRIORITY[s]).toBeDefined()
    }
  })

  it("PRIORITY_RANK strictly ordered", () => {
    const ranks = SERVICE_CALL_PRIORITIES.map(
      (p) => __ROUTER_INTERNALS.PRIORITY_RANK[p]
    )
    // All distinct
    expect(new Set(ranks).size).toBe(ranks.length)
    // emergency > urgent > elevated > routine
    expect(__ROUTER_INTERNALS.PRIORITY_RANK.emergency).toBeGreaterThan(
      __ROUTER_INTERNALS.PRIORITY_RANK.urgent
    )
    expect(__ROUTER_INTERNALS.PRIORITY_RANK.urgent).toBeGreaterThan(
      __ROUTER_INTERNALS.PRIORITY_RANK.elevated
    )
    expect(__ROUTER_INTERNALS.PRIORITY_RANK.elevated).toBeGreaterThan(
      __ROUTER_INTERNALS.PRIORITY_RANK.routine
    )
  })
})

/* ─── Cross-cutting: status union types are exhaustive (catch-all) ───── */

describe("R6 — terminal-set drift", () => {
  it("terminal set for customer: { terminated }", () => {
    const terminals = CUSTOMER_STATUSES.filter((s) => isCustomerTerminal(s))
    expect([...terminals].sort()).toEqual(["terminated"])
  })

  it("terminal set for meter: { retired }", () => {
    const terminals = METER_STATUSES.filter((s) => isMeterTerminal(s))
    expect([...terminals].sort()).toEqual(["retired"])
  })

  it("terminal set for outage: { cancelled, resolved }", () => {
    const terminals = OUTAGE_STATUSES.filter((s) => isOutageTerminal(s))
    expect([...terminals].sort()).toEqual(["cancelled", "resolved"])
  })

  it("terminal set for service call: { cancelled, resolved }", () => {
    const terminals = SERVICE_CALL_STATUSES.filter((s) =>
      isServiceCallTerminal(s)
    )
    expect([...terminals].sort()).toEqual(["cancelled", "resolved"])
  })

  it("non-terminal states cardinality matches expectation", () => {
    expect(
      CUSTOMER_STATUSES.filter((s) => !isCustomerTerminal(s)).length
    ).toBe(3)
    expect(METER_STATUSES.filter((s) => !isMeterTerminal(s)).length).toBe(3)
    expect(OUTAGE_STATUSES.filter((s) => !isOutageTerminal(s)).length).toBe(2)
    expect(
      SERVICE_CALL_STATUSES.filter((s) => !isServiceCallTerminal(s)).length
    ).toBe(3)
  })

  it("allowedNextMeter for retired = []", () => {
    expect([...allowedNextMeter("retired" as MeterStatus)]).toEqual([])
  })

  it("allowedNextOutage table introspection", () => {
    expect([...allowedNextOutage("active" as OutageStatus)]).toEqual([
      "resolved",
    ])
  })

  it("allowedNextServiceCall for resolved = []", () => {
    expect(
      [...allowedNextServiceCall("resolved" as ServiceCallStatus)]
    ).toEqual([])
  })
})
