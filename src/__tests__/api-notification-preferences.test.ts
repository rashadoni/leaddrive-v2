import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/* ─── Mocks ──────────────────────────────────────────────────────────── */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userPreference: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation(
    (r: any) =>
      r instanceof Response ||
      (r && r.status !== undefined && typeof r.json === "function" && !r.orgId),
  ),
  getOrgModuleContext: vi.fn(),
}))

import { GET, PUT } from "@/app/api/v1/users/me/notification-preferences/route"
import { prisma } from "@/lib/prisma"
import { requireSessionAuth, isAuthError, getOrgModuleContext } from "@/lib/api-auth"

const mockRequireSessionAuth = requireSessionAuth as unknown as ReturnType<typeof vi.fn>
const mockIsAuthError = isAuthError as unknown as ReturnType<typeof vi.fn>
const mockGetOrgModuleContext = getOrgModuleContext as unknown as ReturnType<typeof vi.fn>
const mockFindUnique = prisma.userPreference.findUnique as ReturnType<typeof vi.fn>
const mockUpsert = prisma.userPreference.upsert as ReturnType<typeof vi.fn>

function makeReq(method: string, body?: Record<string, unknown>): NextRequest {
  const url = "http://localhost:3000/api/v1/users/me/notification-preferences"
  if (method === "GET") return new NextRequest(url, { method })
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Full-access org context: admin role + all modules on.
// This ensures canNotifySection returns true for "CRM" (and other sections)
// so the access gate passes and we can exercise the upsert path.
const fullAccessOrgCtx = {
  plan: "enterprise",
  addons: [] as string[],
  modules: {
    core: true,
    deals: true,
    leads: true,
    tasks: true,
    contracts: true,
    tickets: true,
    campaigns: true,
    invoices: true,
    budgeting: true,
    profitability: true,
    reports: true,
    omnichannel: true,
    voip: true,
    "knowledge-base": true,
    ai: true,
  } as Record<string, boolean>,
}

const SESSION = { userId: "user-1", orgId: "org-abc", role: "admin" }

describe("GET /api/v1/users/me/notification-preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireSessionAuth.mockResolvedValue(SESSION)
    mockIsAuthError.mockReturnValue(false)
    mockGetOrgModuleContext.mockResolvedValue(fullAccessOrgCtx)
    mockFindUnique.mockResolvedValue(null)
  })

  it("returns sections with accessible flags for admin with full org", async () => {
    const res = await GET(makeReq("GET"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(Array.isArray(json.data.sections)).toBe(true)
    // At least CRM should appear and be accessible for admin with all modules
    const crm = json.data.sections.find((s: any) => s.key === "CRM")
    expect(crm).toBeDefined()
    expect(crm.accessible).toBe(true)
  })

  it("CLM: Contracts Control section appears with contract notification kinds", async () => {
    const res = await GET(makeReq("GET"))
    expect(res.status).toBe(200)
    const json = await res.json()
    const contractsSection = json.data.sections.find((s: any) => s.key === "Contracts Control")
    expect(contractsSection).toBeDefined()
    // Section must have types (non-empty) — this is the core assertion for the bug fix.
    // The route returns types: Array<{key, enabled}> derived from kindsForSection().
    expect(Array.isArray(contractsSection.types)).toBe(true)
    expect(contractsSection.types.length).toBeGreaterThan(0)
    const typeKeys: string[] = contractsSection.types.map((t: any) => t.key)
    expect(typeKeys).toContain("contract.approval_requested")
    expect(typeKeys).toContain("contract.approved")
    expect(typeKeys).toContain("contract.signed")
    expect(typeKeys).toContain("contract.declined")
    expect(typeKeys).toContain("contract.renewal_due")
  })

  it("returns 401 when requireSessionAuth returns an error response", async () => {
    const fakeResponse = new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
    mockRequireSessionAuth.mockResolvedValue(fakeResponse)
    mockIsAuthError.mockReturnValue(true)

    const res = await GET(makeReq("GET"))
    expect(res.status).toBe(401)
  })
})

describe("PUT /api/v1/users/me/notification-preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireSessionAuth.mockResolvedValue(SESSION)
    mockIsAuthError.mockReturnValue(false)
    mockGetOrgModuleContext.mockResolvedValue(fullAccessOrgCtx)
    mockFindUnique.mockResolvedValue(null) // no existing row → triggers create branch
    mockUpsert.mockResolvedValue({
      userId: SESSION.userId,
      organizationId: SESSION.orgId,
      data: {},
    })
  })

  // BUG B regression: when no existing row exists, the upsert create branch
  // MUST include organizationId (required field on UserPreference).
  // Without the fix, the create branch omitted it → Prisma threw → 500.
  it("BUG B regression: create branch includes organizationId from session", async () => {
    const res = await PUT(makeReq("PUT", { section: "CRM", push: true }))
    expect(res.status).toBe(200)

    expect(mockUpsert).toHaveBeenCalledOnce()
    const call = mockUpsert.mock.calls[0][0]

    // The create branch must carry organizationId = session.orgId
    expect(call.create).toBeDefined()
    expect(call.create.organizationId).toBe(SESSION.orgId)
    // And userId must also be present
    expect(call.create.userId).toBe(SESSION.userId)
  })

  it("returns 400 for an inaccessible section", async () => {
    // "Health Cloud" requires the "health" module. With modules:{} (health absent),
    // canNotifySection("Health Cloud") returns false → route must reject with 400.
    mockGetOrgModuleContext.mockResolvedValue({
      plan: "free",
      addons: [],
      modules: {} as Record<string, boolean>,
    })

    const res = await PUT(makeReq("PUT", { section: "Health Cloud", push: true }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/inaccessible/i)
  })

  it("returns 400 for an unknown types key", async () => {
    const res = await PUT(makeReq("PUT", { section: "CRM", types: { "bogus.key": true } }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/validation/i)
  })

  it("returns 200 and updates push flag when section is accessible", async () => {
    // Simulate an existing row so the update branch also works
    mockFindUnique.mockResolvedValue({
      userId: SESSION.userId,
      data: { notificationPreferences: { CRM: { push: false } } },
    })

    const res = await PUT(makeReq("PUT", { section: "CRM", push: true }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.section.key).toBe("CRM")
    expect(json.data.section.push).toBe(true)
  })
})
