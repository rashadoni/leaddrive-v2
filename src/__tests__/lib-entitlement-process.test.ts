/**
 * Tests for B10 Entitlement Process slice 1 — 4 pure helpers + types.
 * No DB; all helpers are pure functions.
 */
import { describe, expect, it } from "vitest"

import {
  calculateMilestoneDue,
  pickMostSpecificDefinition,
} from "@/lib/entitlement-process/milestone-due-calculator"
import {
  canTransitionMilestoneStatus,
  evaluateMilestoneStatus,
  isMilestoneStatus,
} from "@/lib/entitlement-process/milestone-status-evaluator"
import {
  canTransitionEntitlementStatus,
  isEntitlementHonored,
  isEntitlementStatus,
  isSupportLevel,
  shouldAutoExpire,
} from "@/lib/entitlement-process/entitlement-lifecycle"
import {
  isMilestoneType,
  isSeverityTier,
  planEscalation,
  summarizeEscalation,
} from "@/lib/entitlement-process/escalation-planner"
import {
  AUDIT_EVENT_TYPES,
  DEFAULT_ESCALATION_LADDER,
  DEFAULT_MILESTONE_DUE_SECONDS,
  ENTITLEMENT_STATUSES,
  ENTITLEMENT_STATUS_TRANSITIONS,
  MILESTONE_STATUSES,
  MILESTONE_STATUS_TRANSITIONS,
  MILESTONE_TYPES,
  SEVERITY_DUE_MULTIPLIERS,
  SEVERITY_TIERS,
  SUPPORT_LEVELS,
  SUPPORT_LEVEL_MULTIPLIERS,
  type EscalationLevelConfig,
  type MilestoneDefinitionInput,
} from "@/lib/entitlement-process/types"
import {
  ENTITLEMENT_MILESTONE_TEMPLATES,
  assertNoDuplicateMilestoneDefinitions,
  dueWindowToSeconds,
  milestoneDefinitionKey,
  secondsToDueWindow,
} from "@/lib/entitlement-process/milestone-definitions"
import {
  selectRuntimeMilestoneDefinitions,
  ticketPriorityToSeverity,
} from "@/lib/entitlement-process/ticket-milestones"

/* ─── Enum + transition-map exhaustiveness ─────────────────────────────── */

