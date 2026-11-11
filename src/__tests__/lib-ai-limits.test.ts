import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A6 — granular AI limits. Contracts: defaults merge over junk, counters checked
 * BEFORE generation, fail-open on counter errors (the USD budget remains the backstop).
 */
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    organization: { findUnique: vi.fn() },
    channelMessage: { count: vi.fn() },
    webChatMessage: { count: vi.fn() },
    aiUsage: { aggregate: vi.fn() },
  },
}))

import {
  checkAiBudget,
  readDailyAiLimit,
  getAiLimits,
  checkConversationAiLimits,
  DEFAULT_AI_LIMITS,
} from "@/lib/ai/budget"
import { prisma } from "@/lib/prisma"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as never)
  vi.mocked(prisma.channelMessage.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.webChatMessage.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.aiUsage.aggregate).mockResolvedValue({
    _sum: { costUsd: 0 },
  } as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
})

describe("checkAiBudget", () => {
  it("keeps same-day social-monitoring AI spend enforced after a clean-slate reset", async () => {
    const now = new Date()
    const dayStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    ))
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    vi.mocked(prisma.aiUsage.aggregate).mockResolvedValue({
      _sum: { costUsd: 1.25 },
    } as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{
      resetCreatedAt: now,
      resetNewValue: {
        budgetCarryForward: {
          schemaVersion: "social-monitoring-budget-carry-v1",
          capturedAt: now.toISOString(),
          utcDayStart: dayStart.toISOString(),
          utcMonthStart: monthStart.toISOString(),
          provider: { dayChargeUsd: 0, monthChargeUsd: 0, runsToday: 0 },
          paidRunAuthorization: { dayReservedUsd: 0, monthReservedUsd: 0, runsToday: 0 },
          media: { dayCostUsd: 0, monthCostUsd: 0 },
          ai: { dayCostUsd: 2.5, monthCostUsd: 2.5 },
        },
      },
    }] as never)

    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { aiDailyBudgetUsd: 5 } } as never)
    expect(await checkAiBudget("o1")).toEqual({
      allowed: true,
      spent: 3.75,
      limit: 5,
      remaining: 1.25,
    })
  })

  // Owner, 2026-11-11: «зачем ты ставишь лимит?… если клиент захочет, то пусть ставит лимит».
  it("imposes no limit on an organization that set none, however much it spent", async () => {
    vi.mocked(prisma.aiUsage.aggregate).mockResolvedValue({ _sum: { costUsd: 250 } } as never)
    for (const settings of [{}, { aiDailyBudgetUsd: null }, { aiDailyBudgetUsd: 0 }, { aiDailyBudgetUsd: "10" }]) {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings } as never)
      expect(await checkAiBudget("o1")).toEqual({ allowed: true, spent: 250, limit: null, remaining: null })
    }
  })

  it("stops at the limit the organization set", async () => {
    vi.mocked(prisma.aiUsage.aggregate).mockResolvedValue({ _sum: { costUsd: 12 } } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { aiDailyBudgetUsd: 12 } } as never)
    expect(await checkAiBudget("o1")).toEqual({ allowed: false, spent: 12, limit: 12, remaining: 0 })
  })
})

describe("readDailyAiLimit", () => {
  it("is a positive finite number of dollars, or none", () => {
    expect(readDailyAiLimit({ aiDailyBudgetUsd: 7.5 })).toBe(7.5)
    for (const settings of [null, undefined, {}, { aiDailyBudgetUsd: 0 }, { aiDailyBudgetUsd: -1 },
      { aiDailyBudgetUsd: Infinity }, { aiDailyBudgetUsd: "5" }, "x"]) {
      expect(readDailyAiLimit(settings)).toBeNull()
    }
  })
})

describe("getAiLimits", () => {
  it("returns defaults with no settings", async () => {
    expect(await getAiLimits("o1")).toEqual(DEFAULT_AI_LIMITS)
  })
  it("merges valid overrides, ignores junk per-field", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      settings: { aiLimits: { maxRepliesPerConversation: 5, maxOutputTokens: "lots", maxRepliesPerContactPerDay: -3 } },
    } as never)
    expect(await getAiLimits("o1")).toEqual({
      maxRepliesPerConversation: 5,
      maxRepliesPerContactPerDay: DEFAULT_AI_LIMITS.maxRepliesPerContactPerDay,
      maxOutputTokens: DEFAULT_AI_LIMITS.maxOutputTokens,
    })
  })
})

describe("checkConversationAiLimits", () => {
  it("blocks at the per-conversation cap (count >= max)", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      settings: { aiLimits: { maxRepliesPerConversation: 3 } },
    } as never)
    vi.mocked(prisma.channelMessage.count).mockResolvedValue(3 as never)
    const v = await checkConversationAiLimits({ orgId: "o1", conversationId: "cv1" })
    expect(v.allowed).toBe(false)
    if (!v.allowed) expect(v.reason).toBe("conversation_cap")
  })

  it("blocks a flooding contact at the daily cap", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      settings: { aiLimits: { maxRepliesPerContactPerDay: 2 } },
    } as never)
    // 1st count = conversation (under), 2nd = contact/day (at cap)
    vi.mocked(prisma.channelMessage.count).mockResolvedValueOnce(0 as never).mockResolvedValueOnce(2 as never)
    const v = await checkConversationAiLimits({ orgId: "o1", conversationId: "cv1", contactId: "ct1" })
    expect(v.allowed).toBe(false)
    if (!v.allowed) expect(v.reason).toBe("contact_daily_cap")
  })

  it("web-chat sessions count bot messages against the conversation cap", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      settings: { aiLimits: { maxRepliesPerConversation: 1 } },
    } as never)
    vi.mocked(prisma.webChatMessage.count).mockResolvedValue(1 as never)
    const v = await checkConversationAiLimits({ orgId: "o1", webChatSessionId: "ws1" })
    expect(v.allowed).toBe(false)
  })

  it("fails OPEN when a counter query throws (USD budget is the backstop)", async () => {
    vi.mocked(prisma.channelMessage.count).mockRejectedValue(new Error("db down") as never)
    const v = await checkConversationAiLimits({ orgId: "o1", conversationId: "cv1", contactId: "ct1" })
    expect(v.allowed).toBe(true)
  })

  it("allows under all caps and returns the limits for the token clamp", async () => {
    const v = await checkConversationAiLimits({ orgId: "o1", conversationId: "cv1", contactId: "ct1" })
    expect(v.allowed).toBe(true)
    expect(v.limits.maxOutputTokens).toBe(DEFAULT_AI_LIMITS.maxOutputTokens)
  })
})
