/**
 * C3 — GET /api/v1/contacts/[id]/web-activity (contact card «Сайт» tab).
 * Convention: mock @/lib/prisma + @/lib/api-auth, real RLS wrappers,
 * Next 15 params as Promise.resolve({ id }).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findFirst: vi.fn() },
    webSession: { findMany: vi.fn(), aggregate: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((v: unknown) => v instanceof Response),
}))

import { GET } from "@/app/api/v1/contacts/[id]/web-activity/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"
import { classifyPageUrl } from "@/lib/account-engagement/track-pixel"

const req = (url = "http://localhost/api/v1/contacts/ct-1/web-activity") => new NextRequest(url)
const params = (id: string) => ({ params: Promise.resolve({ id }) })

const SESSION = {
  id: "ws-1",
  startedAt: new Date("2026-07-15T10:00:00Z"),
  lastSeenAt: new Date("2026-07-15T10:12:30Z"),
  pageViews: 3,
  entryUrl: "https://site.test/pricing",
  referrer: "https://google.com/",
  utmSource: "newsletter",
  utmMedium: "email",
  utmCampaign: "july",
  actions: [
    { id: "a1", type: "pageview", name: null, url: "https://site.test/pricing", createdAt: new Date("2026-07-15T10:00:00Z") },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1" as never)
  vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "ct-1" } as never)
  vi.mocked(prisma.webSession.findMany).mockResolvedValue([SESSION] as never)
  vi.mocked(prisma.webSession.aggregate).mockResolvedValue({ _count: 1, _sum: { pageViews: 3 } } as never)
})

describe("GET /api/v1/contacts/[id]/web-activity", () => {
  it("returns the contact's sessions with computed duration", async () => {
    const res = await GET(req(), params("ct-1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.totalSessions).toBe(1)
    expect(body.data.totalPageViews).toBe(3) // ALL-sessions sum from the aggregate
    expect(body.data.truncated).toBe(false)
    const s = body.data.sessions[0]
    expect(s.durationMinutes).toBe(13) // 12m30s rounds to 13
    expect(s.pageViews).toBe(3)
    expect(s.utmSource).toBe("newsletter")
    expect(s.actions).toHaveLength(1)
    // the query is contact- AND org-scoped, capped and newest-first — the
    // caps are load-bearing (card-sized payload), pin them
    const q = vi.mocked(prisma.webSession.findMany).mock.calls[0][0]
    expect(q?.where).toMatchObject({ organizationId: "org-1", contactId: "ct-1" })
    expect(q?.take).toBe(30)
    expect(q?.orderBy).toEqual({ startedAt: "desc" })
    expect(q?.select?.actions).toMatchObject({ take: 50, orderBy: { createdAt: "asc" } })
  })

  it("404s for a foreign/unknown contact (RLS fail-closed shape)", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null as never)
    const res = await GET(req(), params("ct-alien"))
    expect(res.status).toBe(404)
    expect(prisma.webSession.findMany).not.toHaveBeenCalled()
  })

  it("flags truncation when more sessions exist than returned", async () => {
    vi.mocked(prisma.webSession.aggregate).mockResolvedValue({ _count: 31, _sum: { pageViews: 90 } } as never)
    const res = await GET(req(), params("ct-1"))
    const body = await res.json()
    expect(body.data.truncated).toBe(true)
    expect(body.data.totalSessions).toBe(31)
    expect(body.data.totalPageViews).toBe(90)
  })

  it("401s without an org context", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as never)
    const res = await GET(req(), params("ct-1"))
    expect(res.status).toBe(401)
  })
})

/**
 * classifyPageUrl is the ONE buying-signal classifier — the C3 card badge and
 * the account-engagement pixel score both consume it, so the ru-market slugs
 * and the percent-decode step added for C3 are pinned here.
 */
describe("classifyPageUrl (shared hot-page classifier)", () => {
  it("flags canonical high-intent pages", () => {
    expect(classifyPageUrl("https://site.test/pricing")).toBe("page_view_high_intent")
    expect(classifyPageUrl("https://site.test/checkout?step=2")).toBe("page_view_high_intent")
  })

  it("flags ru-market slugs, decoding percent-encoded Cyrillic paths", () => {
    expect(classifyPageUrl("https://site.test/" + encodeURIComponent("цены"))).toBe("page_view_high_intent")
    expect(classifyPageUrl("https://site.test/" + encodeURIComponent("тарифы") + "?p=1")).toBe("page_view_high_intent")
    expect(classifyPageUrl("https://site.test/" + encodeURIComponent("корзина"))).toBe("page_view_high_intent")
  })

  it("segment-anchored ru fragments do not fire on lookalike words", () => {
    // "/оценка" (assessment) must NOT match the "/цен" fragment
    expect(classifyPageUrl("https://site.test/" + encodeURIComponent("оценка"))).toBe("page_view_research")
  })

  it("plain research pages stay research", () => {
    expect(classifyPageUrl("https://site.test/blog/post")).toBe("page_view_research")
    expect(classifyPageUrl(null)).toBe("page_view_research")
  })
})