describe("B10 — enum + transition-map exhaustiveness", () => {
  it("ENTITLEMENT_STATUS_TRANSITIONS covers all statuses", () => {
    expect(Object.keys(ENTITLEMENT_STATUS_TRANSITIONS).sort()).toEqual(
      [...ENTITLEMENT_STATUSES].sort(),
    )
  })
  it("MILESTONE_STATUS_TRANSITIONS covers all statuses", () => {
    expect(Object.keys(MILESTONE_STATUS_TRANSITIONS).sort()).toEqual(
      [...MILESTONE_STATUSES].sort(),
    )
  })
  it("every entitlement transition target is known", () => {
    for (const t of Object.values(ENTITLEMENT_STATUS_TRANSITIONS).flat()) {
      expect(ENTITLEMENT_STATUSES).toContain(t)
    }
  })
  it("every milestone transition target is known", () => {
    for (const t of Object.values(MILESTONE_STATUS_TRANSITIONS).flat()) {
      expect(MILESTONE_STATUSES).toContain(t)
    }
  })
  it("SUPPORT_LEVELS has 4 tiers in expected order", () => {
    expect(SUPPORT_LEVELS).toEqual(["basic", "standard", "premium", "enterprise"])
  })
  it("SEVERITY_TIERS has 4 levels", () => {
    expect(SEVERITY_TIERS).toEqual(["critical", "high", "normal", "low"])
  })
  it("MILESTONE_TYPES has 5 kinds", () => {
    expect(MILESTONE_TYPES).toEqual([
      "first_response",
      "problem_identified",
      "workaround_delivered",
      "resolution",
      "escalation",
    ])
  })
  it("AUDIT_EVENT_TYPES has 13 kinds", () => {
    expect(AUDIT_EVENT_TYPES.length).toBe(13)
    expect(AUDIT_EVENT_TYPES).toContain("entitlement_updated")
  })
  it("DEFAULT_ESCALATION_LADDER has 3 levels with ascending delays", () => {
    expect(DEFAULT_ESCALATION_LADDER.length).toBe(3)
    for (let i = 1; i < DEFAULT_ESCALATION_LADDER.length; i++) {
      expect(DEFAULT_ESCALATION_LADDER[i].delaySeconds).toBeGreaterThan(
        DEFAULT_ESCALATION_LADDER[i - 1].delaySeconds,
      )
    }
  })
  it("SEVERITY_DUE_MULTIPLIERS critical < high < normal < low", () => {
    expect(SEVERITY_DUE_MULTIPLIERS.critical).toBeLessThan(
      SEVERITY_DUE_MULTIPLIERS.high,
    )
    expect(SEVERITY_DUE_MULTIPLIERS.high).toBeLessThan(
      SEVERITY_DUE_MULTIPLIERS.normal,
    )
    expect(SEVERITY_DUE_MULTIPLIERS.normal).toBeLessThan(
      SEVERITY_DUE_MULTIPLIERS.low,
    )
  })
  it("SUPPORT_LEVEL_MULTIPLIERS basic > standard > premium > enterprise", () => {
    expect(SUPPORT_LEVEL_MULTIPLIERS.basic).toBeGreaterThan(
      SUPPORT_LEVEL_MULTIPLIERS.standard,
    )
    expect(SUPPORT_LEVEL_MULTIPLIERS.standard).toBeGreaterThan(
      SUPPORT_LEVEL_MULTIPLIERS.premium,
    )
    expect(SUPPORT_LEVEL_MULTIPLIERS.premium).toBeGreaterThan(
      SUPPORT_LEVEL_MULTIPLIERS.enterprise,
    )
  })
  it("DEFAULT_MILESTONE_DUE_SECONDS has entry per type", () => {
    for (const t of MILESTONE_TYPES) {
      expect(DEFAULT_MILESTONE_DUE_SECONDS[t]).toBeGreaterThan(0)
    }
  })
  it("entitlement milestone templates have unique type/severity keys", () => {
    for (const template of Object.values(ENTITLEMENT_MILESTONE_TEMPLATES)) {
      assertNoDuplicateMilestoneDefinitions(template.definitions)
      expect(template.definitions.length).toBeGreaterThan(0)
    }
    expect(ENTITLEMENT_MILESTONE_TEMPLATES.enterprise.definitions.length).toBeGreaterThan(
      ENTITLEMENT_MILESTONE_TEMPLATES.basic.definitions.length,
    )
  })
  it("milestone definition keys treat NULL severity as all severities", () => {
    expect(milestoneDefinitionKey("first_response", null)).toBe("first_response:all")
    expect(milestoneDefinitionKey("first_response", "critical")).toBe("first_response:critical")
  })
  it("due-window conversion is stable across units", () => {
    expect(dueWindowToSeconds(30, "minutes")).toBe(1800)
    expect(dueWindowToSeconds(2, "hours")).toBe(7200)
    expect(dueWindowToSeconds(3, "days")).toBe(259200)
    expect(secondsToDueWindow(259200)).toEqual({ value: 3, unit: "days" })
    expect(secondsToDueWindow(7200)).toEqual({ value: 2, unit: "hours" })
  })
})

/* ─── Type guards ──────────────────────────────────────────────────────── */

describe("B10 — type guards", () => {
  it("isEntitlementStatus", () => {
    expect(isEntitlementStatus("active")).toBe(true)
    expect(isEntitlementStatus("nope")).toBe(false)
  })
  it("isMilestoneStatus", () => {
    expect(isMilestoneStatus("in_progress")).toBe(true)
    expect(isMilestoneStatus("done")).toBe(false)
  })
  it("isSupportLevel", () => {
    expect(isSupportLevel("enterprise")).toBe(true)
    expect(isSupportLevel("free")).toBe(false)
  })
  it("isMilestoneType", () => {
    expect(isMilestoneType("first_response")).toBe(true)
    expect(isMilestoneType("ack")).toBe(false)
  })
  it("isSeverityTier", () => {
    expect(isSeverityTier("critical")).toBe(true)
    expect(isSeverityTier("urgent")).toBe(false)
  })
})

/* ─── Entitlement lifecycle state machine ──────────────────────────────── */

