import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const state = vi.hoisted(() => ({
  role: "manager",
  org: {
    plan: "enterprise",
    addons: [] as string[],
    modules: {
      ai: true,
      crm: true,
      sales: true,
      contracts: true,
      marketing: true,
      omnichannel: true,
      support: true,
      finance: true,
      analytics: true,
      mtm: true,
    } as Record<string, boolean>,
  },
}))

const deps = vi.hoisted(() => ({
  canUseVoiceDataFields: vi.fn(async () => true),
  findVoiceRecords: vi.fn(async () => ({ type: "invoice", matches: [], truncated: false })),
  buildOverdueSummary: vi.fn(async () => ({})),
  buildWorkloadSummary: vi.fn(async () => ({})),
  buildVoiceBriefing: vi.fn<
    (
      orgId: string,
      now: Date,
      allowedDomains: string[],
      context: { userId: string; role: string },
    ) => Promise<Record<string, never>>
  >(async () => ({})),
  executeVoiceTaskList: vi.fn(async () => ({
    success: true,
    data: { entityType: "task", columns: [], rows: [], total: 0, returned: 0 },
  })),
  readSection: vi.fn(async () => ({})),
  buildFieldSummary: vi.fn(async () => ({})),
  buildLeadsSummary: vi.fn(async () => ({})),
  buildMarketingSummary: vi.fn(async () => ({})),
  buildForecastSummary: vi.fn(async () => ({})),
  buildLeadCoverageSummary: vi.fn(async () => ({})),
  loadVoiceReportingTimezone: vi.fn(async () => "Asia/Baku"),
  voiceSessionTurnCreate: vi.fn<
    (args: { data: { text: string } }) => Promise<Record<string, never>>
  >(async () => ({})),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "manager-1", role: state.role }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    voiceSession: { updateMany: vi.fn(async () => ({ count: 1 })) },
    voiceSessionTurn: { create: deps.voiceSessionTurnCreate },
  },
}))

vi.mock("@/lib/ai/voice/field-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/voice/field-access")>(
    "@/lib/ai/voice/field-access",
  )
  return { ...actual, canUseVoiceDataFields: deps.canUseVoiceDataFields }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgModuleContext: vi.fn(async () => state.org),
}))

vi.mock("@/lib/ai/voice/gate", () => ({
  checkVoicePilotAccess: vi.fn(async () => ({ ok: true })),
}))

vi.mock("@/lib/ai/read-tool-executor", () => ({
  executeReadTool: vi.fn(async () => ({
    success: true,
    data: { entityType: "deal", columns: [], rows: [], total: 0, returned: 0 },
  })),
}))

vi.mock("@/lib/ai/voice/task-list", () => ({
  executeVoiceTaskList: deps.executeVoiceTaskList,
}))

vi.mock("@/lib/ai/voice/section-reader", () => ({ readSection: deps.readSection }))

vi.mock("@/lib/ai/voice/lead-coverage", () => ({
  buildLeadCoverageSummary: deps.buildLeadCoverageSummary,
}))

vi.mock("@/lib/ai/voice/summaries", () => ({
  buildInboxSummary: vi.fn(async () => ({})),
  buildFieldSummary: deps.buildFieldSummary,
  buildVoiceBriefing: deps.buildVoiceBriefing,
  buildPipelineSummary: vi.fn(async () => ({})),
  buildSalesByManager: vi.fn(async () => ({})),
  buildOverdueSummary: deps.buildOverdueSummary,
  findVoiceRecords: deps.findVoiceRecords,
  buildLeadsSummary: deps.buildLeadsSummary,
  buildMarketingSummary: deps.buildMarketingSummary,
  buildForecastSummary: deps.buildForecastSummary,
  buildBoardsSummary: vi.fn(async () => ({})),
  buildWorkloadSummary: deps.buildWorkloadSummary,
  buildQuotesSummary: vi.fn(async () => ({})),
  buildSalesPeriodSummary: vi.fn(async () => ({})),
}))

vi.mock("@/lib/ai/voice/reporting-timezone", () => ({
  loadVoiceReportingTimezone: deps.loadVoiceReportingTimezone,
  resolveVoiceForecastRanges: vi.fn((now: Date, timezone: string) => ({
    actuals: {
      from: new Date("2026-06-30T20:00:00.000Z"),
      toExclusive: now,
      timezone,
      label: "2026-07-01 — 2026-08-11",
    },
    pipelineToExclusive: new Date("2026-09-30T20:00:00.000Z"),
  })),
  resolveVoiceReportingRange: vi.fn((_period: string, now: Date, timezone: string) => ({
    from: new Date("2026-08-10T20:00:00.000Z"),
    toExclusive: now,
    timezone,
    label: "2026-08-11",
  })),
}))

import { POST } from "@/app/api/v1/ai/voice/read/route"

