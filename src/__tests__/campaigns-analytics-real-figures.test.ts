// @vitest-environment jsdom
/**
 * Campaigns → «Analitika» shows only what the organisation's records say.
 *
 * Found 2026-09-21 on the demo tenant — six campaigns, not one segment,
 * template or journey — the tab read «Seqmentlər 8 / 5 dinamik / 6.1K
 * kontakt», «Avtomatlaşdırma 3 aktiv», «Şablonlar 6 / 5 aktiv» with an
 * Email 55% / SMS 25% / Push 12% donut, and «ROI +30…»: each one a multiplier
 * applied to the campaign totals. «Ən yaxşı kampaniyalar» put an SMS campaign
 * with «0.0% açılma» first.
 *
 * The rendered checks fail on any non-zero figure in a widget whose records
 * the tenant does not have. The calculations are checked on the demo tenant's
 * own campaigns (scripts/seeds/demo-journey-legend.mjs), not on a shape.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}))

import { CAMPAIGNS as DEMO_LEGEND_CAMPAIGNS } from "../../scripts/seeds/demo-journey-legend.mjs"
import { CampaignsAnalytics } from "@/components/campaigns/campaigns-analytics"
import {
  campaignRoi,
  monthlyTrend,
  summarizeCampaigns,
  summarizeJourneys,
  summarizeSegments,
  summarizeTemplates,
  topCampaigns,
  type CampaignAnalyticsRecord,
} from "@/lib/campaigns/analytics"

type LegendCampaign = {
  name: string
  type: string
  status: string
  totalRecipients?: number
  totalSent?: number
  totalOpened?: number
  totalClicked?: number
  totalBounced?: number
  budget?: number
  sentAt?: Date
  createdAt: Date
}

/** A legend row as GET /api/v1/campaigns returns it: Prisma defaults filled in, dates as ISO strings. */
function asApiRow(c: LegendCampaign, i: number): CampaignAnalyticsRecord {
  return {
    id: `cmp-${i}`,
    name: c.name,
    type: c.type,
    status: c.status,
    totalRecipients: c.totalRecipients ?? 0,
    totalSent: c.totalSent ?? 0,
    totalOpened: c.totalOpened ?? 0,
    totalClicked: c.totalClicked ?? 0,
    totalBounced: c.totalBounced ?? 0,
    budget: c.budget ?? 0,
    sentAt: c.sentAt ? c.sentAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  }
}

const DEMO = (DEMO_LEGEND_CAMPAIGNS as LegendCampaign[]).map(asApiRow)
const byName = (fragment: string) => DEMO.find((c) => c.name.includes(fragment))!

function campaign(overrides: Partial<CampaignAnalyticsRecord>): CampaignAnalyticsRecord {
  return {
    id: overrides.id ?? "c",
    name: overrides.name ?? "Campaign",
    type: "email",
    status: "sent",
    totalRecipients: 0,
    totalSent: 0,
    totalOpened: 0,
    totalClicked: 0,
    totalBounced: 0,
    budget: 0,
    sentAt: "2026-09-10T08:00:00.000Z",
    createdAt: "2026-09-09T08:00:00.000Z",
    ...overrides,
  }
}

describe("campaign analytics figures, on the demo tenant's campaigns", () => {
  it("rates count only the sends of campaigns that record the step", () => {
    const s = summarizeCampaigns(DEMO)
    expect(s.sent).toBe(1829 + 603 + 2291)
    // Opens: the email campaign and the WhatsApp one carry opens; the SMS
    // campaign's 2,291 sends cannot be opened and must not dilute the rate.
    expect(s.opened).toMatchObject({ count: 763 + 487, base: 1829 + 603 })
    expect(s.opened!.percent).toBeCloseTo((1250 / 2432) * 100, 6)
    expect(s.clicked).toMatchObject({ count: 214 + 141 + 96, base: 1829 + 603 + 2291 })
    expect(s.bounced).toMatchObject({ count: 18 + 23, base: 1829 + 2291 })
    expect(s.budget).toBe(340 + 185 + 229 + 64 + 410 + 118)
  })

  it("ranks top campaigns by what recipients did, and never reports SMS opens as 0%", () => {
    const top = topCampaigns(DEMO)
    expect(top.map((c) => c.type)).toEqual(["email", "whatsapp", "sms"])
    const sms = top.find((c) => c.type === "sms")!
    expect(sms.openRate).toBeNull()
    expect(sms.clickRate).toBeCloseTo((96 / 2291) * 100, 6)
    expect(top[0].openRate).toBeCloseTo((763 / 1829) * 100, 6)
  })

  it("puts sends in the month they went out and nothing outside the window", () => {
    const now = new Date(2026, 8, 21)
    const trend = monthlyTrend(
      [
        campaign({ totalSent: 100, totalOpened: 40, totalClicked: 5, sentAt: new Date(2026, 8, 3).toISOString() }),
        campaign({ totalSent: 50, sentAt: new Date(2026, 6, 15).toISOString() }),
        campaign({ totalSent: 999, sentAt: new Date(2025, 11, 1).toISOString() }),
      ],
      now,
    )
    expect(trend.map((m) => [m.month, m.sent])).toEqual([[3, 0], [4, 0], [5, 0], [6, 50], [7, 0], [8, 100]])
    expect(trend[5]).toMatchObject({ opened: 40, clicked: 5 })
  })
})