describe("B10 — entitlement state machine", () => {
  it("draft → active | cancelled", () => {
    expect(canTransitionEntitlementStatus("draft", "active")).toBe(true)
    expect(canTransitionEntitlementStatus("draft", "cancelled")).toBe(true)
    expect(canTransitionEntitlementStatus("draft", "expired")).toBe(false)
  })
  it("active → suspended | expired | cancelled", () => {
    expect(canTransitionEntitlementStatus("active", "suspended")).toBe(true)
    expect(canTransitionEntitlementStatus("active", "expired")).toBe(true)
    expect(canTransitionEntitlementStatus("active", "cancelled")).toBe(true)
    expect(canTransitionEntitlementStatus("active", "draft")).toBe(false)
  })
  it("suspended → active | expired | cancelled", () => {
    expect(canTransitionEntitlementStatus("suspended", "active")).toBe(true)
    expect(canTransitionEntitlementStatus("suspended", "expired")).toBe(true)
    expect(canTransitionEntitlementStatus("suspended", "cancelled")).toBe(true)
  })
  it("expired + cancelled are terminal", () => {
    expect(canTransitionEntitlementStatus("expired", "active")).toBe(false)
    expect(canTransitionEntitlementStatus("cancelled", "active")).toBe(false)
  })
  it("same-status no-op accepted", () => {
    expect(canTransitionEntitlementStatus("active", "active")).toBe(true)
  })
})

/* ─── Entitlement validity ─────────────────────────────────────────────── */

describe("B10 — isEntitlementHonored", () => {
  const validFrom = new Date("2026-01-01T00:00:00Z")
  const validTo = new Date("2026-12-31T23:59:59Z")
  const asOf = new Date("2026-05-20T12:00:00Z")

  it("active + in-window → honored", () => {
    const result = isEntitlementHonored({
      entitlement: { status: "active", validFrom, validTo },
      asOf,
    })
    expect(result.isHonored).toBe(true)
    expect(result.reason).toBe("honored")
    expect(result.secondsUntilExpiry).toBeGreaterThan(0)
  })

  it("active + open-ended (validTo NULL) → honored", () => {
    const result = isEntitlementHonored({
      entitlement: { status: "active", validFrom, validTo: null },
      asOf,
    })
    expect(result.isHonored).toBe(true)
    expect(result.secondsUntilExpiry).toBeNull()
  })

  it("active + before validFrom → not_yet_active", () => {
    const result = isEntitlementHonored({
      entitlement: { status: "active", validFrom, validTo },
      asOf: new Date("2025-12-15"),
    })
    expect(result.isHonored).toBe(false)
    expect(result.reason).toBe("not_yet_active")
  })

  it("active + past validTo → outside_validity_window", () => {
    const result = isEntitlementHonored({
      entitlement: { status: "active", validFrom, validTo },
      asOf: new Date("2027-02-01"),
    })
    expect(result.isHonored).toBe(false)
    expect(result.reason).toBe("outside_validity_window")
  })

  it("draft / suspended / cancelled / expired → not honored with correct reason", () => {
    for (const status of ["draft", "suspended", "cancelled", "expired"] as const) {
      const result = isEntitlementHonored({
        entitlement: { status, validFrom, validTo },
        asOf,
      })
      expect(result.isHonored).toBe(false)
      expect(result.reason).toBe(status)
      // Architect pass-1 fix: terminal statuses return null
      // secondsUntilExpiry (not negative seconds).
      expect(result.secondsUntilExpiry).toBeNull()
    }
  })

  it("active + outside_validity_window → null secondsUntilExpiry (not negative)", () => {
    const result = isEntitlementHonored({
      entitlement: { status: "active", validFrom, validTo },
      asOf: new Date("2027-02-01"), // past validTo
    })
    expect(result.reason).toBe("outside_validity_window")
    expect(result.secondsUntilExpiry).toBeNull()
  })

  it("active + not_yet_active → null secondsUntilExpiry", () => {
    const result = isEntitlementHonored({
      entitlement: { status: "active", validFrom, validTo },
      asOf: new Date("2025-12-15"),
    })
    expect(result.reason).toBe("not_yet_active")
    expect(result.secondsUntilExpiry).toBeNull()
  })

  it("at exactly validFrom → honored (inclusive)", () => {
    const result = isEntitlementHonored({
      entitlement: { status: "active", validFrom, validTo },
      asOf: validFrom,
    })
    expect(result.isHonored).toBe(true)
  })

  it("at exactly validTo → outside (exclusive)", () => {
    const result = isEntitlementHonored({
      entitlement: { status: "active", validFrom, validTo },
      asOf: validTo,
    })
    expect(result.isHonored).toBe(false)
    expect(result.reason).toBe("outside_validity_window")
  })
})

