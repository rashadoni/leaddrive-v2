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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
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

/**
 * 2026-11-26, Fanumsec: "Hansı sövdələşmələrimiz var" answered "CRM
 * məlumatlarını təsdiqləyə bilmədim" and a failed-search card. Nothing bound
 * the question to a tool, the model reached for the period report on its own,
 * and that call - refused by design, since only a server-bound report counts -
 * replaced the whole answer, with the record tools unused beside it. The same
 * dead end waited behind any "which X do we have" question in any module.
 */
describe("a report the question did not ask for", () => {
  /** Round 0: the model picks `first`; round 1: `second` (or text); then text. */
  function modelPicks(first: { name: string; input: object }, second: { name: string; input: object } | null, text: string) {
    anthropicCreate.mockImplementation(async () => {
      const round = anthropicCreate.mock.calls.length
      const call = round === 1 ? first : round === 2 ? second : null
      if (call) {
        return {
          content: [{ type: "tool_use", id: `tu_${round}`, name: call.name, input: call.input }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }
      }
      return { content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } }
    })
  }

  function toolResultsSentInRound(round: number): Array<{ content: string; is_error?: boolean }> {
    const messages = anthropicCreate.mock.calls[round][0].messages as Array<{ role: string; content: unknown }>
    const last = messages[messages.length - 1]
    return last.content as Array<{ content: string; is_error?: boolean }>
  }

  it("lets the model read the deals after the refusal and keeps its answer", async () => {
    executeVoiceReadToolMock.mockResolvedValue({
      body: { data: { stages: [{ stage: "Təklif", count: 1, deals: [{ name: "Fanum PBX" }] }] } },
    })
    modelPicks(
      { name: "get_crm_period_report", input: { metric: "deals_created", period: "this_month" } },
      { name: "get_pipeline_by_stage", input: {} },
      "Hazırda 1 sövdələşmə var: Fanum PBX, «Təklif» mərhələsində.",
    )

    const body = await (await ask("Hansı sövdələşmələrimiz var")).json()

    expect(anthropicCreate.mock.calls[0][0].tool_choice).toBeUndefined()
    // The refusal reached the model as guidance toward the record tools.
    const refusal = toolResultsSentInRound(1)[0]
    expect(refusal.is_error).toBe(true)
    expect(refusal.content).toContain("Read the records with the other read tools")
    expect(executeChatAnalyticsTool).not.toHaveBeenCalled()
    expect(executeVoiceReadToolMock).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "get_pipeline_by_stage" }),
    )
    expect(body.data.reply).toBe("Hazırda 1 sövdələşmə var: Fanum PBX, «Təklif» mərhələsində.")
    expect(body.data.queryError).toBeUndefined()
  })

  it("works the same for another module", async () => {
    executeVoiceReadToolMock.mockResolvedValue({ body: { data: { boards: [{ name: "Satış", open: 4 }] } } })
    modelPicks(
      { name: "get_crm_ranking", input: { metric: "tasks_completed", direction: "desc" } },
      { name: "get_boards_summary", input: {} },
      "Сейчас открыто 4 задачи на доске «Satış».",
    )

    const body = await (await ask("Какие у нас задачи", "ru")).json()
    expect(body.data.reply).toBe("Сейчас открыто 4 задачи на доске «Satış».")
    expect(body.data.queryError).toBeUndefined()
  })

  it("still refuses to speak when the model read nothing after the refusal", async () => {
    modelPicks(
      { name: "get_crm_period_report", input: { metric: "deals_created", period: "this_month" } },
      null,
      "Bu ay 12 sövdələşmə var.",
    )

    const body = await (await ask("Hansı sövdələşmələrimiz var")).json()
    expect(body.data.reply).toContain("təsdiqləyə bilmədim")
    expect(body.data.reply).not.toContain("12")
    expect(body.data.queryError).toBe("Verified CRM data is unavailable.")
  })

  it("still refuses to speak when the read after the refusal was itself refused", async () => {
    executeVoiceReadToolMock.mockResolvedValue({ body: { data: { error: "ACCESS_SCOPE_UNAVAILABLE" } } })
    modelPicks(
      { name: "get_crm_period_report", input: { metric: "deals_created", period: "this_month" } },
      { name: "get_pipeline_by_stage", input: {} },
      "Bu ay 12 sövdələşmə var.",
    )

    const body = await (await ask("Hansı sövdələşmələrimiz var")).json()
    expect(body.data.reply).toContain("təsdiqləyə bilmədim")
  })
})

/**
 * Until 2026-11-26 the read tools reached the model only behind the
 * `ai_smart_search` flag, which nothing in the product could switch on. On
 * that day Fanumsec and Zeytun Pharma had asked Da Vinci 45 questions in a
 * month with no tool able to see a single record. The owner: "Да, для всех".
 */
