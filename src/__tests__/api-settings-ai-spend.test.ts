/**
 * «Настройки → ИИ и расходы»: who may see the spend, enter a key and change
 * the daily limit (owner, 2026-11-10).
 *
 *  - The report, its Excel file and the keys are the organization admin's.
 *  - A key is saved only after the provider accepted it, and never comes back
 *    to the screen; a provider whose calls do not all go through the gateway
 *    takes no key yet.
 *  - The daily limit guards the platform's key, so only the platform
 *    superadmin changes it; until now any member could raise it to $100.
 *
 * The journal arithmetic itself runs on a real Postgres in
 * ai-gateway-postgres.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  role: "admin",
  findOrg: vi.fn(),
  updateOrg: vi.fn(),
  audit: vi.fn(),
  verify: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  report: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => {
  const wrap = (fn: (req: NextRequest, auth: { orgId: string; userId: string; role: string }) => Promise<Response>) =>
    (req: NextRequest) => fn(req, { orgId: "org1", userId: "u1", role: state.role })
  return { withRlsSessionAuth: wrap, withRls: (fn: (req: NextRequest, ctx: { orgId: string }) => Promise<Response>) => (req: NextRequest) => fn(req, { orgId: "org1" }) }
})
vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findUnique: state.findOrg, update: state.updateOrg } },
  logAudit: state.audit,
}))
vi.mock("@/lib/ai/budget", () => ({
  checkAiBudget: vi.fn(async () => ({ allowed: true, spent: 0.05, limit: 5, remaining: 4.95 })),
  getAiLimits: vi.fn(async () => ({ maxRepliesPerConversation: 50, maxRepliesPerContactPerDay: 30, maxOutputTokens: 1024 })),
  DEFAULT_AI_LIMITS: { maxRepliesPerConversation: 50, maxRepliesPerContactPerDay: 30, maxOutputTokens: 1024 },
}))
vi.mock("@/lib/ai/gateway", async () => {
  const features = await import("@/lib/ai/gateway/features")
  const report = await import("@/lib/ai/gateway/spend-report")
  return {
    AI_PROVIDERS: features.AI_PROVIDERS,
    isSelfKeyProvider: features.isSelfKeyProvider,
    aiFeatureLabel: features.aiFeatureLabel,
    RANGES_FOR: report.RANGES_FOR,
    isSpendGranularity: report.isSpendGranularity,
    isSpendRange: report.isSpendRange,
    verifyProviderKey: state.verify,
    saveTenantAiCredential: state.save,
    deleteTenantAiCredential: state.remove,
    listTenantAiCredentials: state.list,
    aiSpendReport: state.report,
  }
})

vi.mock("@/lib/ai/gateway/provider-uses", () => ({
  providerUses: vi.fn(async () => [{ provider: "anthropic", uses: ["davinci"], costUsd: 0.24, calls: 29 }]),
}))

import * as keys from "@/app/api/v1/settings/ai-keys/route"
import * as spend from "@/app/api/v1/settings/ai-spend/route"
import * as exportRoute from "@/app/api/v1/settings/ai-spend/export/route"
import * as budget from "@/app/api/v1/settings/ai-budget/route"

const KEY = "sk-ant-api03-a-real-looking-key-ABCD" // gitleaks:allow — not a key

function req(url: string, method = "GET", body?: unknown) {
  return new NextRequest(`https://app.test${url}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  })
}

const REPORT = {
  granularity: "week", range: "90d", timeZone: "Asia/Baku", start: "2026-08-10T20:00:00.000Z", firstDay: "2026-08-11", lastDay: "2026-11-10",
  periods: [{ period: "2026-11-09", costUsd: 0.6, calls: 2, byFeature: { "davinci-chat": 0.6 } }],
  rows: [{ feature: "davinci-chat", agentId: "a1", agentName: "Support Pro", provider: "anthropic", model: "claude-haiku-4-5-20251001", keySource: "platform", calls: 2, inputTokens: 2020, outputTokens: 200, costUsd: 0.6 }],
  totals: { calls: 2, costUsd: 0.6 }, firstCallAt: "2026-11-09T10:00:00.000Z", today: { spent: 0.05, limit: 5, remaining: 4.95 },
}

beforeEach(() => {
  vi.clearAllMocks()
  state.role = "admin"
  state.findOrg.mockResolvedValue({ aiPlatformKey: true, settings: {} })
  state.updateOrg.mockResolvedValue({})
  state.list.mockResolvedValue([])
  state.save.mockResolvedValue({ keyHint: "…ABCD", status: "ok" })
  state.report.mockResolvedValue(REPORT)
})

describe("AI spend report and provider keys", () => {
  it.each(["manager", "sales", "support", "viewer"])("refuse %s: report, file and keys are the admin's", async (role) => {
    state.role = role
    expect((await spend.GET(req("/api/v1/settings/ai-spend"))).status).toBe(403)
    expect((await exportRoute.GET(req("/api/v1/settings/ai-spend/export"))).status).toBe(403)
    expect((await keys.GET(req("/api/v1/settings/ai-keys"))).status).toBe(403)
    expect((await keys.PUT(req("/api/v1/settings/ai-keys", "PUT", { provider: "anthropic", key: KEY }))).status).toBe(403)
    expect((await keys.DELETE(req("/api/v1/settings/ai-keys?provider=anthropic", "DELETE"))).status).toBe(403)
    expect(state.report).not.toHaveBeenCalled()
    expect(state.verify).not.toHaveBeenCalled()
    expect(state.save).not.toHaveBeenCalled()
    expect(state.remove).not.toHaveBeenCalled()
  })

  it("passes the viewer's zone and the window, and refuses a window the granularity does not offer", async () => {
    const res = await spend.GET(req("/api/v1/settings/ai-spend?granularity=day&range=30d&tz=Asia/Baku"))
    expect(res.status).toBe(200)
    expect(state.report).toHaveBeenCalledWith("org1", { granularity: "day", range: "30d", timeZone: "Asia/Baku" })
    expect((await spend.GET(req("/api/v1/settings/ai-spend?granularity=day&range=12m"))).status).toBe(400)
    expect((await spend.GET(req("/api/v1/settings/ai-spend?granularity=hour&range=7d"))).status).toBe(400)
  })

  it("exports the same report as an Excel workbook named by its days", async () => {
    const res = await exportRoute.GET(req("/api/v1/settings/ai-spend/export?granularity=week&range=90d&tz=Asia/Baku&lang=ru"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("spreadsheetml")
    expect(res.headers.get("content-disposition")).toContain("ai-spend-2026-08-11-2026-11-10.xlsx")
    const ExcelJS = (await import("exceljs")).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as never)
    const sheet = wb.worksheets[0]
    expect(sheet.name).toBe("По сервисам")
    expect(sheet.getRow(2).getCell(1).value).toBe("Da Vinci — чат")
    expect(sheet.getRow(2).getCell(2).value).toBe("Support Pro")
    expect(sheet.getRow(2).getCell(9).value).toBe(0.6)
  })

  it("saves a key only after the provider accepted it, and answers with its hint, never the key", async () => {
    state.verify.mockResolvedValue("ok")
    state.list.mockResolvedValue([{ provider: "anthropic", keyHint: "…ABCD", status: "ok" }])
    const res = await keys.PUT(req("/api/v1/settings/ai-keys", "PUT", { provider: "anthropic", key: `  ${KEY} ` }))
    expect(res.status).toBe(200)
    expect(state.verify).toHaveBeenCalledWith("anthropic", KEY)
    expect(state.save).toHaveBeenCalledWith({ orgId: "org1", provider: "anthropic", secret: KEY, userId: "u1", status: "ok" })
    const json = await res.json()
    // Which modules call each provider and its 30-day spend come with the keys.
    expect(json.data.providers).toEqual([{ provider: "anthropic", uses: ["davinci"], costUsd: 0.24, calls: 29 }])
    const text = JSON.stringify(json)
    expect(text).not.toContain(KEY)
    expect(text).toContain("…ABCD")
    expect(JSON.stringify(state.audit.mock.calls)).not.toContain(KEY)
  })

  it.each([
    ["invalid", 400, "KEY_REFUSED"],
    ["unreachable", 502, "PROVIDER_UNREACHABLE"],
  ])("does not save a key the provider answered %s for", async (check, status, code) => {
    state.verify.mockResolvedValue(check)
    const res = await keys.PUT(req("/api/v1/settings/ai-keys", "PUT", { provider: "anthropic", key: KEY }))
    expect(res.status).toBe(status)
    expect((await res.json()).code).toBe(code)
    expect(state.save).not.toHaveBeenCalled()
  })

  it("takes no key for Speech-to-Text (the platform's service account) or an unknown provider, nor something that is not a key", async () => {
    for (const provider of ["google_speech", "made-up"]) {
      const res = await keys.PUT(req("/api/v1/settings/ai-keys", "PUT", { provider, key: KEY }))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe("PROVIDER_NOT_OPEN")
    }
    expect((await keys.PUT(req("/api/v1/settings/ai-keys", "PUT", { provider: "anthropic", key: "short" }))).status).toBe(400)
    expect((await keys.PUT(req("/api/v1/settings/ai-keys", "PUT", { provider: "anthropic", key: "sk-ant with spaces inside the key" }))).status).toBe(400)
    expect(state.verify).not.toHaveBeenCalled()
    expect(state.save).not.toHaveBeenCalled()
  })

  it("removes the organization's key and says so in the audit log", async () => {
    expect((await keys.DELETE(req("/api/v1/settings/ai-keys?provider=anthropic", "DELETE"))).status).toBe(200)
    expect(state.remove).toHaveBeenCalledWith("org1", "anthropic")
    expect(state.audit).toHaveBeenCalledWith("org1", "delete", "ai_provider_key", "anthropic", "anthropic", { userId: "u1" })
  })
})

describe("the daily AI limit", () => {
  // Owner, 2026-11-11: «если клиент захочет, то пусть ставит лимит» — the organization's admin owns it.
  it("is set and cleared by the organization's admin, and no one else", async () => {
    for (const role of ["manager", "viewer"]) {
      state.role = role
      const res = await budget.PATCH(req("/api/v1/settings/ai-budget", "PATCH", { limit: 100 }))
      expect(res.status).toBe(403)
    }
    expect(state.updateOrg).not.toHaveBeenCalled()

    state.role = "admin"
    expect((await budget.PATCH(req("/api/v1/settings/ai-budget", "PATCH", { limit: 20 }))).status).toBe(200)
    expect(state.updateOrg).toHaveBeenLastCalledWith({ where: { id: "org1" }, data: { settings: { aiDailyBudgetUsd: 20 } } })
    expect((await budget.PATCH(req("/api/v1/settings/ai-budget", "PATCH", { limit: null }))).status).toBe(200)
    expect(state.updateOrg).toHaveBeenLastCalledWith({ where: { id: "org1" }, data: { settings: {} } })
  })

  it("refuses a limit that is not a sum of dollars a day", async () => {
    for (const limit of [0, 0.1, -5, 10_001, "20", true]) {
      expect((await budget.PATCH(req("/api/v1/settings/ai-budget", "PATCH", { limit }))).status).toBe(400)
    }
    expect(state.updateOrg).not.toHaveBeenCalled()
  })

  it("leaves the reply limits to the organization's admin", async () => {
    const aiLimits = { maxRepliesPerConversation: 10 }
    expect((await budget.PATCH(req("/api/v1/settings/ai-budget", "PATCH", { aiLimits }))).status).toBe(200)
    state.role = "manager"
    expect((await budget.PATCH(req("/api/v1/settings/ai-budget", "PATCH", { aiLimits }))).status).toBe(403)
  })
})