describe("B10 — shouldAutoExpire", () => {
  const asOf = new Date("2026-05-20T12:00:00Z")
  it("active + validTo in past → expire", () => {
    expect(
      shouldAutoExpire(
        { status: "active", validTo: new Date("2026-01-01") },
        asOf,
      ),
    ).toBe(true)
  })
  it("active + validTo in future → no", () => {
    expect(
      shouldAutoExpire(
        { status: "active", validTo: new Date("2027-01-01") },
        asOf,
      ),
    ).toBe(false)
  })
  it("active + open-ended → no", () => {
    expect(
      shouldAutoExpire({ status: "active", validTo: null }, asOf),
    ).toBe(false)
  })
  it("non-active status → no (even if past)", () => {
    expect(
      shouldAutoExpire(
        { status: "draft", validTo: new Date("2026-01-01") },
        asOf,
      ),
    ).toBe(false)
  })
})

/* ─── Milestone state machine ──────────────────────────────────────────── */

describe("B10 — milestone state machine", () => {
  it("pending → in_progress | waived", () => {
    expect(canTransitionMilestoneStatus("pending", "in_progress")).toBe(true)
    expect(canTransitionMilestoneStatus("pending", "waived")).toBe(true)
    expect(canTransitionMilestoneStatus("pending", "missed")).toBe(false)
  })
  it("in_progress → met | missed | waived", () => {
    expect(canTransitionMilestoneStatus("in_progress", "met")).toBe(true)
    expect(canTransitionMilestoneStatus("in_progress", "missed")).toBe(true)
    expect(canTransitionMilestoneStatus("in_progress", "waived")).toBe(true)
  })
  it("missed → met | waived (post-hoc operator override)", () => {
    expect(canTransitionMilestoneStatus("missed", "met")).toBe(true)
    expect(canTransitionMilestoneStatus("missed", "waived")).toBe(true)
  })
  it("met + waived are terminal", () => {
    expect(canTransitionMilestoneStatus("met", "missed")).toBe(false)
    expect(canTransitionMilestoneStatus("waived", "in_progress")).toBe(false)
  })
})

/* ─── milestone-due-calculator ─────────────────────────────────────────── */