describe("campaign analytics figures a record cannot back", () => {
  it("reports bounces only for channels whose provider reports them", () => {
    // Email bounces arrive through the Resend webhook, so an email campaign
    // with none is a measured 0; SMS reports none, so it has no bounce rate.
    const email = summarizeCampaigns([campaign({ totalSent: 1200, totalOpened: 300, totalClicked: 40 })])
    expect(email.bounced).toEqual({ count: 0, base: 1200, percent: 0 })
    expect(email.opened!.percent).toBeCloseTo(25, 6)
    expect(summarizeCampaigns([campaign({ type: "sms", totalSent: 1200 })]).bounced).toBeNull()
  })

  it("reports no open or click rate for channels that do not record them", () => {
    const s = summarizeCampaigns([
      campaign({ type: "sms", totalSent: 2291 }),
      campaign({ type: "telegram", totalSent: 386 }),
    ])
    expect(s.opened).toBeNull()
    expect(s.clicked).toBeNull()
    expect(topCampaigns([campaign({ type: "sms", totalSent: 2291 })])).toEqual([])
  })

  it("has no ROI without won deals linked to a campaign — not -100%", () => {
    expect(campaignRoi({ summary: { totalRevenue: 0, totalCost: 1346, totalRoi: -100 }, campaigns: [{ deals: [] }] }))
      .toEqual({ kind: "no-revenue" })
  })

  it("has no ROI when the linked deals are in more than one currency", () => {
    const deals = [{ currency: "AZN" }, { currency: "USD" }]
    expect(campaignRoi({ summary: { totalRevenue: 9000, totalCost: 1000, totalRoi: 800 }, campaigns: [{ deals }] }))
      .toEqual({ kind: "several-currencies" })
  })

  it("passes the Campaign ROI page's own figure through when revenue is real", () => {
    const deals = [{ currency: "AZN" }, { currency: "AZN" }]
    expect(campaignRoi({ summary: { totalRevenue: 2600, totalCost: 2000, totalRoi: 30 }, campaigns: [{ deals }] }))
      .toEqual({ kind: "value", percent: 30 })
  })

  it("summarises segments, journeys and templates from their records only", () => {
    expect(summarizeSegments([])).toEqual({ total: 0, dynamic: 0, static: 0, largest: [] })
    expect(summarizeJourneys([])).toEqual({ total: 0, active: 0, entries: 0, conversion: null, busiest: [] })
    expect(summarizeTemplates([])).toEqual({ total: 0, active: 0, byCategory: [] })

    const seg = summarizeSegments([
      { id: "a", name: "Bakı", isDynamic: true, contactCount: 120 },
      { id: "b", name: "VIP", isDynamic: false, contactCount: 45 },
    ])
    expect(seg).toMatchObject({ total: 2, dynamic: 1, static: 1 })
    expect(seg.largest.map((s) => s.contacts)).toEqual([120, 45])

    const journeys = summarizeJourneys([
      { id: "j1", name: "Welcome", status: "active", entryCount: 80, conversionCount: 8 },
      { id: "j2", name: "Winback", status: "paused", entryCount: 20, conversionCount: 0 },
    ])
    expect(journeys).toMatchObject({ total: 2, active: 1, entries: 100 })
    expect(journeys.conversion).toMatchObject({ count: 8, base: 100, percent: 8 })

    const templates = summarizeTemplates([
      { id: "t1", category: "marketing", isActive: true },
      { id: "t2", category: "marketing", isActive: false },
      { id: "t3", category: null },
    ])
    expect(templates).toEqual({
      total: 3,
      active: 2,
      byCategory: [{ category: "marketing", count: 2 }, { category: "general", count: 1 }],
    })
  })
})

