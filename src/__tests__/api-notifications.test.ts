import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    deal: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getOrgModuleContext: vi.fn(),
  getSession: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/constants", () => ({ PAGE_SIZE: { DEFAULT: 50 } }))

import { GET, PATCH } from "@/app/api/v1/notifications/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getOrgModuleContext, getSession } from "@/lib/api-auth"
import { auth } from "@/lib/auth"

const mockGetOrgId = getOrgId as ReturnType<typeof vi.fn>
const mockGetOrgModuleContext = getOrgModuleContext as ReturnType<typeof vi.fn>
const mockAuth = auth as ReturnType<typeof vi.fn>
// notifications/route now reads role/userId from the withRls-passed session (getSession),
// not auth(); mirror each mockAuth role-set onto getSession.
const mockGetSession = getSession as ReturnType<typeof vi.fn>
const mockFindMany = prisma.notification.findMany as ReturnType<typeof vi.fn>
const mockCount = prisma.notification.count as ReturnType<typeof vi.fn>
const mockUpdateMany = prisma.notification.updateMany as ReturnType<typeof vi.fn>
const mockDealFindMany = prisma.deal.findMany as ReturnType<typeof vi.fn>

function makeReq(method: string, body?: Record<string, unknown>): NextRequest {
  const url = "http://localhost:3000/api/v1/notifications"
  if (method === "GET") return new NextRequest(url, { method })
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Full-access org context: admin role (wildcard read) + all modules on.
// Ensures canNotifyEntityType returns true for all known entityTypes.
const fullAccessOrgCtx = {
  plan: "enterprise",
  addons: [] as string[],
  modules: {
    core: true, deals: true, leads: true, tasks: true, contracts: true,
    tickets: true, campaigns: true, invoices: true, budgeting: true,
    profitability: true, reports: true, omnichannel: true, voip: true,
    // `social` is its own group-module since the 2026-08-01 split — social_mention
    // notifications now follow the Social Monitoring toggle, not the inbox's.
    social: true,
    "knowledge-base": true, ai: true,
  } as Record<string, boolean>,
}

type EntityTypeInClause = { entityType?: { in?: string[] } | null }

describe("GET /api/v1/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOrgId.mockResolvedValue("org-1")
    // Session user has admin role — wildcard read means all entityTypes are allowed.
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "admin" } })
    mockGetSession.mockResolvedValue({ orgId: "org-1", userId: "user-1", role: "admin" })
    // Provide a valid org context so the access gate runs the normal (non-error) path.
    mockGetOrgModuleContext.mockResolvedValue(fullAccessOrgCtx)
    mockDealFindMany.mockResolvedValue([])
  })

  it("returns 401 when orgId is missing", async () => {
    mockGetOrgId.mockResolvedValue(null)
    mockGetSession.mockResolvedValue(null)
    const res = await GET(makeReq("GET"))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("Unauthorized")
  })

  // FIX D: no userId → 401
  it("FIX D: returns 401 when session has no userId (no all-org fallback)", async () => {
    mockAuth.mockResolvedValue(null)
    mockGetSession.mockResolvedValue(null)
    const res = await GET(makeReq("GET"))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("Unauthorized")
  })

  it("FIX D: returns 401 when session exists but has no user id", async () => {
    mockAuth.mockResolvedValue({ user: { role: "admin" } }) // no id field
    mockGetSession.mockResolvedValue({ orgId: "org-1", role: "admin" })
    const res = await GET(makeReq("GET"))
    expect(res.status).toBe(401)
  })

  it("returns notifications and unreadCount", async () => {
    const fakeNotifications = [
      { id: "n1", title: "Hello", isRead: false },
      { id: "n2", title: "World", isRead: true },
    ]
    mockFindMany.mockResolvedValue(fakeNotifications)
    mockCount.mockResolvedValue(1)

    const res = await GET(makeReq("GET"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.notifications).toEqual([
      { ...fakeNotifications[0], url: null, targetMissing: false },
      { ...fakeNotifications[1], url: null, targetMissing: false },
    ])
    expect(json.data.unreadCount).toBe(1)
  })

  it("falls back stale deal notifications to the deals list", async () => {
    const fakeNotifications = [
      { id: "n1", title: "Missing deal", entityType: "deal", entityId: "deal-missing", isRead: false },
      { id: "n2", title: "Existing deal", entityType: "deal", entityId: "deal-live", isRead: true },
    ]
    mockFindMany.mockResolvedValue(fakeNotifications)
    mockCount.mockResolvedValue(2)
    mockDealFindMany.mockResolvedValue([{ id: "deal-live" }])

    const res = await GET(makeReq("GET"))

    expect(res.status).toBe(200)
    expect(mockDealFindMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", id: { in: ["deal-missing", "deal-live"] } },
      select: { id: true },
    })
    const json = await res.json()
    expect(json.data.notifications).toEqual([
      { ...fakeNotifications[0], url: "/deals", targetMissing: true },
      { ...fakeNotifications[1], url: "/deals/deal-live", targetMissing: false },
    ])
  })

  // FIX B: allowlist where-shape — admin sees all mapped entityTypes + null
  it("FIX B: allowlist where uses AND of [recipientOR, entityTypeOR] for admin with full org", async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await GET(makeReq("GET"))

    const call = mockFindMany.mock.calls[0]?.[0]
    expect(call).toBeDefined()
    // Must use AND of two OR-groups (recipient scope + entityType allowlist)
    expect(call.where.AND).toBeDefined()
    expect(Array.isArray(call.where.AND)).toBe(true)

    // First group: recipient scope
    const recipientGroup = call.where.AND[0]
    expect(recipientGroup.OR).toBeDefined()
    expect(recipientGroup.OR).toContainEqual({ userId: "user-1" })
    expect(recipientGroup.OR).toContainEqual({ userId: "" })

    // Second group: entityType allowlist
    const entityTypeGroup = call.where.AND[1]
    expect(entityTypeGroup.OR).toBeDefined()
    // Must include null-entityType pass-through
    expect(entityTypeGroup.OR).toContainEqual({ entityType: null })
    // Must include the allowed set
    const inClause = (entityTypeGroup.OR as EntityTypeInClause[]).find((c) => c.entityType?.in)
    expect(inClause).toBeDefined()
    // All mapped entityTypes must be in the allowlist for admin with all modules
    const allowedList: string[] = inClause?.entityType?.in ?? []
    expect(allowedList).toContain("task")
    expect(allowedList).toContain("deal")
    expect(allowedList).toContain("campaign")
    expect(allowedList).toContain("ticket")
    expect(allowedList).toContain("invoice")
    expect(allowedList).toContain("social_mention")
    expect(allowedList).toContain("briefing")
    expect(allowedList).toContain("budget_plan")
  })

  // FIX A + B: support role with campaigns module on — campaign NOT in allowed list
  it("FIX A+B: support role: campaign excluded from allowlist (campaigns:[] in role matrix)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-support", role: "support" } })
    mockGetSession.mockResolvedValue({ orgId: "org-1", userId: "user-support", role: "support" })
    // campaigns module is on at the org level, but support role has no campaigns:read
    mockGetOrgModuleContext.mockResolvedValue(fullAccessOrgCtx)
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await GET(makeReq("GET"))

    const call = mockFindMany.mock.calls[0]?.[0]
    const entityTypeGroup = call.where.AND[1]
    const inClause = (entityTypeGroup.OR as EntityTypeInClause[]).find((c) => c.entityType?.in)
    const allowedList: string[] = inClause?.entityType?.in ?? []

    // campaign must NOT be in the allowlist for support role
    expect(allowedList).not.toContain("campaign")
    // null-entityType rows (system messages) must still be visible
    expect(entityTypeGroup.OR).toContainEqual({ entityType: null })
    // ticket should be allowed (support has tickets:read)
    expect(allowedList).toContain("ticket")
  })

  // FIX B: unmapped/unknown entityType not in allowed → excluded
  it("FIX B: unmapped entityType is not in allowed list (fail-closed)", async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await GET(makeReq("GET"))

    const call = mockFindMany.mock.calls[0]?.[0]
    const entityTypeGroup = call.where.AND[1]
    const inClause = (entityTypeGroup.OR as EntityTypeInClause[]).find((c) => c.entityType?.in)
    const allowedList: string[] = inClause?.entityType?.in ?? []

    // An unmapped entityType must not appear
    expect(allowedList).not.toContain("unknown_unmapped_type")
  })

  // FIX B: entityType=null rows always visible (system messages)
  it("FIX B: null-entityType rows visible in all cases", async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await GET(makeReq("GET"))

    const call = mockFindMany.mock.calls[0]?.[0]
    const entityTypeGroup = call.where.AND[1]
    expect(entityTypeGroup.OR).toContainEqual({ entityType: null })
  })

  it("returns 500 on DB error", async () => {
    mockFindMany.mockRejectedValue(new Error("DB down"))

    const res = await GET(makeReq("GET"))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe("Internal server error")
  })

  // FIX B: fail-CLOSED on ctx error → allowed=[] → only null-entityType rows
  it("FIX B fail-CLOSED: when getOrgModuleContext throws, only null-entityType rows visible", async () => {
    mockGetOrgModuleContext.mockRejectedValue(new Error("DB timeout"))
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await GET(makeReq("GET"))

    const call = mockFindMany.mock.calls[0]?.[0]
    expect(call).toBeDefined()

    // With allowed=[], entityType filter must be { entityType: null } only
    // (no in-list clause, no NOT filter)
    const entityTypeGroup = call.where.AND[1]
    // Should be { entityType: null } — only null rows pass
    expect(entityTypeGroup).toEqual({ entityType: null })
  })
})

