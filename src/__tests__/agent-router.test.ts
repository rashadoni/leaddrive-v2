import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiAgentConfig: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/ai/intent-classifier", () => ({
  classifyIntent: vi.fn(),
}))

import { routeToAgent } from "@/lib/ai/agent-router"
import { classifyIntent } from "@/lib/ai/intent-classifier"
import { prisma } from "@/lib/prisma"

/**
 * Agents as the query returns them: active, never the inbox persona, highest
 * priority first.
 */
const salesAgent = { id: "agent-sales", agentType: "sales", configName: "Sales Bot", isActive: true, priority: 5 }
const supportAgent = { id: "agent-support", agentType: "support", configName: "Support Bot", isActive: true, priority: 3 }
const generalAgent = { id: "agent-general", agentType: "general", configName: "General Bot", isActive: true, priority: 1 }
const socialAgent = { id: "agent-social", agentType: "social", configName: "Social Bot", isActive: true, priority: 0 }

function orgHas(...agents: object[]) {
  vi.mocked(prisma.aiAgentConfig.findMany).mockResolvedValue(agents as never)
}

describe("agent-router — routeToAgent", () => {
  const orgId = "org-1"

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reads only active agents, never the omnichannel inbox persona, best priority first", async () => {
    orgHas()
    await routeToAgent(orgId, "Hello")
    expect(prisma.aiAgentConfig.findMany).toHaveBeenCalledWith({
      where: { organizationId: orgId, isActive: true, agentType: { not: "inbox" } },
      orderBy: { priority: "desc" },
    })
  })

  it("routes sales_inquiry to the sales agent", async () => {
    orgHas(salesAgent, supportAgent, generalAgent)
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "sales_inquiry", confidence: 0.9 })
    const result = await routeToAgent(orgId, "What is your pricing?")
    expect(result).toEqual({ agent: salesAgent, intent: "sales_inquiry", confidence: 0.9, isHandoff: false })
  })

  it("routes support_request and billing_question to the support agent", async () => {
    orgHas(salesAgent, supportAgent, generalAgent)
    vi.mocked(classifyIntent).mockResolvedValueOnce({ intent: "support_request", confidence: 0.85 })
    expect((await routeToAgent(orgId, "My app is broken")).agent).toEqual(supportAgent)
    vi.mocked(classifyIntent).mockResolvedValueOnce({ intent: "billing_question", confidence: 0.8 })
    expect((await routeToAgent(orgId, "Where is my invoice?")).agent).toEqual(supportAgent)
  })

  it("falls back to the general agent, then to any active agent", async () => {
    orgHas(supportAgent, generalAgent)
    vi.mocked(classifyIntent).mockResolvedValueOnce({ intent: "sales_inquiry", confidence: 0.9 })
    expect((await routeToAgent(orgId, "What is pricing?")).agent).toEqual(generalAgent)

    orgHas(salesAgent, supportAgent)
    vi.mocked(classifyIntent).mockResolvedValueOnce({ intent: "data_analysis", confidence: 0.7 })
    expect((await routeToAgent(orgId, "Show me analytics")).agent).toEqual(salesAgent)
  })

  it("asks no model when there is nothing to choose between", async () => {
    // No agents at all (most organisations).
    orgHas()
    expect(await routeToAgent(orgId, "Hello")).toEqual({ agent: null, intent: "general", confidence: 1, isHandoff: false })
    // One agent of a type no intent asks for (Zeytun: a single "social" agent).
    orgHas(socialAgent)
    expect((await routeToAgent(orgId, "Сколько заказов?")).agent).toEqual(socialAgent)
    // Two agents, but only one of them is ever picked (general wins over the unmapped type).
    orgHas(generalAgent, socialAgent)
    expect((await routeToAgent(orgId, "Hi")).agent).toEqual(generalAgent)
    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it("asks the model as soon as two intents would land on different agents", async () => {
    orgHas(salesAgent, generalAgent)
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "general", confidence: 0.6 })
    expect((await routeToAgent(orgId, "Hello")).agent).toEqual(generalAgent)
    expect(classifyIntent).toHaveBeenCalledTimes(1)
  })

  it("reports a handoff only when the agent changes from the previous one", async () => {
    orgHas(salesAgent, supportAgent)
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "support_request", confidence: 0.9 })
    expect((await routeToAgent(orgId, "My app is broken", "agent-sales")).isHandoff).toBe(true)
    expect((await routeToAgent(orgId, "Still broken", "agent-support")).isHandoff).toBe(false)
    expect((await routeToAgent(orgId, "Hi")).isHandoff).toBe(false)
  })
})
