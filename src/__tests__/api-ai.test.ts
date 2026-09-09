import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const { anthropicCreate, applyRecordFilterMock } = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  applyRecordFilterMock: vi.fn(async (
    _orgId: string,
    _userId: string,
    _role: string,
    _entityType: string,
    where: Record<string, unknown>,
  ) => where),
}))

// ── Mocks ────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiInteractionLog: { create: vi.fn() },
    activity: { findMany: vi.fn() },
    deal: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    company: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    ticket: { count: vi.fn() },
    lead: { count: vi.fn(), findFirst: vi.fn() },
    aiChatSession: { findMany: vi.fn() },
    aiAgentConfig: { findMany: vi.fn(), create: vi.fn() },
    agentHandoff: { create: vi.fn() },
    product: { findMany: vi.fn() },
    contact: { findFirst: vi.fn(), findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
  requireAuth: vi.fn(),
  getOrgModuleContext: vi.fn().mockResolvedValue({
    plan: "starter",
    addons: ["ai"],
    modules: { ai: true, crm: true, sales: true, support: true, ai_smart_search: false },
  }),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
  RATE_LIMIT_CONFIG: { ai: { maxRequests: 20, windowMs: 60000 } },
}))

vi.mock("@anthropic-ai/sdk", () => {
  function MockAnthropic() {
    return { messages: { create: anthropicCreate } }
  }
  return {
    default: MockAnthropic,
  }
})

vi.mock("@/lib/ai/tools", () => ({
  CRM_TOOLS: [],
  TOOL_META: {},
  getEnabledTools: vi.fn().mockReturnValue([]),
  getEnabledToolsForAgent: vi.fn().mockReturnValue([]),
  filterToolsByTenantModules: vi.fn((tools) => tools),
}))

vi.mock("@/lib/ai/tool-executor", () => ({
  executeTool: vi.fn(),
}))

vi.mock("@/lib/ai/chat-analytics-executor", () => ({
  executeChatAnalyticsTool: vi.fn(),
  loadChatAnalyticsTimezone: vi.fn().mockResolvedValue("Asia/Baku"),
}))

vi.mock("@/lib/ai/predictive", () => ({
  predictDealWin: vi.fn().mockResolvedValue({ winProbability: 50, confidence: 60, riskFactors: [] }),
}))

vi.mock("@/lib/sharing-rules", () => ({ applyRecordFilter: applyRecordFilterMock }))

vi.mock("@/lib/ai/next-best-action", () => ({
  generateNextBestActions: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/lib/ai/agent-router", () => ({
  routeToAgent: vi.fn().mockResolvedValue({
    agent: null,
    intent: "general",
    confidence: 0.9,
    isHandoff: false,
  }),
}))

// Partial, not wholesale: a full mock silently drops every other export, so
// the route 500s the day it imports a new constant (COMPANY_LEGAL_NAME did
// exactly that). Keep the real module and override only what the test tunes.
vi.mock("@/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/constants")>()),
  PAGE_SIZE: { DEFAULT: 50, INBOX: 100 },
}))

// ── Imports ──────────────────────────────────────────────

import { POST as POST_AI } from "@/app/api/v1/ai/route"
import { POST as POST_CHAT } from "@/app/api/v1/ai/chat/route"
import { POST as POST_RECOMMEND } from "@/app/api/v1/ai/recommend/route"
import { GET as GET_NEXT_ACTIONS } from "@/app/api/v1/ai/next-actions/route"
import { GET as GET_SESSIONS } from "@/app/api/v1/ai-sessions/route"
import { GET as GET_CONFIGS, POST as POST_CONFIGS } from "@/app/api/v1/ai-configs/route"
import { prisma } from "@/lib/prisma"
import { getSession, getOrgId, requireAuth } from "@/lib/api-auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { generateNextBestActions } from "@/lib/ai/next-best-action"
import { predictDealWin } from "@/lib/ai/predictive"
import { executeChatAnalyticsTool, loadChatAnalyticsTimezone } from "@/lib/ai/chat-analytics-executor"