describe("PATCH /api/v1/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOrgId.mockResolvedValue("org-1")
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "admin" } })
    mockGetSession.mockResolvedValue({ orgId: "org-1", userId: "user-1", role: "admin" })
    mockUpdateMany.mockResolvedValue({ count: 3 })
    // PATCH applies the SAME entityType allowlist as GET (gate consistency)
    mockGetOrgModuleContext.mockResolvedValue(fullAccessOrgCtx)
  })

  it("returns 401 when orgId is missing", async () => {
    mockGetOrgId.mockResolvedValue(null)
    mockGetSession.mockResolvedValue(null)
    const res = await PATCH(makeReq("PATCH", { markAll: true }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("Unauthorized")
  })

  // FIX D: PATCH also requires end-user
  it("FIX D: PATCH returns 401 when session has no userId", async () => {
    mockAuth.mockResolvedValue(null)
    mockGetSession.mockResolvedValue(null)
    const res = await PATCH(makeReq("PATCH", { markAll: true }))
    expect(res.status).toBe(401)
  })

  it("marks all user unread notifications as read when markAll=true", async () => {
    const res = await PATCH(makeReq("PATCH", { markAll: true }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)

    const call = mockUpdateMany.mock.calls[0]?.[0]
    expect(call.where.organizationId).toBe("org-1")
    expect(call.where.isRead).toBe(false)
    expect(call.data).toEqual({ isRead: true })
    // recipient scope + entityType allowlist both applied via AND
    expect(call.where.AND[0].OR).toContainEqual({ userId: "user-1" })
    expect(call.where.AND[0].OR).toContainEqual({ userId: "" })
    expect(call.where.AND[1]).toBeDefined() // entityType allowlist (gate consistency with GET)
  })

  // FIX C: IDOR — ids branch must include recipient scope
  it("FIX C: IDOR fix — marks specific ids as read WITH recipient scope", async () => {
    const ids = ["n1", "n2", "n3"]
    const res = await PATCH(makeReq("PATCH", { ids }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)

    const call = mockUpdateMany.mock.calls[0]?.[0]
    expect(call.where.id).toEqual({ in: ids })
    expect(call.where.organizationId).toBe("org-1")
    expect(call.where.AND[0].OR).toContainEqual({ userId: "user-1" })
    expect(call.where.AND[0].OR).toContainEqual({ userId: "" })
    expect(call.where.AND[1]).toBeDefined() // entityType allowlist (gate consistency with GET)
  })

  it("FIX C: IDOR fix — ids where clause must NOT be missing recipient scope", async () => {
    const ids = ["n1"]
    await PATCH(makeReq("PATCH", { ids }))

    const call = mockUpdateMany.mock.calls[0]?.[0]
    // recipient scope now nested under AND[0] (alongside the entityType allowlist)
    expect(call.where.AND[0].OR).toBeDefined()
    expect(call.where.AND[0].OR).toContainEqual({ userId: "user-1" })
    expect(call.where.AND[0].OR).toContainEqual({ userId: "" })
  })
})