describe("Campaigns → Analitika tab as rendered", () => {
  let container: HTMLDivElement
  let root: Root

  type Api = { segments?: unknown[]; templates?: unknown[]; journeys?: unknown[]; roi?: unknown }

  function serve(api: Api) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        const body = url.startsWith("/api/v1/segments")
          ? { segments: api.segments ?? [], total: (api.segments ?? []).length }
          : url.startsWith("/api/v1/email-templates")
            ? { templates: api.templates ?? [], total: (api.templates ?? []).length }
            : url.startsWith("/api/v1/journeys")
              ? { journeys: api.journeys ?? [], total: (api.journeys ?? []).length }
              : url.startsWith("/api/v1/campaign-roi")
                ? api.roi
                : null
        if (!body) return new Response(JSON.stringify({ error: "unexpected " + url }), { status: 404 })
        return new Response(JSON.stringify({ success: true, data: body }), { status: 200 })
      }),
    )
  }

  /** What GET /api/v1/campaign-roi returns for these campaigns when no deal points at any of them. */
  function roiWithoutDeals(campaigns: CampaignAnalyticsRecord[]) {
    const totalCost = campaigns.reduce((s, c) => s + (c.budget ?? 0), 0)
    return {
      campaigns: campaigns.map((c) => ({ id: c.id, deals: [] })),
      summary: { totalRevenue: 0, totalCost, totalRoi: totalCost > 0 ? -100 : 0 },
    }
  }

  async function renderTab(campaigns: CampaignAnalyticsRecord[]) {
    await act(async () => {
      root.render(createElement(CampaignsAnalytics, { campaigns, total: campaigns.length, orgId: "org-1" }))
    })
    // fetch → res.json() → setState: let every pending promise settle.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }

  function widget(id: string): string {
    const el = container.querySelector(`[data-testid="campaigns-analytics-${id}"]`)
    expect(el, `widget "${id}" is not rendered`).not.toBeNull()
    return el!.textContent ?? ""
  }

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("shows no non-zero figure anywhere for an organisation with no records at all", async () => {
    serve({ roi: roiWithoutDeals([]) })
    await renderTab([])
    expect(container.textContent).not.toMatch(/[1-9]/)
    for (const id of ["kpi-sent", "kpi-open-rate", "kpi-click-rate", "kpi-bounce", "kpi-budget", "kpi-roi", "trend", "funnel", "top", "segments", "automation", "templates"]) {
      expect(widget(id), id).not.toMatch(/[1-9]/)
    }
    // «—», not «0%»: a rate over nothing is not a measured zero.
    expect(widget("kpi-open-rate")).toContain("—")
  })

  it("on the demo tenant (campaigns only) invents no segments, journeys, templates or ROI", async () => {
    serve({ roi: roiWithoutDeals(DEMO) })
    await renderTab(DEMO)
    for (const id of ["segments", "automation", "templates", "kpi-roi"]) {
      expect(widget(id), id).not.toMatch(/[1-9]/)
    }
    expect(widget("segments")).toContain("noSegments")
    expect(widget("automation")).toContain("noJourneys")
    expect(widget("templates")).toContain("noTemplates")
    expect(widget("kpi-roi")).toContain("roiNoWonDeals")
    // The campaign widgets do have records, and show them.
    expect(widget("kpi-sent")).toContain("4.7K")
    expect(widget("kpi-open-rate")).toContain("51.4%")
    expect(widget("kpi-click-rate")).toContain("9.5%")
    expect(widget("kpi-bounce")).toContain("1.0%")
  })

  it("prints «—», not «0.0%», for the opens of an SMS campaign in the top list", async () => {
    serve({ roi: roiWithoutDeals(DEMO) })
    await renderTab(DEMO)
    const rows = Array.from(container.querySelectorAll('[data-testid="campaigns-analytics-top"] .min-w-0'))
    const smsRow = rows.find((row) => row.textContent?.includes(byName("SMS: həftəsonu").name))
    expect(smsRow?.textContent).toContain("— topOpen")
    expect(smsRow?.textContent).not.toContain("0.0%")
  })

  it("counts segments, journeys and templates the organisation really has", async () => {
    serve({
      segments: [
        { id: "s1", name: "Bakı müştəriləri", isDynamic: true, contactCount: 312 },
        { id: "s2", name: "Topdan alıcılar", isDynamic: false, contactCount: 48 },
      ],
      journeys: [{ id: "j1", name: "Salamlama", status: "active", entryCount: 57, conversionCount: 6 }],
      templates: [{ id: "t1", category: "marketing", isActive: true }],
      roi: roiWithoutDeals([]),
    })
    await renderTab([])
    expect(widget("segments")).toContain("Bakı müştəriləri312")
    expect(widget("automation")).toContain("Salamlama57")
    expect(widget("automation")).toContain("10.5%")
    expect(widget("templates")).toContain("catMarketing1")
  })

  it("says the data could not be loaded instead of printing a number", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })))
    await renderTab(DEMO)
    for (const id of ["segments", "automation", "templates", "kpi-roi"]) {
      expect(widget(id), id).toContain("dataUnavailable")
      expect(widget(id), id).not.toMatch(/[1-9]/)
    }
  })
})
