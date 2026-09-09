import { describe, expect, it } from "vitest"
import { advisorMaxAutonomyLevel, buildAdvisorAutonomyPolicy, parseAdvisorTenantAutonomySettings } from "@/lib/ai/advisor/autonomy"

describe("Advisor autonomy policy", () => {
  it("allows safe internal actions to reach controlled autopilot", () => {
    expect(advisorMaxAutonomyLevel("create_task", "low")).toBe("L3")
    expect(advisorMaxAutonomyLevel("flag_route_issue", "medium")).toBe("L3")
    expect(buildAdvisorAutonomyPolicy("create_note", "low")).toMatchObject({
      maxLevel: "L3",
      requiresApproval: false,
    })
  })

  it("keeps drafted external or financial recommendations approval-gated", () => {
    expect(buildAdvisorAutonomyPolicy("invoice_reminder", "medium")).toMatchObject({
      maxLevel: "L2",
      requiresApproval: true,
    })
    expect(buildAdvisorAutonomyPolicy("suggest_budget_change", "medium")).toMatchObject({
      maxLevel: "L2",
      requiresApproval: true,
    })
  })

  it("caps dangerous and high-risk actions at L2", () => {
    expect(advisorMaxAutonomyLevel("create_task", "dangerous")).toBe("L2")
    expect(advisorMaxAutonomyLevel("create_alert", "high")).toBe("L2")
    expect(buildAdvisorAutonomyPolicy("unknown_action", "dangerous")).toMatchObject({
      maxLevel: "L2",
      requiresApproval: true,
    })
  })

  it("applies tenant-level autonomy caps", () => {
    expect(parseAdvisorTenantAutonomySettings({ aiAdvisorMaxAutonomyLevel: "L3" })).toEqual({ maxAutonomyLevel: "L3" })
    expect(parseAdvisorTenantAutonomySettings({ aiAdvisorMaxAutonomyLevel: "bad" })).toEqual({ maxAutonomyLevel: "L2" })
    expect(buildAdvisorAutonomyPolicy("create_task", "low", { maxAutonomyLevel: "L1" })).toMatchObject({
      maxLevel: "L1",
      requiresApproval: true,
      reason: "Tenant cap limits this action to L1.",
    })
  })
})
