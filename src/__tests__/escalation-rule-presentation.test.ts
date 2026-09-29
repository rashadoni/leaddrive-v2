import { describe, expect, it } from "vitest"

import {
  escalationConflictGroups,
  findEscalationConflict,
  minutesToOffset,
  offsetToMinutes,
  ruleActionFromDraft,
  triggerTimeFromDeadline,
  type EscalationRule,
  type EscalationRuleDraft,
} from "@/lib/escalation-rules/presentation"

const draft = (overrides: Partial<EscalationRuleDraft> = {}): EscalationRuleDraft => ({ name: "Notify", triggerType: "resolution_warning", offsetValue: 2, offsetUnit: "hours", level: 1, actionType: "notify", actionTarget: "manager", isActive: true, ...overrides })
const rule = (overrides: Partial<EscalationRule> = {}): EscalationRule => ({ id: "r1", name: "Notify", triggerType: "resolution_warning", triggerMinutes: 120, level: 1, actions: [{ type: "notify", target: "manager" }], isActive: true, createdAt: "2026-09-05", ...overrides })

describe("escalation rule presentation", () => {
  it("round-trips human duration units into integer runtime minutes", () => {
    expect(offsetToMinutes(1.5, "hours")).toBe(90)
    expect(offsetToMinutes(2, "days")).toBe(2880)
    expect(minutesToOffset(2880)).toEqual({ value: 2, unit: "days" })
    expect(minutesToOffset(90)).toEqual({ value: 90, unit: "minutes" })
    expect(offsetToMinutes(365, "days")).toBe(525600)
  })

  it("simulates warnings before and breaches after an SLA deadline", () => {
    const deadline = new Date("2026-09-05T12:00:00Z")
    expect(triggerTimeFromDeadline(deadline, "resolution_warning", 30).toISOString()).toBe("2026-09-05T11:30:00.000Z")
    expect(triggerTimeFromDeadline(deadline, "resolution_breach", 30).toISOString()).toBe("2026-09-05T12:30:00.000Z")
    expect(triggerTimeFromDeadline(deadline, "first_response_breach", 0).toISOString()).toBe("2026-09-05T12:00:00.000Z")
  })

  it("detects only exact active conflicts and supports safe inactive duplicates", () => {
    expect(findEscalationConflict([rule()], draft())?.id).toBe("r1")
    expect(findEscalationConflict([rule()], draft({ isActive: false }))).toBeNull()
    expect(findEscalationConflict([rule()], draft({ actionTarget: "admin" }))).toBeNull()
    expect(findEscalationConflict([rule()], draft(), "r1")).toBeNull()
    expect(escalationConflictGroups([rule(), rule({ id: "r2" }), rule({ id: "r3", level: 2 })])).toHaveLength(1)
  })

  it("omits notification targets from non-notification runtime actions", () => {
    expect(ruleActionFromDraft(draft())).toEqual({ type: "notify", target: "manager" })
    expect(ruleActionFromDraft(draft({ actionType: "reassign" }))).toEqual({ type: "reassign" })
  })
})