describe("B10 — calculateMilestoneDue", () => {
  const ticketCreatedAt = new Date("2026-05-20T10:00:00Z")

  it("normal severity uses base dueWithinSeconds × 1.0", () => {
    const definition: MilestoneDefinitionInput = {
      type: "first_response",
      dueWithinSeconds: 4 * 60 * 60, // 4h
      isRequired: true,
    }
    const result = calculateMilestoneDue({
      definition,
      ticketCreatedAt,
      ticketSeverity: "normal",
    })
    expect(result.effectiveDueWithinSeconds).toBe(4 * 60 * 60)
    expect(result.dueAt).toEqual(new Date("2026-05-20T14:00:00Z"))
  })

  it("critical severity tightens window (multiplier 0.25)", () => {
    const definition: MilestoneDefinitionInput = {
      type: "first_response",
      dueWithinSeconds: 4 * 60 * 60,
      isRequired: true,
    }
    const result = calculateMilestoneDue({
      definition,
      ticketCreatedAt,
      ticketSeverity: "critical",
    })
    expect(result.effectiveDueWithinSeconds).toBe(60 * 60) // 1h
    expect(result.dueAt).toEqual(new Date("2026-05-20T11:00:00Z"))
  })

  it("low severity loosens window (multiplier 2.0)", () => {
    const definition: MilestoneDefinitionInput = {
      type: "first_response",
      dueWithinSeconds: 4 * 60 * 60,
      isRequired: true,
    }
    const result = calculateMilestoneDue({
      definition,
      ticketCreatedAt,
      ticketSeverity: "low",
    })
    expect(result.effectiveDueWithinSeconds).toBe(8 * 60 * 60)
  })

  it("anchorTime overrides ticketCreatedAt", () => {
    const anchorTime = new Date("2026-05-20T12:00:00Z")
    const result = calculateMilestoneDue({
      definition: {
        type: "resolution",
        dueWithinSeconds: 3600,
        isRequired: true,
      },
      ticketCreatedAt,
      ticketSeverity: "normal",
      anchorTime,
    })
    expect(result.dueAt).toEqual(new Date("2026-05-20T13:00:00Z"))
  })

  it("multiplierOverride beats severity-based multiplier", () => {
    const result = calculateMilestoneDue({
      definition: {
        type: "first_response",
        dueWithinSeconds: 3600,
        isRequired: true,
      },
      ticketCreatedAt,
      ticketSeverity: "critical", // would otherwise yield 900s
      multiplierOverride: 1.0,
    })
    expect(result.effectiveDueWithinSeconds).toBe(3600)
  })

  it("invalid dueWithinSeconds falls back to 0", () => {
    const result = calculateMilestoneDue({
      definition: {
        type: "first_response",
        dueWithinSeconds: -100, // defensive
        isRequired: true,
      },
      ticketCreatedAt,
      ticketSeverity: "normal",
    })
    expect(result.effectiveDueWithinSeconds).toBe(0)
  })

  it("appliesTo: exact severity match", () => {
    const result = calculateMilestoneDue({
      definition: {
        type: "first_response",
        dueWithinSeconds: 3600,
        severityTier: "critical",
        isRequired: true,
      },
      ticketCreatedAt,
      ticketSeverity: "critical",
    })
    expect(result.appliesTo).toBe(true)
  })

  it("appliesTo: NULL severity means applies-to-all", () => {
    const result = calculateMilestoneDue({
      definition: {
        type: "first_response",
        dueWithinSeconds: 3600,
        severityTier: null,
        isRequired: true,
      },
      ticketCreatedAt,
      ticketSeverity: "high",
    })
    expect(result.appliesTo).toBe(true)
  })

  it("appliesTo: mismatched severity → false", () => {
    const result = calculateMilestoneDue({
      definition: {
        type: "first_response",
        dueWithinSeconds: 3600,
        severityTier: "critical",
        isRequired: true,
      },
      ticketCreatedAt,
      ticketSeverity: "low",
    })
    expect(result.appliesTo).toBe(false)
  })
})

describe("B10 — pickMostSpecificDefinition", () => {
  it("exact-severity match wins over NULL catch-all", () => {
    const defs = [
      { id: "a", severityTier: null },
      { id: "b", severityTier: "critical" },
    ]
    expect(pickMostSpecificDefinition(defs, "critical")?.id).toBe("b")
  })

  it("falls back to NULL catch-all", () => {
    const defs = [
      { id: "a", severityTier: null },
      { id: "b", severityTier: "low" },
    ]
    expect(pickMostSpecificDefinition(defs, "critical")?.id).toBe("a")
  })

  it("no match → null", () => {
    const defs = [{ id: "a", severityTier: "low" }]
    expect(pickMostSpecificDefinition(defs, "critical")).toBeNull()
  })

  it("empty list → null", () => {
    expect(pickMostSpecificDefinition([], "critical")).toBeNull()
  })
})

describe("B10 — ticket entitlement milestone selection", () => {
  it("maps ticket priorities into entitlement severity tiers", () => {
    expect(ticketPriorityToSeverity("critical")).toBe("critical")
    expect(ticketPriorityToSeverity("urgent")).toBe("critical")
    expect(ticketPriorityToSeverity("high")).toBe("high")
    expect(ticketPriorityToSeverity("medium")).toBe("normal")
    expect(ticketPriorityToSeverity("low")).toBe("low")
    expect(ticketPriorityToSeverity(undefined)).toBe("normal")
  })

  it("selects one most-specific runtime definition per milestone type", () => {
    const selected = selectRuntimeMilestoneDefinitions([
      { id: "first-all", type: "first_response", severityTier: null, dueWithinSeconds: 3600, isRequired: true },
      { id: "first-critical", type: "first_response", severityTier: "critical", dueWithinSeconds: 900, isRequired: true },
      { id: "resolution-all", type: "resolution", severityTier: null, dueWithinSeconds: 86400, isRequired: true },
      { id: "ignored", type: "unknown", severityTier: null, dueWithinSeconds: 1, isRequired: false },
    ], "critical")

    expect(selected.map((definition) => definition.id)).toEqual(["first-critical", "resolution-all"])
  })
})