const SESSION = {
  orgId: "org-1",
  userId: "user-1",
  role: "admin",
  email: "a@b.com",
  name: "Test",
}

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(executeChatAnalyticsTool).mockReset()
  vi.mocked(loadChatAnalyticsTimezone).mockReset().mockResolvedValue("Asia/Baku")
  anthropicCreate.mockReset()
  anthropicCreate.mockResolvedValue({
    content: [{ type: "text", text: '{"score":75,"sentiment":"POSITIVE","emoji":"😊","trend":"stable","risk":"LOW","confidence":80,"summary":"Good"}' }],
    usage: { input_tokens: 100, output_tokens: 50 },
  })
  vi.mocked(checkRateLimit).mockReturnValue(true)
  // ai-configs routes use requireAuth; default to a valid admin auth. Auth-failure
  // tests override requireAuth to return an error NextResponse.
  vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
  vi.mocked(prisma.contact.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.company.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.deal.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue(null as never)
})

// ---------------------------------------------------------------------------
// POST /api/v1/ai  (unified Da Vinci endpoint)
// ---------------------------------------------------------------------------
describe("POST /api/v1/ai", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never)

    const res = await POST_AI(
      makeRequest("http://localhost:3000/api/v1/ai", {
        method: "POST",
        body: JSON.stringify({ action: "sentiment", companyId: "c1" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 429 when rate-limited", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)

    const res = await POST_AI(
      makeRequest("http://localhost:3000/api/v1/ai", {
        method: "POST",
        body: JSON.stringify({ action: "sentiment", companyId: "c1" }),
      }),
    )
    expect(res.status).toBe(429)
  })

  it("returns 400 when action is missing", async () => {
    const res = await POST_AI(
      makeRequest("http://localhost:3000/api/v1/ai", {
        method: "POST",
        body: JSON.stringify({ companyId: "c1" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when neither companyId nor leadId is provided", async () => {
    const res = await POST_AI(
      makeRequest("http://localhost:3000/api/v1/ai", {
        method: "POST",
        body: JSON.stringify({ action: "sentiment" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for unknown action", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: "c1",
      name: "Acme",
      contacts: [],
      deals: [],
      activities: [],
    } as any)

    const res = await POST_AI(
      makeRequest("http://localhost:3000/api/v1/ai", {
        method: "POST",
        body: JSON.stringify({ action: "unknown_action", companyId: "c1" }),
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("Unknown action")
  })

  it("returns 404 when company not found", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(null)

    const res = await POST_AI(
      makeRequest("http://localhost:3000/api/v1/ai", {
        method: "POST",
        body: JSON.stringify({ action: "sentiment", companyId: "nonexistent" }),
      }),
    )
    expect(res.status).toBe(404)
  })

  it("returns sentiment fallback when ANTHROPIC_API_KEY is missing", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: "c1",
      name: "Acme",
      contacts: [{ fullName: "John", phone: "+994551234567", email: "john@acme.com" }],
      deals: [],
      activities: [{ type: "call", subject: "Intro", createdAt: new Date() }],
    } as any)

    const res = await POST_AI(
      makeRequest("http://localhost:3000/api/v1/ai", {
        method: "POST",
        body: JSON.stringify({ action: "sentiment", companyId: "c1" }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.score).toBeDefined()
    expect(body.data.sentiment).toBeDefined()

    process.env.ANTHROPIC_API_KEY = originalKey
  })

  it("returns tasks fallback when ANTHROPIC_API_KEY is missing", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: "c1",
      name: "Acme",
      industry: "IT",
      website: "acme.com",
      contacts: [{ fullName: "John", phone: "+994551234567", email: "john@acme.com" }],
      deals: [],
      activities: [],
    } as any)

    const res = await POST_AI(
      makeRequest("http://localhost:3000/api/v1/ai", {
        method: "POST",
        body: JSON.stringify({ action: "tasks", companyId: "c1" }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.tasks).toHaveLength(4)
    expect(body.data.strategy).toBeDefined()

    process.env.ANTHROPIC_API_KEY = originalKey
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/ai/chat
// ---------------------------------------------------------------------------
describe("POST /api/v1/ai/chat", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any)

    const res = await POST_CHAT(
      makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Hello" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when message is empty", async () => {
    const res = await POST_CHAT(
      makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: "" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 503 when ANTHROPIC_API_KEY is not set", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    // Need to mock counts for the CRM context gathering
    vi.mocked(prisma.deal.count).mockResolvedValue(5)
    vi.mocked(prisma.company.count).mockResolvedValue(10)
    vi.mocked(prisma.ticket.count).mockResolvedValue(3)
    vi.mocked(prisma.lead.count).mockResolvedValue(8)
    vi.mocked(prisma.deal.findMany).mockResolvedValue([])

    const res = await POST_CHAT(
      makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Hello" }),
      }),
    )
    expect(res.status).toBe(503)

    process.env.ANTHROPIC_API_KEY = originalKey
  })

  it("does not enrich a same-tenant deal hidden by record sharing", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.mocked(requireAuth).mockResolvedValue({ ...SESSION, role: "sales" } as never)
    applyRecordFilterMock.mockResolvedValueOnce({
      id: "hidden-deal",
      organizationId: "org-1",
      OR: [{ assignedTo: "user-1" }, { assignedTo: null }],
    })
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce(null)
    anthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Bu sövdələşməni görmək mümkün deyil." }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })

    try {
      const res = await POST_CHAT(makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          message: "Bu sövdələşmə barədə nə bilirsən?",
          locale: "az",
          context: { url: "/deals/hidden-deal", title: "Hidden" },
        }),
      }))
      expect(res.status).toBe(200)
      expect(applyRecordFilterMock).toHaveBeenCalledWith(
        "org-1",
        "user-1",
        "sales",
        "deal",
        { id: "hidden-deal", organizationId: "org-1" },
      )
      expect(predictDealWin).not.toHaveBeenCalled()
      expect(anthropicCreate.mock.calls[0][0].system).not.toContain("AI Insights for current deal")
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })

  it("forces a period tool and returns a deterministic value instead of the model's fabricated number", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.mocked(executeChatAnalyticsTool).mockResolvedValue({
      success: true,
      data: {
        kind: "crm_period_report",
        metric: "leads_created",
        metricDefinition: "Lead records created during the reporting period",
        basisField: "Lead.createdAt",
        value: 2,
        period: { label: "2026-08-11", timezone: "Asia/Baku" },
        caveats: [],
      },
    })
    anthropicCreate
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use",
          id: "tool-1",
          name: "get_crm_period_report",
          input: { metric: "leads_created", period: "today" },
        }],
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      // The model is deliberately wrong; the server evidence renderer wins.
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Сегодня было 30–50 лидов." }],
        usage: { input_tokens: 30, output_tokens: 10 },
      })

    try {
      const res = await POST_CHAT(makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Сколько лидов было за сегодня?", locale: "ru" }),
      }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.reply).toContain("созданные лиды — 2")
      expect(body.data.reply).not.toContain("Lead.createdAt")
      expect(body.data.reply).not.toContain("30")
      expect(body.data.reply).not.toContain("50")
      expect(body.data.analyticsEvidence.value).toBe(2)
      expect(anthropicCreate.mock.calls[0][0]).toMatchObject({
        tool_choice: { type: "tool", name: "get_crm_period_report" },
      })
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })

  it("treats a natural 'most tasks' question as one verified ranking request", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.mocked(executeChatAnalyticsTool).mockResolvedValue({
      success: true,
      data: {
        kind: "crm_ranking",
        metric: "completed_tasks",
        direction: "top",
        basisField: "Task.completedAt + assignedTo",
        period: { label: "2026-08-01 — 2026-08-12", timezone: "Asia/Baku" },
        rows: [{ name: "Verified Manager", count: 4 }],
        caveats: [],
      },
    })
    anthropicCreate
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use",
          id: "tool-1",
          name: "get_crm_ranking",
          input: { metric: "completed_tasks", direction: "top", period: "this_month", limit: 5 },
        }],
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Другой сотрудник выполнил 40 задач." }],
        usage: { input_tokens: 30, output_tokens: 10 },
      })

    try {
      const res = await POST_CHAT(makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          message: "Кто выполнил больше всего задач в этом месяце?",
          locale: "ru",
        }),
      }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.reply).toContain("Verified Manager — 4")
      expect(body.data.reply).not.toContain("40")
      expect(body.data.reply).not.toContain("отдельно")
      expect(body.data.analyticsEvidence.kind).toBe("crm_ranking")
      expect(anthropicCreate.mock.calls[0][0]).toMatchObject({
        tool_choice: { type: "tool", name: "get_crm_ranking" },
      })
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })

  it("rejects a model-chosen analytics scope that is not bound to the user request", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.mocked(executeChatAnalyticsTool).mockResolvedValue({
      success: true,
      data: {
        kind: "crm_period_report",
        metric: "deals_created",
        metricDefinition: "Deal records created during the reporting period",
        basisField: "Deal.createdAt",
        value: 4,
        period: { label: "2026-08-01 — 2026-08-10", timezone: "Asia/Baku" },
        caveats: [],
      },
    })
    anthropicCreate
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use",
          id: "tool-1",
          name: "get_crm_period_report",
          input: { metric: "deals_created", period: "custom", dateFrom: "2026-08-01", dateTo: "2026-08-10" },
        }],
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Было примерно 40 сделок." }],
        usage: { input_tokens: 30, output_tokens: 10 },
      })

    try {
      const res = await POST_CHAT(makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Покажи мне сводку", locale: "ru" }),
      }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.reply).toContain("Не удалось проверить")
      expect(body.data.reply).not.toContain("4")
      expect(body.data.reply).not.toContain("Deal.createdAt")
      expect(body.data.reply).not.toContain("40")
      expect(body.data.analyticsEvidence).toBeUndefined()
      expect(executeChatAnalyticsTool).not.toHaveBeenCalled()
      expect(anthropicCreate.mock.calls[0][0]).not.toHaveProperty("tool_choice")
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })

  it("keeps numeric evidence authoritative when a later section guide also succeeds", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.mocked(executeChatAnalyticsTool)
      .mockResolvedValueOnce({
        success: true,
        data: {
          kind: "crm_period_report",
          metric: "leads_created",
          metricDefinition: "Lead records created during the reporting period",
          basisField: "Lead.createdAt",
          value: 2,
          period: { label: "2026-08-11", timezone: "Asia/Baku" },
          caveats: [],
        },
      })
    anthropicCreate
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use",
          id: "tool-1",
          name: "get_crm_period_report",
          input: { metric: "leads_created", period: "today" },
        }],
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use",
          id: "tool-2",
          name: "explain_crm_section",
          input: { section: "leaderboard" },
        }],
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Сегодня было 30–50 лидов." }],
        usage: { input_tokens: 30, output_tokens: 10 },
      })

    try {
      const res = await POST_CHAT(makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Сколько лидов было за сегодня?", locale: "ru" }),
      }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.reply).toContain("созданные лиды — 2")
      expect(body.data.reply).not.toContain("Lead.createdAt")
      expect(body.data.reply).not.toContain("30")
      expect(body.data.reply).not.toContain("50")
      expect(body.data.analyticsEvidence.kind).toBe("crm_period_report")
      expect(body.data.analyticsEvidence.value).toBe(2)
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })

  it("does not let a later guide success reopen a failed numeric report", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.mocked(executeChatAnalyticsTool)
      .mockResolvedValueOnce({
        success: false,
        error: "Verified CRM analytics are temporarily unavailable.",
      })
    anthropicCreate
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use",
          id: "tool-1",
          name: "get_crm_period_report",
          input: { metric: "leads_created", period: "today" },
        }],
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use",
          id: "tool-2",
          name: "explain_crm_section",
          input: { section: "leaderboard" },
        }],
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Сегодня было 40 лидов." }],
        usage: { input_tokens: 30, output_tokens: 10 },
      })

    try {
      const res = await POST_CHAT(makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Сколько лидов было за сегодня?", locale: "ru" }),
      }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.reply).toContain("Не удалось проверить")
      expect(body.data.reply).not.toContain("40")
      expect(body.data.analyticsEvidence).toBeUndefined()
      expect(body.data.queryError).toContain("unavailable")
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })

  it("fails closed when a model-chosen analytics call fails for an unrecognized phrasing", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.mocked(executeChatAnalyticsTool).mockResolvedValue({
      success: false,
      error: "Verified CRM analytics are temporarily unavailable.",
    })
    anthropicCreate
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use",
          id: "tool-1",
          name: "get_crm_period_report",
          input: { metric: "deals_created", period: "this_month" },
        }],
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Полагаю, было 40 сделок." }],
        usage: { input_tokens: 30, output_tokens: 10 },
      })

    try {
      const res = await POST_CHAT(makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Покажи мне сводку", locale: "ru" }),
      }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.reply).toContain("Не удалось проверить")
      expect(body.data.reply).not.toContain("40")
      expect(body.data.analyticsEvidence).toBeUndefined()
      expect(body.data.queryError).toContain("unavailable")
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })

  it("fails closed when the model ignores a forced analytics tool", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    anthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Сегодня было 40 лидов." }],
      usage: { input_tokens: 20, output_tokens: 10 },
    })

    try {
      const res = await POST_CHAT(makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Сколько лидов было за сегодня?", locale: "ru" }),
      }))
      const body = await res.json()
      expect(body.data.reply).toContain("Не удалось проверить")
      expect(body.data.reply).not.toContain("40")
      expect(body.data.queryError).toContain("unavailable")
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })

  it("fails closed when the analytics tool itself reports unavailable", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.mocked(executeChatAnalyticsTool).mockResolvedValue({
      success: false,
      error: "Verified CRM analytics are temporarily unavailable.",
    })
    anthropicCreate
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use",
          id: "tool-1",
          name: "get_crm_period_report",
          input: { metric: "leads_created", period: "today" },
        }],
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Наверное, около 30." }],
        usage: { input_tokens: 30, output_tokens: 10 },
      })

    try {
      const res = await POST_CHAT(makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Сколько лидов было за сегодня?", locale: "ru" }),
      }))
      const body = await res.json()
      expect(body.data.reply).toContain("Не удалось проверить")
      expect(body.data.reply).not.toContain("30")
      expect(body.data.analyticsEvidence).toBeUndefined()
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })

  it("fails closed before calling the model when timezone preferences cannot be read", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.mocked(loadChatAnalyticsTimezone).mockRejectedValueOnce(new Error("database unavailable"))

    try {
      const res = await POST_CHAT(makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Сколько лидов было за сегодня?", locale: "ru" }),
      }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.reply).toContain("Не удалось проверить")
      expect(body.data.queryError).toContain("unavailable")
      expect(anthropicCreate).not.toHaveBeenCalled()
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })

  it("keeps a model-translated section explanation grounded in verified guide evidence", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.mocked(executeChatAnalyticsTool).mockResolvedValue({
      success: true,
      data: {
        kind: "crm_section_guide",
        section: "leaderboard",
        whatItIs: "Проверенное русское описание KPI-арены.",
        howItWorks: "Проверенная русская механика.",
        source: "LeadDrive server section guide",
      },
    })
    anthropicCreate
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use",
          id: "tool-1",
          name: "explain_crm_section",
          input: { section: "leaderboard" },
        }],
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "KPI Arena əməkdaşların nəticələrini göstərən yoxlanmış reytinq bölməsidir." }],
        usage: { input_tokens: 30, output_tokens: 10 },
      })

    try {
      const res = await POST_CHAT(makeRequest("http://localhost:3000/api/v1/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: "KPI Arena nədir?", locale: "az" }),
      }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.reply).toContain("əməkdaşların nəticələrini")
      expect(body.data.reply).not.toContain("Проверенное")
      expect(body.data.analyticsEvidence.source).toBe("LeadDrive server section guide")
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey
    }
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/ai/recommend
// ---------------------------------------------------------------------------
describe("POST /api/v1/ai/recommend", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)

    const res = await POST_RECOMMEND(
      makeRequest("http://localhost:3000/api/v1/ai/recommend", {
        method: "POST",
        body: JSON.stringify({ dealId: "d1" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns empty recommendations when no products exist", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.product.findMany).mockResolvedValue([])

    const res = await POST_RECOMMEND(
      makeRequest("http://localhost:3000/api/v1/ai/recommend", {
        method: "POST",
        body: JSON.stringify({ dealId: "d1" }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.recommendations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/ai/next-actions
// ---------------------------------------------------------------------------
describe("GET /api/v1/ai/next-actions", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never)

    const res = await GET_NEXT_ACTIONS(
      makeRequest("http://localhost:3000/api/v1/ai/next-actions"),
    )
    expect(res.status).toBe(401)
  })

  it("returns next best actions on success", async () => {
    vi.mocked(generateNextBestActions).mockResolvedValue([
      { title: "Follow up with Acme", score: 90, type: "call", entityType: "deal", entityId: "d1" },
    ] as any)

    const res = await GET_NEXT_ACTIONS(
      makeRequest("http://localhost:3000/api/v1/ai/next-actions"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
  })

  it("passes limit query param to generateNextBestActions", async () => {
    vi.mocked(generateNextBestActions).mockResolvedValue([])

    await GET_NEXT_ACTIONS(
      makeRequest("http://localhost:3000/api/v1/ai/next-actions?limit=5"),
    )

    expect(generateNextBestActions).toHaveBeenCalledWith("org-1", "user-1", 5, {
      role: "admin",
      deals: true,
      leads: true,
      tasks: true,
      tickets: true,
    })
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/ai-sessions
// ---------------------------------------------------------------------------
describe("GET /api/v1/ai-sessions", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)

    const res = await GET_SESSIONS(
      makeRequest("http://localhost:3000/api/v1/ai-sessions"),
    )
    expect(res.status).toBe(401)
  })

  it("returns sessions list", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.aiChatSession.findMany).mockResolvedValue([
      { id: "s1", name: "Session 1", organizationId: "org-1", createdAt: new Date() },
    ] as any)

    const res = await GET_SESSIONS(
      makeRequest("http://localhost:3000/api/v1/ai-sessions"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.sessions).toHaveLength(1)
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.aiChatSession.findMany).mockRejectedValue(new Error("DB down"))

    const res = await GET_SESSIONS(
      makeRequest("http://localhost:3000/api/v1/ai-sessions"),
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Internal server error")
  })
})

// ---------------------------------------------------------------------------
// GET/POST /api/v1/ai-configs
// ---------------------------------------------------------------------------
describe("GET /api/v1/ai-configs", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)

    const res = await GET_CONFIGS(
      makeRequest("http://localhost:3000/api/v1/ai-configs"),
    )
    expect(res.status).toBe(401)
  })

  it("returns configs list", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.aiAgentConfig.findMany).mockResolvedValue([
      { id: "cfg1", configName: "Sales Agent", organizationId: "org-1" },
    ] as any)

    const res = await GET_CONFIGS(
      makeRequest("http://localhost:3000/api/v1/ai-configs"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.configs).toHaveLength(1)
  })
})

describe("POST /api/v1/ai-configs", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any)

    const res = await POST_CONFIGS(
      makeRequest("http://localhost:3000/api/v1/ai-configs", {
        method: "POST",
        body: JSON.stringify({ configName: "Test Agent" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when configName is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const res = await POST_CONFIGS(
      makeRequest("http://localhost:3000/api/v1/ai-configs", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("creates an AI agent config and returns 201", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.aiAgentConfig.create).mockResolvedValue({
      id: "cfg-new",
      configName: "Support Agent",
      organizationId: "org-1",
      agentType: "support",
    } as any)

    const res = await POST_CONFIGS(
      makeRequest("http://localhost:3000/api/v1/ai-configs", {
        method: "POST",
        body: JSON.stringify({
          configName: "Support Agent",
          agentType: "support",
          model: "claude-haiku-4-5-20251001",
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.configName).toBe("Support Agent")
  })

  it("normalizes comma-separated toolsEnabled into array", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.aiAgentConfig.create).mockResolvedValue({
      id: "cfg2",
      configName: "Agent",
      toolsEnabled: ["crm_create_task", "crm_log_activity"],
    } as any)

    await POST_CONFIGS(
      makeRequest("http://localhost:3000/api/v1/ai-configs", {
        method: "POST",
        body: JSON.stringify({
          configName: "Agent",
          toolsEnabled: "crm_create_task, crm_log_activity",
        }),
      }),
    )

    const call = vi.mocked(prisma.aiAgentConfig.create).mock.calls[0][0] as any
    expect(call.data.toolsEnabled).toEqual(["crm_create_task", "crm_log_activity"])
  })
})
