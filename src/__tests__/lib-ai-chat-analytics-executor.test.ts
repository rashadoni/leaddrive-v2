import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: vi.fn(), findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
    quote: { count: vi.fn(), groupBy: vi.fn() },
    task: { count: vi.fn(), groupBy: vi.fn() },
    ticket: { count: vi.fn(), groupBy: vi.fn() },
    lead: { groupBy: vi.fn() },
    callLog: { groupBy: vi.fn() },
    pipelineStageTransition: { groupBy: vi.fn() },
  },
}))

vi.mock("@/lib/ai/voice/section-reader", () => ({ readSection: vi.fn() }))
vi.mock("@/lib/ai/voice/summaries", () => ({
  buildSalesPeriodSummary: vi.fn(),
}))
vi.mock("@/lib/leaderboard/sales", () => ({ computeSalesLeaderboard: vi.fn() }))
vi.mock("@/lib/leaderboard/mtm", () => ({ computeMtmLeaderboard: vi.fn() }))
vi.mock("@/lib/leaderboard/tickets", () => ({ computeTicketsLeaderboard: vi.fn() }))
vi.mock("@/lib/leaderboard/projects", () => ({ computeProjectsLeaderboard: vi.fn() }))
vi.mock("@/lib/leaderboard/tasks", () => ({ computeTasksLeaderboard: vi.fn() }))
vi.mock("@/lib/leaderboard/config-loader", () => ({
  loadLeaderboardConfig: vi.fn().mockResolvedValue({
    mtmWeights: { task: 0.5, photo: 0.3, route: 0.2 },
    statusThresholds: { exceeding: 110, on_track: 90, behind: 70, at_risk: 50 },
  }),
}))

import { prisma } from "@/lib/prisma"
import { readSection } from "@/lib/ai/voice/section-reader"
import { buildSalesPeriodSummary } from "@/lib/ai/voice/summaries"
import { computeTasksLeaderboard } from "@/lib/leaderboard/tasks"
import {
  executeChatAnalyticsTool,
  loadChatAnalyticsTimezone,
  type ChatAnalyticsContext,
} from "@/lib/ai/chat-analytics-executor"

const NOW = new Date("2026-08-11T12:34:56.000Z")

function context(overrides: Partial<ChatAnalyticsContext> = {}): ChatAnalyticsContext {
  return {
    orgId: "org-1",
    userId: "u-admin",
    role: "admin",
    timezone: "Asia/Baku",
    now: NOW,
    org: {
      plan: "starter",
      addons: ["ai"],
      modules: { crm: true, sales: true, support: true, mtm: true, finance: true, analytics: true },
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.user.findMany).mockResolvedValue([] as never)
  vi.mocked(readSection).mockResolvedValue({
    section: "leads",
    total: 2,
    open: 2,
    byStatus: [{ status: "new", count: 2 }],
    byPerson: null,
    unassigned: null,
    overdue: null,
    money: null,
    periodApplied: null,
    unavailable: [],
  })
  vi.mocked(buildSalesPeriodSummary).mockResolvedValue({
    periodLabel: "2026-08-11",
    from: "2026-08-10T20:00:00.000Z",
    to: "2026-08-11T12:34:55.999Z",
    wonCount: 2,
    lostCount: 0,
    money: { amount: 4000, currency: "AZN", mixedCurrencies: false },
    wonDealsWithoutHistory: 0,
  })
  vi.mocked(computeTasksLeaderboard).mockResolvedValue([])
})