/* ─── milestone-status-evaluator ───────────────────────────────────────── */

describe("B10 — evaluateMilestoneStatus", () => {
  const dueAt = new Date("2026-05-20T14:00:00Z")

  it("in_progress before due → keep, positive secondsToDeadline", () => {
    const result = evaluateMilestoneStatus({
      milestone: { status: "in_progress", dueAt },
      asOf: new Date("2026-05-20T13:00:00Z"),
    })
    expect(result.effectiveStatus).toBe("in_progress")
    expect(result.needsTransition).toBe(false)
    expect(result.secondsToDeadline).toBe(3600)
    expect(result.isOverdueButNotMissed).toBe(false)
  })

  it("in_progress at-or-past due → suggest missed transition", () => {
    const result = evaluateMilestoneStatus({
      milestone: { status: "in_progress", dueAt },
      asOf: new Date("2026-05-20T15:00:00Z"),
    })
    expect(result.effectiveStatus).toBe("missed")
    expect(result.needsTransition).toBe(true)
    expect(result.isOverdueButNotMissed).toBe(true)
    expect(result.secondsToDeadline).toBe(-3600)
  })

  it("at exactly dueAt → missed (>=)", () => {
    const result = evaluateMilestoneStatus({
      milestone: { status: "in_progress", dueAt },
      asOf: dueAt,
    })
    expect(result.effectiveStatus).toBe("missed")
    expect(result.needsTransition).toBe(true)
  })

  it("pending past due → missed transition", () => {
    const result = evaluateMilestoneStatus({
      milestone: { status: "pending", dueAt },
      asOf: new Date("2026-05-20T15:00:00Z"),
    })
    expect(result.needsTransition).toBe(true)
    expect(result.effectiveStatus).toBe("missed")
  })

  it("met → terminal, no transition, null secondsToDeadline", () => {
    const result = evaluateMilestoneStatus({
      milestone: { status: "met", dueAt, completedAt: dueAt },
      asOf: new Date("2026-05-20T20:00:00Z"),
    })
    expect(result.needsTransition).toBe(false)
    expect(result.secondsToDeadline).toBeNull()
  })

  it("waived → terminal", () => {
    const result = evaluateMilestoneStatus({
      milestone: { status: "waived", dueAt, waivedAt: dueAt },
      asOf: new Date("2026-05-20T20:00:00Z"),
    })
    expect(result.needsTransition).toBe(false)
    expect(result.secondsToDeadline).toBeNull()
  })

  it("missed → keep (operator can flip via separate route)", () => {
    const result = evaluateMilestoneStatus({
      milestone: { status: "missed", dueAt, missedAt: dueAt },
      asOf: new Date("2026-05-20T20:00:00Z"),
    })
    expect(result.effectiveStatus).toBe("missed")
    expect(result.needsTransition).toBe(false)
    expect(result.secondsToDeadline).toBeLessThan(0)
  })

  it("unknown status → keep + no transition (defensive)", () => {
    const result = evaluateMilestoneStatus({
      milestone: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        status: "weird" as any,
        dueAt,
      },
      asOf: new Date(),
    })
    expect(result.needsTransition).toBe(false)
    expect(result.secondsToDeadline).toBeNull()
  })
})

/* ─── escalation-planner ───────────────────────────────────────────────── */

