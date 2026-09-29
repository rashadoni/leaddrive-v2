import { describe, expect, it } from "vitest"

import {
  agentEligibleForQueue,
  applyBulkSkillChange,
  canManageSkillRouting,
  normalizeRoutingSkills,
  routingCoverage,
  type RoutingAgent,
  type RoutingQueue,
} from "@/lib/skill-routing/presentation"

const agent = (overrides: Partial<RoutingAgent> = {}): RoutingAgent => ({ id: "a1", name: "Agent", role: "support", skills: ["billing"], isAvailable: true, isActive: true, ...overrides })
const queue = (overrides: Partial<RoutingQueue> = {}): RoutingQueue => ({ id: "q1", name: "Billing", skills: ["billing"], priority: 1, autoAssign: true, assignMethod: "least_loaded", isActive: true, createdAt: "2026-09-05", ...overrides })

describe("skill routing presentation", () => {
  it("normalizes stable canonical skill values", () => {
    expect(normalizeRoutingSkills([" Billing ", "billing", "TECH"])).toEqual(["billing", "tech"])
  })

  it("matches runtime eligibility including support and ticketing agents", () => {
    expect(agentEligibleForQueue(agent(), queue())).toBe(true)
    expect(agentEligibleForQueue(agent({ role: "ticketing" }), queue())).toBe(true)
    expect(agentEligibleForQueue(agent({ isAvailable: false }), queue())).toBe(false)
    expect(agentEligibleForQueue(agent({ isActive: false }), queue())).toBe(false)
    expect(agentEligibleForQueue(agent({ skills: ["technical"] }), queue())).toBe(false)
    expect(agentEligibleForQueue(agent({ skills: [] }), queue({ skills: [] }))).toBe(true)
  })

  it("finds uncovered active auto-assign queues and skill gaps", () => {
    const queues = [queue(), queue({ id: "q2", name: "Tech", skills: ["technical"] }), queue({ id: "q3", isActive: false })]
    const agents = [agent(), agent({ id: "a2", name: "No skills", skills: [] })]
    const result = routingCoverage(queues, agents)
    expect(result.activeQueues).toHaveLength(2)
    expect(result.uncoveredQueues.map((item) => item.id)).toEqual(["q2"])
    expect(result.agentsWithoutSkills.map((item) => item.id)).toEqual(["a2"])
  })

  it("applies additive and subtractive bulk edits without replacing unrelated skills", () => {
    expect(applyBulkSkillChange(["billing", "vip"], ["technical", "billing"], "add")).toEqual(["billing", "technical", "vip"])
    expect(applyBulkSkillChange(["billing", "vip"], ["billing"], "remove")).toEqual(["vip"])
  })

  it("limits management to administrator and manager roles", () => {
    expect(canManageSkillRouting("admin")).toBe(true)
    expect(canManageSkillRouting("manager")).toBe(true)
    expect(canManageSkillRouting("support")).toBe(false)
    expect(canManageSkillRouting("ticketing")).toBe(false)
  })
})
