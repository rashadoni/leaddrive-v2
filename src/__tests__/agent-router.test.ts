import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiAgentConfig: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/ai/intent-classifier", () => ({
  classifyIntent: vi.fn(),
}))

import { routeToAgent } from "@/lib/ai/agent-router"
import { classifyIntent } from "@/lib/ai/intent-classifier"
import { prisma } from "@/lib/prisma"

describe("agent-router — routeToAgent", () => {
  const orgId = "org-1"

  const salesAgent = { id: "agent-sales", agentType: "sales", configName: "Sales Bot", isActive: true, priority: 5 }
  const supportAgent = { id: "agent-support", agentType: "support", configName: "Support Bot", isActive: true, priority: 3 }
  const generalAgent = { id: "agent-general", agentType: "general", configName: "General Bot", isActive: true, priority: 1 }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("routes sales_inquiry to sales agent", async () => {
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "sales_inquiry", confidence: 0.9 })
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValueOnce(salesAgent as any)

    const result = await routeToAgent(orgId, "What is your pricing?")

    expect(result.intent).toBe("sales_inquiry")
    expect(result.confidence).toBe(0.9)
    expect(result.agent).toEqual(salesAgent)
    expect(result.isHandoff).toBe(false)
  })

  it("routes support_request to support agent", async () => {
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "support_request", confidence: 0.85 })
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValueOnce(supportAgent as any)

    const result = await routeToAgent(orgId, "My app is broken")
    expect(result.agent).toEqual(supportAgent)
    expect(result.intent).toBe("support_request")
  })

  it("routes billing_question to support agent (not billing agent)", async () => {
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "billing_question", confidence: 0.8 })
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValueOnce(supportAgent as any)

    const result = await routeToAgent(orgId, "Where is my invoice?")
    expect(result.agent).toEqual(supportAgent)
  })

  it("falls back to general agent when specialized not found", async () => {
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "sales_inquiry", confidence: 0.9 })
    vi.mocked(prisma.aiAgentConfig.findFirst)
      .mockResolvedValueOnce(null) // no sales agent
      .mockResolvedValueOnce(generalAgent as any) // general fallback

    const result = await routeToAgent(orgId, "What is pricing?")
    expect(result.agent).toEqual(generalAgent)
  })

  it("falls back to any active agent when general not found either", async () => {
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "data_analysis", confidence: 0.7 })
    vi.mocked(prisma.aiAgentConfig.findFirst)
      .mockResolvedValueOnce(null) // no analyst agent
      .mockResolvedValueOnce(null) // no general agent
      .mockResolvedValueOnce(supportAgent as any) // any active agent

    const result = await routeToAgent(orgId, "Show me analytics")
    expect(result.agent).toEqual(supportAgent)
  })

  it("last-resort fallback EXCLUDES the omnichannel inbox persona (no Gobustone bleed into CRM chat)", async () => {
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "general", confidence: 0.5 })
    vi.mocked(prisma.aiAgentConfig.findFirst)
      .mockResolvedValueOnce(null) // no preferred-type agent
      .mockResolvedValueOnce(null) // no general agent
      .mockResolvedValueOnce(null) // no NON-inbox agent → null (must NOT return the inbox persona)

    const result = await routeToAgent(orgId, "Hello")
    expect(result.agent).toBeNull()
    // the last-resort query must exclude agentType="inbox" so the social/Gobustone persona
    // can never answer the internal CRM in-app chat
    const thirdCallArgs = vi.mocked(prisma.aiAgentConfig.findFirst).mock.calls[2][0] as any
    expect(thirdCallArgs.where.agentType).toEqual({ not: "inbox" })
  })

  it("returns null agent when no agents exist", async () => {
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "general", confidence: 0.5 })
    vi.mocked(prisma.aiAgentConfig.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    const result = await routeToAgent(orgId, "Hello")
    expect(result.agent).toBeNull()
  })

  it("detects handoff when agent changes from previous", async () => {
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "support_request", confidence: 0.9 })
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValueOnce(supportAgent as any)

    const result = await routeToAgent(orgId, "My app is broken", "agent-sales")
    expect(result.isHandoff).toBe(true) // agent-support !== agent-sales
  })

  it("no handoff when agent stays the same", async () => {
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "support_request", confidence: 0.9 })
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValueOnce(supportAgent as any)

    const result = await routeToAgent(orgId, "Still broken", "agent-support")
    expect(result.isHandoff).toBe(false) // same agent
  })

  it("no handoff on first message (no previousAgentId)", async () => {
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "general", confidence: 0.5 })
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValueOnce(generalAgent as any)

    const result = await routeToAgent(orgId, "Hello")
    expect(result.isHandoff).toBe(false)
  })

  it("classifier fallback returns general intent", async () => {
    vi.mocked(classifyIntent).mockResolvedValue({ intent: "general", confidence: 0.5 })
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValueOnce(generalAgent as any)

    const result = await routeToAgent(orgId, "asdfasdf random")
    expect(result.intent).toBe("general")
    expect(result.confidence).toBe(0.5)
  })
})