describe("B10 — planEscalation", () => {
  const asOf = new Date("2026-05-20T15:00:00Z")
  const overdueAt = new Date("2026-05-20T12:00:00Z") // 3h ago

  it("overdueAt=null → empty toFireNow, no next", () => {
    const result = planEscalation({
      overdueAt: null,
      currentLevel: 0,
      asOf,
    })
    expect(result.toFireNow).toEqual([])
    expect(result.next).toBeNull()
  })

  it("default ladder: 3h after overdue → levels 1 + 2 fire (not 3 yet)", () => {
    const result = planEscalation({
      overdueAt,
      currentLevel: 0,
      asOf,
    })
    expect(result.toFireNow.length).toBe(2) // 30m + 2h, but not 8h yet
    expect(result.toFireNow[0].level).toBe(1)
    expect(result.toFireNow[1].level).toBe(2)
    expect(result.next?.level).toBe(3)
  })

  it("currentLevel=2 → only level 3 considered", () => {
    const result = planEscalation({
      overdueAt: new Date("2026-05-19T15:00:00Z"), // 24h ago
      currentLevel: 2,
      asOf,
    })
    expect(result.toFireNow.length).toBe(1)
    expect(result.toFireNow[0].level).toBe(3)
    expect(result.next).toBeNull()
  })

  it("currentLevel >= ladder.length → no further escalation", () => {
    const result = planEscalation({
      overdueAt,
      currentLevel: 5,
      asOf,
    })
    expect(result.toFireNow).toEqual([])
    expect(result.next).toBeNull()
  })

  it("just overdue (< 30m) → no levels fire yet", () => {
    const result = planEscalation({
      overdueAt: new Date("2026-05-20T14:50:00Z"), // 10m ago
      currentLevel: 0,
      asOf,
    })
    expect(result.toFireNow.length).toBe(0)
    expect(result.next?.level).toBe(1)
  })

  it("custom ladder respected", () => {
    const customLadder: EscalationLevelConfig[] = [
      { level: 1, delaySeconds: 60, action: "ping" },
      { level: 2, delaySeconds: 120, action: "loud_ping" },
    ]
    const result = planEscalation({
      overdueAt: new Date("2026-05-20T14:59:00Z"), // 1m ago
      currentLevel: 0,
      asOf,
      ladder: customLadder,
    })
    expect(result.toFireNow.length).toBe(1)
    expect(result.toFireNow[0].action).toBe("ping")
  })

  it("invalid ladder entries filtered out", () => {
    const messy: EscalationLevelConfig[] = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { level: -1, delaySeconds: 60, action: "bad" } as any,
      { level: 1, delaySeconds: 30 * 60, action: "ok" },
    ]
    const result = planEscalation({
      overdueAt,
      currentLevel: 0,
      asOf,
      ladder: messy,
    })
    expect(result.allSteps.length).toBe(1)
    expect(result.allSteps[0].action).toBe("ok")
  })

  it("all-invalid ladder falls back to DEFAULT_ESCALATION_LADDER", () => {
    const result = planEscalation({
      overdueAt,
      currentLevel: 0,
      asOf,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ladder: [{ level: 0, delaySeconds: -5, action: "bad" } as any],
    })
    expect(result.allSteps.length).toBe(DEFAULT_ESCALATION_LADDER.length)
  })

  it("toFireNow sorted by level ASC", () => {
    const result = planEscalation({
      overdueAt: new Date("2026-05-19T15:00:00Z"), // 24h ago — all 3 fire
      currentLevel: 0,
      asOf,
    })
    expect(result.toFireNow.length).toBe(3)
    expect(result.toFireNow[0].level).toBe(1)
    expect(result.toFireNow[2].level).toBe(3)
  })

  it("fireAt = overdueAt + delaySeconds", () => {
    const result = planEscalation({
      overdueAt,
      currentLevel: 0,
      asOf,
    })
    const level1 = result.allSteps.find((s) => s.level === 1)!
    expect(level1.fireAt.getTime()).toBe(
      overdueAt.getTime() + DEFAULT_ESCALATION_LADDER[0].delaySeconds * 1000,
    )
  })
})

