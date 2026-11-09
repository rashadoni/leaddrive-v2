import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiAgentConfig: { findMany: vi.fn() },
  },
}))

// The intent is read from the words (no model since 2026-11-09). The real
// classifier runs here; a spy only shows whether it was consulted at all.
vi.mock("@/lib/ai/intent-classifier", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai/intent-classifier")>()
  return { ...real, classifyIntent: vi.fn(real.classifyIntent) }
})
vi.mock("@anthropic-ai/sdk", () => ({
  default: function NoModel() { throw new Error("routing must not call a model") },
}))

import { routeToAgent } from "@/lib/ai/agent-router"
import { classifyIntent } from "@/lib/ai/intent-classifier"
import { prisma } from "@/lib/prisma"

/**
 * The org's agents as stored. The mock answers `findMany` the way Postgres
 * would — it applies the router's own `where` and `orderBy` to these rows —
 * so a test states which rows exist and checks which agent answers, not the
 * shape of the query.
 */
const salesAgent = { id: "agent-sales", organizationId: "org-1", agentType: "sales", configName: "Sales Bot", isActive: true, priority: 5 }
const supportAgent = { id: "agent-support", organizationId: "org-1", agentType: "support", configName: "Support Bot", isActive: true, priority: 3 }
const generalAgent = { id: "agent-general", organizationId: "org-1", agentType: "general", configName: "General Bot", isActive: true, priority: 1 }
const socialAgent = { id: "agent-social", organizationId: "org-1", agentType: "social", configName: "Zeytun Pharma · Social AI", isActive: true, priority: 0 }
const inboxAgent = { id: "agent-inbox", organizationId: "org-1", agentType: "inbox", configName: "Inbox AI Agent", isActive: true, priority: 99 }
const contractAgent = { id: "agent-contract", organizationId: "org-1", agentType: "contract", configName: "Contract AI", isActive: true, priority: 50 }

type Row = { id: string; organizationId: string; agentType: string; isActive: boolean; priority: number }
let table: Row[] = []

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = (row as Record<string, unknown>)[key]
    if (condition && typeof condition === "object") {
      const c = condition as { in?: unknown[]; not?: unknown }
      if (c.in && !c.in.includes(value)) return false
      if ("not" in c && value === c.not) return false
      return true
    }
    return value === condition
  })
}

function orgHas(...agents: Row[]) {
  table = agents
  vi.mocked(prisma.aiAgentConfig.findMany).mockImplementation((async (args: {
    where: Record<string, unknown>
    orderBy?: { priority?: "asc" | "desc" }
  }) => {
    const rows = table.filter((row) => matches(row, args.where))
    if (args.orderBy?.priority) {
      const sign = args.orderBy.priority === "desc" ? -1 : 1
      rows.sort((a, b) => sign * (a.priority - b.priority))
    }
    return rows
  }) as never)
}

describe("agent-router — routeToAgent", () => {
  const orgId = "org-1"

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("never answers staff as a module's own agent: inbox, social, contract stay out", async () => {
    orgHas(inboxAgent, contractAgent, socialAgent, { ...generalAgent, isActive: false })
    for (const message of ["Сколько заказов за неделю?", "Hello", "Покажи сделки"]) {
      expect(await routeToAgent(orgId, message)).toEqual({ agent: null, intent: "general", confidence: 1, classified: false, isHandoff: false })
    }
    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it("Zeytun: an org whose only agent is the social one gets the plain Da Vinci", async () => {
    orgHas(socialAgent)
    const result = await routeToAgent(orgId, "Сколько заказов?", "agent-social")
    expect(result.agent).toBeNull()
    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it("module agents do not outrank a Da Vinci persona, whatever their priority", async () => {
    orgHas(inboxAgent, contractAgent, socialAgent, generalAgent)
    expect((await routeToAgent(orgId, "Hi")).agent).toEqual(generalAgent)
  })

  it("reads only this org's active agents, best priority first", async () => {
    orgHas({ ...salesAgent, organizationId: "org-2" }, { ...supportAgent, isActive: false }, generalAgent)
    expect((await routeToAgent(orgId, "What is your pricing?")).agent).toEqual(generalAgent)
    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it("routes a sales question to the sales agent, by its words", async () => {
    orgHas(salesAgent, supportAgent, generalAgent)
    const result = await routeToAgent(orgId, "What is your pricing?")
    expect(result).toEqual({ agent: salesAgent, intent: "sales_inquiry", confidence: 0.7, classified: true, isHandoff: false })
    expect((await routeToAgent(orgId, "Покажи сделки в воронке")).agent).toEqual(salesAgent)
    expect((await routeToAgent(orgId, "Bu ay neçə sövdələşmə bağlanıb?")).agent).toEqual(salesAgent)
  })

  it("routes support and billing questions to the support agent", async () => {
    orgHas(salesAgent, supportAgent, generalAgent)
    expect((await routeToAgent(orgId, "My app is broken")).agent).toEqual(supportAgent)
    expect((await routeToAgent(orgId, "Where is my invoice?")).agent).toEqual(supportAgent)
    expect((await routeToAgent(orgId, "Какие тикеты открыты?")).agent).toEqual(supportAgent)
  })

  it("a question with no clear words goes to the general agent", async () => {
    orgHas(salesAgent, supportAgent, generalAgent)
    expect((await routeToAgent(orgId, "Привет! Ты на связи?")).agent).toEqual(generalAgent)
    // Two areas named equally: neither wins.
    expect((await routeToAgent(orgId, "Отчёт по продажам")).agent).toEqual(generalAgent)
  })

  it("falls back to the general agent, then to any active agent", async () => {
    orgHas(supportAgent, generalAgent)
    expect((await routeToAgent(orgId, "What is pricing?")).agent).toEqual(generalAgent)

    orgHas(salesAgent, supportAgent)
    expect((await routeToAgent(orgId, "Show me analytics")).agent).toEqual(salesAgent)
  })

  it("asks no model when there is nothing to choose between", async () => {
    // No agents at all (most organisations).
    orgHas()
    expect(await routeToAgent(orgId, "Hello")).toEqual({ agent: null, intent: "general", confidence: 1, classified: false, isHandoff: false })
    // Two agents, but only one of them is a Da Vinci persona.
    orgHas(generalAgent, socialAgent)
    expect((await routeToAgent(orgId, "Hi")).agent).toEqual(generalAgent)
    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it("reads the words as soon as two intents would land on different agents", async () => {
    orgHas(salesAgent, generalAgent)
    expect((await routeToAgent(orgId, "Hello")).agent).toEqual(generalAgent)
    expect(classifyIntent).toHaveBeenCalledTimes(1)
  })

  it("reports a handoff only when the agent changes from the previous one", async () => {
    orgHas(salesAgent, supportAgent)
    expect((await routeToAgent(orgId, "My app is broken", "agent-sales")).isHandoff).toBe(true)
    expect((await routeToAgent(orgId, "Still broken", "agent-support")).isHandoff).toBe(false)
    expect((await routeToAgent(orgId, "Hi")).isHandoff).toBe(false)
  })
})