describe("reading the CRM without the old smart-search flag", () => {
  const WITHOUT_FLAG = {
    plan: "pro",
    addons: ["ai"],
    modules: { ai: true, crm: true, sales: true, support: true, leads: true, tasks: true },
  }
  const WITH_FLAG = { ...WITHOUT_FLAG, modules: { ...WITHOUT_FLAG.modules, ai_smart_search: true } }

  beforeEach(async () => {
    const { getOrgModuleContext } = await import("@/lib/api-auth")
    vi.mocked(getOrgModuleContext).mockResolvedValue(WITHOUT_FLAG as never)
  })

  afterEach(async () => {
    const { getOrgModuleContext } = await import("@/lib/api-auth")
    vi.mocked(getOrgModuleContext).mockResolvedValue(WITH_FLAG as never)
  })

  function offeredTools(round = 0): string[] {
    const tools = (anthropicCreate.mock.calls[round][0].tools ?? []) as Array<{ name: string }>
    return tools.map((tool) => tool.name)
  }

  it("offers an admin the record and summary tools and answers which deals there are", async () => {
    executeVoiceReadToolMock.mockResolvedValue({
      body: { data: { stages: [{ stage: "Təklif", count: 1, deals: [{ name: "Fanum PBX" }] }] } },
    })
    anthropicCreate.mockImplementation(async () => anthropicCreate.mock.calls.length === 1
      ? { content: [{ type: "tool_use", id: "tu_1", name: "get_pipeline_by_stage", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } }
      : { content: [{ type: "text", text: "Hazırda 1 sövdələşmə var: Fanum PBX." }], usage: { input_tokens: 1, output_tokens: 1 } })

    const body = await (await ask("Hansı sövdələşmələrimiz var")).json()

    expect(offeredTools()).toEqual(expect.arrayContaining([
      "list_deals", "list_contacts", "list_tasks", "list_tickets",
      "get_pipeline_by_stage", "find_record", "read_record",
    ]))
    expect(body.data.reply).toBe("Hazırda 1 sövdələşmə var: Fanum PBX.")
    expect(body.data.queryError).toBeUndefined()
  })

  it("still keeps a module the tenant did not buy out of reach", async () => {
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "Salam" }], usage: { input_tokens: 1, output_tokens: 1 } })
    await ask("Salam")
    // No finance module: no invoice list.
    expect(offeredTools()).not.toContain("list_invoices")
  })

  it("offers attendance to anyone who may open Personnel, and runs no summary that was not offered", async () => {
    const { getOrgModuleContext } = await import("@/lib/api-auth")
    vi.mocked(getOrgModuleContext).mockResolvedValue({
      ...WITHOUT_FLAG, modules: { ...WITHOUT_FLAG.modules, mtm: true },
    } as never)
    const SALES = { ...SESSION, role: "sales" }
    vi.mocked(getSession).mockResolvedValue(SALES as never)
    vi.mocked(requireAuth).mockResolvedValue(SALES as never)
    // The model names a summary it was not given.
    anthropicCreate.mockImplementation(async () => anthropicCreate.mock.calls.length === 1
      ? { content: [{ type: "tool_use", id: "tu_1", name: "get_pipeline_by_stage", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } }
      : { content: [{ type: "text", text: "Bunu görə bilmirəm." }], usage: { input_tokens: 1, output_tokens: 1 } })

    await ask("Hansı sövdələşmələrimiz var")

    const offered = offeredTools()
    expect(offered).toContain("get_attendance_summary")
    expect(offered).not.toContain("get_pipeline_by_stage")
    expect(executeVoiceReadToolMock).not.toHaveBeenCalled()
  })

  it("does not offer attendance to a role without MTM", async () => {
    const { getOrgModuleContext } = await import("@/lib/api-auth")
    vi.mocked(getOrgModuleContext).mockResolvedValue({
      ...WITHOUT_FLAG, modules: { ...WITHOUT_FLAG.modules, mtm: true },
    } as never)
    const TICKETING = { ...SESSION, role: "ticketing" }
    vi.mocked(getSession).mockResolvedValue(TICKETING as never)
    vi.mocked(requireAuth).mockResolvedValue(TICKETING as never)
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "Salam" }], usage: { input_tokens: 1, output_tokens: 1 } })

    await ask("Salam")
    expect(offeredTools()).not.toContain("get_attendance_summary")
  })

  it("offers a salesperson the record lists, but not the organization-wide summaries", async () => {
    const SALES = { ...SESSION, role: "sales" }
    vi.mocked(getSession).mockResolvedValue(SALES as never)
    vi.mocked(requireAuth).mockResolvedValue(SALES as never)
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "Salam" }], usage: { input_tokens: 1, output_tokens: 1 } })

    await ask("Salam")

    const offered = offeredTools()
    // Lists are narrowed to the salesperson's own screen by the executor.
    expect(offered).toEqual(expect.arrayContaining(["list_deals", "list_contacts", "list_tasks", "list_tickets"]))
    // Summaries and record cards still count the whole organization.
    for (const name of ["get_pipeline_by_stage", "get_sales_by_manager", "read_record", "find_record", "get_daily_briefing"]) {
      expect(offered).not.toContain(name)
    }
  })
})