describe("B10 — summarizeEscalation", () => {
  const asOf = new Date("2026-05-20T15:00:00Z")
  const overdueAt = new Date("2026-05-20T12:00:00Z")

  it("after default ladder + 3h: 2 fired, next at level 3, 0 upcoming beyond", () => {
    // Default ladder has 3 levels (30m / 2h / 8h). After 3h: levels 1+2 fired,
    // level 3 is `next` (not yet fired), nothing beyond level 3 → upcomingCount=0.
    // (`upcomingCount` counts steps strictly AFTER `next` per architect pass-1 fix.)
    const plan = planEscalation({ overdueAt, currentLevel: 0, asOf })
    const sum = summarizeEscalation(plan)
    expect(sum.firedCount).toBe(2)
    expect(sum.upcomingCount).toBe(0) // no steps beyond level 3 in default ladder
    expect(sum.nextActionAt).not.toBeNull()
  })

  it("custom 5-level ladder shows upcomingCount > 0 beyond next", () => {
    const ladder = [
      { level: 1, delaySeconds: 30 * 60, action: "a1" },
      { level: 2, delaySeconds: 60 * 60, action: "a2" },
      { level: 3, delaySeconds: 4 * 60 * 60, action: "a3" },
      { level: 4, delaySeconds: 8 * 60 * 60, action: "a4" },
      { level: 5, delaySeconds: 12 * 60 * 60, action: "a5" },
    ]
    // 3h after overdue: levels 1+2 fired, level 3 is `next`, levels 4+5 upcoming.
    const plan = planEscalation({
      overdueAt,
      currentLevel: 0,
      asOf,
      ladder,
    })
    const sum = summarizeEscalation(plan)
    expect(sum.firedCount).toBe(2)
    expect(sum.upcomingCount).toBe(2) // levels 4 + 5
  })

  it("no overdue → all-zero summary", () => {
    const plan = planEscalation({
      overdueAt: null,
      currentLevel: 0,
      asOf,
    })
    const sum = summarizeEscalation(plan)
    expect(sum.firedCount).toBe(0)
    expect(sum.nextActionAt).toBeNull()
  })
})

/* ─── End-to-end pipeline sanity ───────────────────────────────────────── */

describe("B10 — end-to-end pipeline", () => {
  it("typical: definition → due → eval at deadline → escalation plan", () => {
    const ticketCreatedAt = new Date("2026-05-20T10:00:00Z")
    const ticketSeverity = "critical" as const

    // 1. Compute milestone due
    const dueResult = calculateMilestoneDue({
      definition: {
        type: "first_response",
        dueWithinSeconds: 4 * 60 * 60,
        isRequired: true,
      },
      ticketCreatedAt,
      ticketSeverity,
    })
    expect(dueResult.effectiveDueWithinSeconds).toBe(60 * 60) // 4h × 0.25 = 1h
    const dueAt = dueResult.dueAt
    expect(dueAt).toEqual(new Date("2026-05-20T11:00:00Z"))

    // 2. Evaluate at 11:30 (30min past deadline)
    const evalResult = evaluateMilestoneStatus({
      milestone: { status: "in_progress", dueAt },
      asOf: new Date("2026-05-20T11:30:00Z"),
    })
    expect(evalResult.effectiveStatus).toBe("missed")
    expect(evalResult.needsTransition).toBe(true)
    expect(evalResult.isOverdueButNotMissed).toBe(true)

    // 3. Plan escalation: milestone missed at 11:00 (overdueAt), 30min later
    const escResult = planEscalation({
      overdueAt: dueAt, // missed at dueAt
      currentLevel: 0,
      asOf: new Date("2026-05-20T11:30:00Z"),
    })
    expect(escResult.toFireNow.length).toBe(1) // level 1 (30min)
    expect(escResult.toFireNow[0].level).toBe(1)
    expect(escResult.next?.level).toBe(2)
  })

  it("entitlement validity: full lifecycle simulation", () => {
    const entitlement = {
      status: "draft" as const,
      validFrom: new Date("2026-01-01"),
      validTo: new Date("2026-12-31"),
    }
    // Draft: not honored
    expect(
      isEntitlementHonored({ entitlement, asOf: new Date("2026-06-01") })
        .isHonored,
    ).toBe(false)
    // Transition draft → active
    expect(canTransitionEntitlementStatus("draft", "active")).toBe(true)
    const activated = { ...entitlement, status: "active" as const }
    // Active in-window: honored
    expect(
      isEntitlementHonored({ entitlement: activated, asOf: new Date("2026-06-01") })
        .isHonored,
    ).toBe(true)
    // Should auto-expire after 2027
    expect(
      shouldAutoExpire(activated, new Date("2027-01-15")),
    ).toBe(true)
  })
})