function request(tool: string, filter: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/v1/ai/voice/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ voiceSessionId: "voice-1", tool, filter }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.canUseVoiceDataFields.mockResolvedValue(true)
  state.role = "manager"
  Object.assign(state.org.modules, {
    ai: true,
    crm: true,
    sales: true,
    contracts: true,
    marketing: true,
    omnichannel: true,
    support: true,
    finance: true,
    analytics: true,
    mtm: true,
  })
})

describe("voice read target-scope authorization", () => {
  it.each([
    ["get_pipeline_by_stage", {}, "deal"],
    ["get_forecast_summary", {}, "deal"],
    ["get_lead_coverage", {}, "lead"],
    ["list_deals", {}, "deal"],
    ["get_overdue", {}, "invoice"],
    ["list_invoices", {}, "invoice"],
    ["list_contacts", {}, "contact"],
    ["find_record", { type: "contact", query: "Ada" }, "contact"],
  ])("fails closed before %s reads a hidden %s field", async (tool, filter, entityType) => {
    deps.canUseVoiceDataFields.mockResolvedValueOnce(false)

    const response = await POST(request(tool, filter))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { error: "ACCESS_SCOPE_UNAVAILABLE" } })
    expect(deps.canUseVoiceDataFields).toHaveBeenCalledWith(
      "org-1",
      "manager",
      expect.arrayContaining([entityType]),
    )
  })

  it("fails closed when field permissions cannot be verified", async () => {
    deps.canUseVoiceDataFields.mockRejectedValueOnce(new Error("permission store unavailable"))

    const response = await POST(request("get_pipeline_by_stage"))

    expect(await response.json()).toEqual({ data: { error: "ACCESS_SCOPE_UNAVAILABLE" } })
  })

  it("keeps documentation available when data fields are hidden", async () => {
    const response = await POST(request("explain_section", { section: "deals" }))

    expect(response.status).toBe(200)
    expect((await response.json()).data.section).toBe("deals")
    expect(deps.canUseVoiceDataFields).toHaveBeenCalledWith("org-1", "manager", [])
  })

  it("keeps admin data reads available without querying manager field rules", async () => {
    state.role = "admin"

    const response = await POST(request("get_pipeline_by_stage"))

    expect(response.status).toBe(200)
  })

  it("evaluates the lead field policy before speaking lead coverage", async () => {
    // Regression: the tool had no case in voiceFieldEntitiesForTool, so the
    // gate threw on undefined and every manager heard ACCESS_SCOPE_UNAVAILABLE.
    const response = await POST(request("get_lead_coverage"))

    expect(response.status).toBe(200)
    expect(deps.canUseVoiceDataFields).toHaveBeenCalledWith("org-1", "manager", ["lead"])
    expect(deps.buildLeadCoverageSummary).toHaveBeenCalledWith("org-1", expect.any(Date))
  })

  it("does not query an invoice through find_record when Finance is disabled", async () => {
    state.org.modules.finance = false

    const response = await POST(request("find_record", { type: "invoice", query: "INV-10" }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { error: "ACCESS_SCOPE_UNAVAILABLE", type: "invoice" },
    })
    expect(deps.findVoiceRecords).not.toHaveBeenCalled()
  })

  it("permits find_record only after the target module and role scope pass", async () => {
    const response = await POST(request("find_record", { type: "invoice", query: "INV-10" }))

    expect(response.status).toBe(200)
    expect(deps.findVoiceRecords).toHaveBeenCalledWith(
      "org-1",
      "invoice",
      "INV-10",
      { userId: "manager-1", role: "manager" },
    )
  })

  it("audits only tool schema keys and never persists free-text filter values", async () => {
    const privateQuery = "private customer name from speech"

    expect((await POST(request("find_record", { type: "invoice", query: privateQuery }))).status).toBe(200)

    const text = deps.voiceSessionTurnCreate.mock.calls[0]?.[0]?.data?.text as string
    expect(text).toBe('{"outcome":"accepted","keys":["query","type"]}')
    expect(text).not.toContain(privateQuery)
    expect(text).not.toContain("invoice")
  })

  it("does not require the CRM module for a Finance-targeted invoice lookup", async () => {
    state.org.modules.crm = false

    const response = await POST(request("find_record", { type: "invoice", query: "INV-10" }))

    expect(response.status).toBe(200)
    expect(deps.findVoiceRecords).toHaveBeenCalledWith(
      "org-1",
      "invoice",
      "INV-10",
      { userId: "manager-1", role: "manager" },
    )
  })

  it("does not run the mixed overdue query when any component module is hidden", async () => {
    state.org.modules.finance = false

    const response = await POST(request("get_overdue"))

    expect(await response.json()).toEqual({ data: { error: "ACCESS_SCOPE_UNAVAILABLE" } })
    expect(deps.buildOverdueSummary).not.toHaveBeenCalled()
  })

  it("checks each workload focus and rejects an unsafe all-focus query", async () => {
    state.org.modules.support = false

    const allResponse = await POST(request("get_workload_by_person", { focus: "all" }))
    expect(await allResponse.json()).toEqual({
      data: { error: "ACCESS_SCOPE_UNAVAILABLE", focus: "all" },
    })
    expect(deps.buildWorkloadSummary).not.toHaveBeenCalled()

    const tasksResponse = await POST(request("get_workload_by_person", { focus: "tasks" }))
    expect(tasksResponse.status).toBe(200)
    expect(deps.buildWorkloadSummary).toHaveBeenCalledWith(
      "org-1",
      expect.any(Date),
      "tasks",
      { userId: "manager-1", role: "manager" },
    )
  })

  it("rejects a guide key excluded from voice navigation", async () => {
    const response = await POST(request("explain_section", { section: "settings_api-keys" }))

    expect(await response.json()).toEqual({
      data: { error: "SECTION_NOT_AVAILABLE", section: "settings_api-keys" },
    })
  })

  it("checks the target guide module rather than explain_section's CRM shell", async () => {
    state.org.modules.finance = false

    const response = await POST(request("explain_section", { section: "invoices" }))

    expect(await response.json()).toEqual({
      data: { error: "SECTION_NOT_AVAILABLE", section: "invoices" },
    })
  })

  it("uses the canonical Sales module for described lead data", async () => {
    state.org.modules.sales = false

    const response = await POST(request("describe_section", { section: "leads" }))

    expect(await response.json()).toEqual({
      data: { error: "NOT_PERMITTED_FOR_ROLE", section: "leads" },
    })
    expect(deps.readSection).not.toHaveBeenCalled()
  })

  it("gates the daily briefing on Analytics, and says so as data rather than as an outage", async () => {
    state.org.modules.analytics = false

    const response = await POST(request("get_daily_briefing"))

    // A module the tenant never bought is a fact about the account. Returned as
    // an error status it counted towards the browser's "two failed reads = the
    // CRM is down" rule, so two questions about modules you do not have ended
    // the conversation. The gate is unchanged; only how it answers is.
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { error: "MODULE_NOT_ENABLED", module: "analytics" } })
    expect(deps.buildVoiceBriefing).not.toHaveBeenCalled()
  })

  it("passes only currently visible Advisor domains into the stored briefing reader", async () => {
    state.org.modules.finance = false

    const response = await POST(request("get_daily_briefing"))

    expect(response.status).toBe(200)
    const allowedDomains = deps.buildVoiceBriefing.mock.calls[0]?.[2] as string[]
    expect(allowedDomains).toContain("sales")
    expect(allowedDomains).not.toContain("finance")
    expect(deps.buildVoiceBriefing).toHaveBeenCalledWith(
      "org-1",
      expect.any(Date),
      expect.any(Array),
      { userId: "manager-1", role: "manager" },
    )
  })

  it("uses an authenticated Baku reporting range for Field today", async () => {
    const response = await POST(request("get_field_summary"))

    expect(response.status).toBe(200)
    expect(deps.loadVoiceReportingTimezone).toHaveBeenCalledWith("org-1", "manager-1")
    expect(deps.buildFieldSummary).toHaveBeenCalledWith(
      "org-1",
      expect.any(Date),
      expect.objectContaining({
        from: new Date("2026-08-10T20:00:00.000Z"),
        timezone: "Asia/Baku",
      }),
    )
  })

  it("fails closed when a period is requested but the reporting timezone cannot be loaded", async () => {
    deps.loadVoiceReportingTimezone.mockRejectedValueOnce(new Error("db unavailable"))

    const response = await POST(request("describe_section", {
      section: "leads",
      period: "today",
    }))

    expect(await response.json()).toEqual({
      data: { error: "REPORTING_TIMEZONE_UNAVAILABLE" },
    })
    expect(deps.readSection).not.toHaveBeenCalled()
  })

  it.each([
    ["get_leads_summary", "month", deps.buildLeadsSummary],
    ["get_marketing_summary", "month", deps.buildMarketingSummary],
    ["get_forecast_summary", "quarter", deps.buildForecastSummary],
  ] as const)("binds %s to the user's local %s range", async (tool, period, builder) => {
    const response = await POST(request(tool))

    expect(response.status).toBe(200)
    expect(deps.loadVoiceReportingTimezone).toHaveBeenCalledWith("org-1", "manager-1")
    if (tool === "get_forecast_summary") {
      expect(builder).toHaveBeenCalledWith(
        "org-1",
        expect.any(Date),
        expect.objectContaining({ timezone: "Asia/Baku" }),
        new Date("2026-09-30T20:00:00.000Z"),
      )
    } else {
      expect(builder).toHaveBeenCalledWith(
        "org-1",
        expect.any(Date),
        expect.objectContaining({ timezone: "Asia/Baku" }),
      )
    }
    expect(period).toMatch(/month|quarter/)
  })
})
