/**
 * The dead end, reproduced through the real route.
 *
 * On 2026-08-20 a manager asked "yeni neçə lid var" in production. The reply
 * was "CRM məlumatlarını təsdiqləyə bilmədim" and a failed-search card, because
 * the message was forced onto the period report, whose guard refuses every
 * message the server cannot parse a period from. No unit test caught it: the
 * detector was correct, the tool schema was correct, the executor was correct,
 * and the turn still ended with nothing. So these cases drive the route itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const { anthropicCreate, executeVoiceReadToolMock } = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  executeVoiceReadToolMock: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiInteractionLog: { create: vi.fn() },
    deal: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    company: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    ticket: { count: vi.fn().mockResolvedValue(0) },
    lead: { count: vi.fn().mockResolvedValue(0) },
    contact: { findMany: vi.fn().mockResolvedValue([]) },
    organization: { findUnique: vi.fn().mockResolvedValue(null) },
    agentHandoff: { create: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
  requireAuth: vi.fn(),
  getOrgModuleContext: vi.fn().mockResolvedValue({
    plan: "pro",
    addons: ["ai"],
    modules: { ai: true, crm: true, sales: true, support: true, leads: true, tasks: true, ai_smart_search: true },
  }),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
  RATE_LIMIT_CONFIG: { ai: { maxRequests: 20, windowMs: 60000 } },
}))

vi.mock("@anthropic-ai/sdk", () => ({
  default: function MockAnthropic() {
    return { messages: { create: anthropicCreate } }
  },
}))

vi.mock("@/lib/ai/tools", () => ({
  CRM_TOOLS: [],
  TOOL_META: {},
  getEnabledTools: vi.fn().mockReturnValue([]),
  getEnabledToolsForAgent: vi.fn().mockReturnValue([]),
  filterToolsByTenantModules: vi.fn((tools) => tools),
}))

vi.mock("@/lib/ai/tool-executor", () => ({ executeTool: vi.fn() }))
vi.mock("@/lib/ai/voice/execute-read-tool", () => ({ executeVoiceReadTool: executeVoiceReadToolMock }))
vi.mock("@/lib/ai/chat-analytics-executor", () => ({
  executeChatAnalyticsTool: vi.fn(),
  loadChatAnalyticsTimezone: vi.fn().mockResolvedValue("Asia/Baku"),
}))
vi.mock("@/lib/ai/predictive", () => ({
  predictDealWin: vi.fn().mockResolvedValue({ winProbability: 50, confidence: 60, riskFactors: [] }),
}))
vi.mock("@/lib/ai/next-best-action", () => ({ generateNextBestActions: vi.fn().mockResolvedValue([]) }))
vi.mock("@/lib/sharing-rules", () => ({ applyRecordFilter: vi.fn(async (_o, _u, _r, _e, where) => where) }))
vi.mock("@/lib/ai/agent-router", () => ({
  routeToAgent: vi.fn().mockResolvedValue({ agent: null, intent: "general", confidence: 0.9, isHandoff: false }),
}))

import { POST as POST_CHAT } from "@/app/api/v1/ai/chat/route"
import { getSession, getOrgId, requireAuth } from "@/lib/api-auth"
import { executeChatAnalyticsTool } from "@/lib/ai/chat-analytics-executor"

const SESSION = { orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Test" }

function ask(message: string, locale = "az") {
  return POST_CHAT(new NextRequest(new URL("http://localhost:3000/api/v1/ai/chat"), {
    method: "POST",
    body: JSON.stringify({ message, locale }),
  }))
}

/** Round 0 answers with the tool call the route forced; round 1 speaks. */
function respondWithForcedToolThen(text: string) {
  anthropicCreate.mockImplementation(async (params: { tool_choice?: { name: string } }) => {
    const forced = params.tool_choice?.name
    if (forced) {
      return {
        content: [{ type: "tool_use", id: "tu_1", name: forced, input: forced === "describe_section" ? { section: "tickets" } : {} }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }
    }
    return { content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = "test-key"
  vi.mocked(getSession).mockResolvedValue(SESSION as never)
  vi.mocked(getOrgId).mockResolvedValue("org-1" as never)
  vi.mocked(requireAuth).mockResolvedValue(SESSION as never)
  executeVoiceReadToolMock.mockResolvedValue({ body: { data: { total: 57, byStatus: [{ status: "new", count: 48 }] } } })
})

describe("a state question reaches a snapshot tool", () => {
  it("grounds 'yeni neçə lid var' on the lead snapshot and keeps the model's answer", async () => {
    respondWithForcedToolThen("Hazırda 57 lid var, onlardan 48-i yenidir.")
    const res = await ask("yeni neçə lid var")
    const body = await res.json()

    expect(anthropicCreate.mock.calls[0][0].tool_choice).toEqual({ type: "tool", name: "get_leads_summary" })
    expect(executeVoiceReadToolMock).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "get_leads_summary" }),
    )
    expect(body.data.reply).toBe("Hazırda 57 lid var, onlardan 48-i yenidir.")
    expect(body.data.queryError).toBeUndefined()
    // The analytics path must not have been involved at all.
    expect(executeChatAnalyticsTool).not.toHaveBeenCalled()
  })

  it("refuses to speak when the snapshot itself was refused", async () => {
    executeVoiceReadToolMock.mockResolvedValue({ body: { data: { error: "ACCESS_SCOPE_UNAVAILABLE" } } })
    respondWithForcedToolThen("Hazırda 57 lid var.")

    const body = await (await ask("yeni neçə lid var")).json()
    expect(body.data.reply).toContain("təsdiqləyə bilmədim")
    expect(body.data.queryError).toBe("Verified CRM data is unavailable.")
  })

  it("still forces the period report when the question carries a period", async () => {
    vi.mocked(executeChatAnalyticsTool).mockResolvedValue({
      success: true,
      data: { kind: "crm_period_report", metric: "leads_created", value: 3, period: { label: "август" } },
    } as never)
    respondWithForcedToolThen("В августе создано 3 лида.")

    await ask("сколько лидов в августе", "ru")
    expect(anthropicCreate.mock.calls[0][0].tool_choice).toEqual({
      type: "tool",
      name: "get_crm_period_report",
    })
  })

  it("asks which period instead of blaming the data on a past-event question", async () => {
    vi.mocked(executeChatAnalyticsTool).mockResolvedValue({
      success: false,
      error: "Verified CRM analytics are unavailable because the requested scope could not be verified.",
    } as never)
    respondWithForcedToolThen("Не могу сказать.")

    const body = await (await ask("сколько лидов создали", "ru")).json()
    expect(body.data.reply).toContain("нужен период")
    expect(body.data.queryError).toBe("This report needs a period.")
  })
})
