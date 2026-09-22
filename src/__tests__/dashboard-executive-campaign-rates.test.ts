import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { NextRequest } from "next/server"

/*
 * Home dashboard → «Campaigns»: open and click rates per campaign.
 *
 * Until 2026-09-21 GET /api/v1/dashboard/executive divided opens and clicks by
 * totalRecipients for every channel and fell back to 0, so an SMS campaign
 * read «0% open rate» on the home KPI card — a step SMS cannot record, shown
 * as a measured zero. The rule now is the one in src/lib/campaigns/analytics.ts:
 * a rate exists only where the channel records the step, and its base is what
 * was sent.
 */

const campaignRows = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }))

vi.mock("@/lib/prisma", () => {
  // Every other query on the dashboard answers "nothing": this test reads only
  // the campaigns block.
  const empty = (model: string, method: string) => {
    if (model === "campaign" && method === "findMany") return campaignRows.rows
    if (method === "count") return 0
    if (method === "aggregate") return { _sum: {}, _avg: {}, _count: {}, _min: {}, _max: {} }
    if (method === "findFirst" || method === "findUnique") return null
    return []
  }
  const model = (name: string) =>
    new Proxy({}, { get: (_t, method: string) => vi.fn(async () => empty(name, method)) })
  const prisma: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (name === "$transaction") return async (arg: unknown) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg as unknown[]))
        if (name.startsWith("$")) return vi.fn(async () => [])
        if (name === "then") return undefined
        return model(name)
      },
    },
  )
  return { prisma, default: prisma }
})

vi.mock("@/lib/api-auth", () => {
  const getOrgId = vi.fn().mockResolvedValue("org-1")
  const getSession = vi.fn().mockResolvedValue(null)
  return {
    getOrgId,
    getSession,
    requireAuth: vi.fn(async () => ({ orgId: "org-1", userId: "u1", role: "admin", email: "a@b.com", name: "Test" })),
    requireSessionAuth: vi.fn(async () => ({ orgId: "org-1", userId: "u1", role: "admin", email: "a@b.com", name: "Test" })),
    isAuthError: vi.fn((value: unknown) => value instanceof Response),
  }
})
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/cost-model/db", () => ({
  loadAndCompute: vi.fn().mockResolvedValue({
    grandTotalG: 0,
    summary: { totalRevenue: 0, totalMargin: 0, marginPct: 0, profitableClients: 0, lossClients: 0 },
    clients: [],
  }),
}))
vi.mock("@/lib/ai/predictive", () => ({ generateRevenueForecast: vi.fn().mockResolvedValue([]) }))

import { GET } from "@/app/api/v1/dashboard/executive/route"

type DashboardCampaign = { id: string; sent: number; openRate: number | null; clickRate: number | null }

async function dashboardCampaigns(rows: Record<string, unknown>[]): Promise<DashboardCampaign[]> {
  campaignRows.rows = rows
  const res = await GET(new NextRequest("http://x/api/v1/dashboard/executive"))
  expect(res.status).toBe(200)
  const body = await res.json()
  return body.data.campaigns
}

const row = (over: Record<string, unknown>) => ({
  id: "c",
  name: "Campaign",
  type: "email",
  status: "sent",
  totalRecipients: 0,
  totalSent: 0,
  totalOpened: 0,
  totalClicked: 0,
  createdAt: new Date("2026-09-01T09:00:00Z"),
  ...over,
})

beforeEach(() => {
  campaignRows.rows = []
})

describe("GET /api/v1/dashboard/executive — campaign rates", () => {
  it("an SMS campaign has no open or click rate, not 0%", async () => {
    const [sms] = await dashboardCampaigns([
      row({ id: "sms", type: "sms", totalRecipients: 500, totalSent: 480 }),
    ])
    expect(sms.sent).toBe(480)
    expect(sms.openRate).toBeNull()
    expect(sms.clickRate).toBeNull()
  })

  it("WhatsApp and Telegram campaigns have no rates either", async () => {
    const campaigns = await dashboardCampaigns([
      row({ id: "wa", type: "whatsapp", totalRecipients: 40, totalSent: 40 }),
      row({ id: "tg", type: "telegram", totalRecipients: 30, totalSent: 30 }),
    ])
    expect(campaigns.map((c) => [c.id, c.openRate, c.clickRate])).toEqual([
      ["wa", null, null],
      ["tg", null, null],
    ])
  })

  it("email rates are over what was sent, not over the recipient list", async () => {
    const [email] = await dashboardCampaigns([
      row({ id: "e", type: "email", totalRecipients: 1000, totalSent: 400, totalOpened: 100, totalClicked: 20 }),
    ])
    expect(email.openRate).toBe(25)
    expect(email.clickRate).toBe(5)
  })

  it("an email campaign that was sent and nobody opened reads a real 0%", async () => {
    const [email] = await dashboardCampaigns([row({ id: "e", type: "email", totalRecipients: 50, totalSent: 50 })])
    expect(email.openRate).toBe(0)
    expect(email.clickRate).toBe(0)
  })

  it("a campaign that has not sent anything has no rate", async () => {
    const [draft] = await dashboardCampaigns([
      row({ id: "d", type: "email", status: "draft", totalRecipients: 200, totalSent: 0 }),
    ])
    expect(draft.openRate).toBeNull()
    expect(draft.clickRate).toBeNull()
  })
})

describe("dashboard consumers print «—» for a missing rate", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

  it.each([
    "src/app/(dashboard)/page.tsx",
    "src/app/(dashboard)/dashboard/page.tsx",
    "src/components/dashboard/campaign-stats.tsx",
  ])("%s does not turn a missing rate into 0", (path) => {
    const source = read(path)
    expect(source.match(/(openRate|clickRate|OpenRate)\s*(\|\||\?\?)\s*0/g) ?? []).toEqual([])
  })
})