describe("chat analytics executor", () => {
  it("resolves user timezone, then organization timezone, then UTC", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ timezone: "Asia/Baku" } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { timezone: "Europe/Warsaw" } } as never)
    expect(await loadChatAnalyticsTimezone("org-1", "u-1")).toBe("Asia/Baku")

    vi.mocked(prisma.user.findFirst).mockResolvedValue({ timezone: null } as never)
    expect(await loadChatAnalyticsTimezone("org-1", "u-1")).toBe("Europe/Warsaw")

    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as never)
    expect(await loadChatAnalyticsTimezone("org-1", "u-1")).toBe("UTC")
  })

  it("does not silently change report boundaries to UTC when the timezone lookup fails", async () => {
    vi.mocked(prisma.user.findFirst).mockRejectedValueOnce(new Error("database unavailable"))
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as never)
    await expect(loadChatAnalyticsTimezone("org-1", "u-1")).rejects.toThrow("database unavailable")
  })

  it("returns an exact today count with metric field and Baku half-open bounds", async () => {
    const result = await executeChatAnalyticsTool("get_crm_period_report", {
      metric: "leads_created",
      period: "today",
    }, context())

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({
      metric: "leads_created",
      value: 2,
      basisField: "Lead.createdAt",
      period: {
        timezone: "Asia/Baku",
        fromInclusive: "2026-08-10T20:00:00.000Z",
        toExclusive: NOW.toISOString(),
      },
    })
    expect(readSection).toHaveBeenCalledWith(
      "org-1",
      "leads",
      NOW,
      "status",
      { from: new Date("2026-08-10T20:00:00.000Z"), toExclusive: NOW },
    )
  })

  it("denies a sales metric when the module is disabled before reading data", async () => {
    const result = await executeChatAnalyticsTool("get_crm_period_report", {
      metric: "leads_created",
      period: "today",
    }, context({ org: { plan: "starter", modules: { crm: true, sales: false } } }))
    expect(result.success).toBe(false)
    expect(result.error).toContain("sales")
    expect(readSection).not.toHaveBeenCalled()
  })

  it("passes the exact exclusive sales boundary to the shared transition summary", async () => {
    const result = await executeChatAnalyticsTool("get_crm_period_report", {
      metric: "sales_won",
      period: "today",
    }, context())

    expect(result.success).toBe(true)
    expect(buildSalesPeriodSummary).toHaveBeenCalledWith(
      "org-1",
      new Date("2026-08-10T20:00:00.000Z"),
      NOW,
      "2026-08-11",
    )
  })

  it("denies a metric the caller role cannot read", async () => {
    const result = await executeChatAnalyticsTool("get_crm_period_report", {
      metric: "sales_won",
      period: "today",
    }, context({ role: "ticketing" }))
    expect(result.success).toBe(false)
    expect(result.error).toContain("role")
    expect(buildSalesPeriodSummary).not.toHaveBeenCalled()
  })

  it("does not expose organization-wide totals or rankings to non-manager roles", async () => {
    const report = await executeChatAnalyticsTool("get_crm_period_report", {
      metric: "leads_created",
      period: "today",
    }, context({ role: "sales" }))
    const ranking = await executeChatAnalyticsTool("get_crm_ranking", {
      metric: "created_leads",
      period: "today",
      direction: "top",
    }, context({ role: "sales" }))

    expect(report.success).toBe(false)
    expect(report.error).toContain("manager")
    expect(ranking.success).toBe(false)
    expect(ranking.error).toContain("manager")
    expect(readSection).not.toHaveBeenCalled()
    expect(prisma.lead.groupBy).not.toHaveBeenCalled()
  })

  it("sorts top and bottom recorded task participants and discloses zero-population limits", async () => {
    vi.mocked(prisma.task.groupBy).mockResolvedValue([
      { assignedTo: "u-1", _count: { _all: 5 } },
      { assignedTo: "u-2", _count: { _all: 2 } },
    ] as never)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u-1", name: "A" },
      { id: "u-2", name: "B" },
    ] as never)

    const top = await executeChatAnalyticsTool("get_crm_ranking", {
      metric: "completed_tasks", period: "this_month", direction: "top", limit: 1,
    }, context())
    const bottom = await executeChatAnalyticsTool("get_crm_ranking", {
      metric: "completed_tasks", period: "this_month", direction: "bottom", limit: 1,
    }, context())

    expect(top.data?.rows).toEqual([{ name: "A", count: 5 }])
    expect(bottom.data?.rows).toEqual([{ name: "B", count: 2 }])
    expect(bottom.data?.absoluteLeast).toBe(false)
    expect(JSON.stringify(bottom.data?.caveats)).toContain("zero matching events")
  })

  it("counts distinct leads reached by answered outbound human calls", async () => {
    vi.mocked(prisma.callLog.groupBy).mockResolvedValue([
      { userId: "u-1", leadId: "l-1", _count: { _all: 2 } },
      { userId: "u-1", leadId: "l-2", _count: { _all: 1 } },
      { userId: "u-2", leadId: "l-3", _count: { _all: 1 } },
    ] as never)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u-1", name: "A" },
      { id: "u-2", name: "B" },
    ] as never)

    const result = await executeChatAnalyticsTool("get_crm_ranking", {
      metric: "answered_leads_by_call", period: "today", direction: "top",
    }, context())
    expect(result.data?.rows).toEqual([{ name: "A", count: 2 }, { name: "B", count: 1 }])
    expect(result.data?.basisField).toContain("CallLog.startedAt")
    expect(JSON.stringify(result.data?.caveats)).toContain("does not claim complete contact coverage")
    expect(prisma.callLog.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ["userId", "leadId"],
      where: expect.objectContaining({
        direction: "outbound",
        callMode: "human",
        wasAnswered: true,
      }),
    }))
  })

  it("explains KPI Arena and localized visible sections, but never invents an unknown section", async () => {
    for (const section of [
      "KPI Arena",
      "leads",
      "коммерческие предложения",
      "Конструктор отчётов",
      "MTM fəaliyyət jurnalı",
    ]) {
      const result = await executeChatAnalyticsTool("explain_crm_section", { section }, context())
      expect(result.success, section).toBe(true)
      expect(result.data?.source).toBe("LeadDrive server section guide")
    }
    const unknown = await executeChatAnalyticsTool("explain_crm_section", { section: "magic-room" }, context())
    expect(unknown.success).toBe(false)
    expect(unknown.error).toContain("No verified product guide")
  })

  it("denies section help when its module or role permission is unavailable", async () => {
    const disabled = await executeChatAnalyticsTool(
      "explain_crm_section",
      { section: "MTM fəaliyyət jurnalı" },
      context({
        role: "superadmin",
        org: { plan: "starter", modules: { crm: true, sales: true, analytics: true, mtm: false } },
      }),
    )
    expect(disabled.success).toBe(false)
    expect(disabled.error).toContain("not enabled or permitted")

    const denied = await executeChatAnalyticsTool(
      "explain_crm_section",
      { section: "leads" },
      context({ role: "ticketing" }),
    )
    expect(denied.success).toBe(false)
    expect(denied.error).toContain("role")
  })

  it("denies KPI Arena groups outside the caller's visibility", async () => {
    const result = await executeChatAnalyticsTool("get_kpi_arena", {
      group: "tickets", period: "month",
    }, context({ role: "sales" }))
    expect(result.success).toBe(false)
    expect(result.error).toContain("role")
  })

  it("passes the authenticated timezone into KPI Arena calendar engines", async () => {
    const result = await executeChatAnalyticsTool("get_kpi_arena", {
      group: "tasks", period: "month", direction: "top", sortBy: "kpi",
    }, context())

    expect(result.success).toBe(true)
    expect(computeTasksLeaderboard).toHaveBeenCalledWith(
      "org-1",
      "month",
      NOW,
      expect.any(Object),
      "Asia/Baku",
    )
    expect(result.data?.timezone).toBe("Asia/Baku")
  })

  it("returns explicit unavailable instead of an estimated result when a data source fails", async () => {
    vi.mocked(readSection).mockRejectedValueOnce(new Error("database unavailable"))
    const result = await executeChatAnalyticsTool("get_crm_period_report", {
      metric: "leads_created", period: "today",
    }, context())
    expect(result.success).toBe(false)
    expect(result.error).toBe("Verified CRM analytics are temporarily unavailable.")
    expect(result.data).toBeUndefined()
  })
})
