/**
 * T8 Cobrowse slice-3c — GET /api/v1/cobrowse/sessions list tests.
 *
 * Covers: auth gate, cross-tenant scoping, agent-scoping (mine=true
 * default), status filter (comma-separated), limit cap, secret-
 * exclusion (joinToken NEVER in list projection).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cobrowseSession: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof Response),
}))

import { GET } from "@/app/api/v1/cobrowse/sessions/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

function makeReq(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method: "GET" })
}
const auth = (orgId = "org1", userId = "u1") => ({
  orgId, userId, role: "admin", email: "", name: "",
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/v1/cobrowse/sessions — auth", () => {
  it("propagates auth error", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response("Unauthorized", { status: 401 }) as never)
    const res = await GET(makeReq("/api/v1/cobrowse/sessions"))
    expect(res.status).toBe(401)
  })
})

describe("GET /api/v1/cobrowse/sessions — scoping", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([])
  })

  it("scopes by organizationId AND agentUserId by default (mine=true)", async () => {
    await GET(makeReq("/api/v1/cobrowse/sessions"))
    expect(prisma.cobrowseSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org1", agentUserId: "u1" },
      }),
    )
  })

  it("widens to org-wide when mine=false", async () => {
    await GET(makeReq("/api/v1/cobrowse/sessions?mine=false"))
    const call = vi.mocked(prisma.cobrowseSession.findMany).mock.calls[0][0]
    expect(call?.where).toEqual({ organizationId: "org1" })
    expect((call?.where as Record<string, unknown>).agentUserId).toBeUndefined()
  })
})

describe("GET /api/v1/cobrowse/sessions — status filter", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([])
  })

  it("accepts single status", async () => {
    await GET(makeReq("/api/v1/cobrowse/sessions?status=active"))
    const call = vi.mocked(prisma.cobrowseSession.findMany).mock.calls[0][0]
    expect((call?.where as Record<string, unknown>).status).toEqual({ in: ["active"] })
  })

  it("accepts comma-separated multi-status", async () => {
    await GET(makeReq("/api/v1/cobrowse/sessions?status=active,paused"))
    const call = vi.mocked(prisma.cobrowseSession.findMany).mock.calls[0][0]
    expect((call?.where as Record<string, unknown>).status).toEqual({ in: ["active", "paused"] })
  })

  it("400 on unknown status value", async () => {
    const res = await GET(makeReq("/api/v1/cobrowse/sessions?status=zombie"))
    expect(res.status).toBe(400)
  })

  it("400 on a mix of valid+invalid status values", async () => {
    const res = await GET(makeReq("/api/v1/cobrowse/sessions?status=active,zombie"))
    expect(res.status).toBe(400)
    expect(prisma.cobrowseSession.findMany).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/cobrowse/sessions — limit", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([])
  })

  it("defaults to 50 when no limit param", async () => {
    await GET(makeReq("/api/v1/cobrowse/sessions"))
    expect(prisma.cobrowseSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    )
  })

  it("caps at 100 even with absurd query", async () => {
    await GET(makeReq("/api/v1/cobrowse/sessions?limit=9999"))
    expect(prisma.cobrowseSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    )
  })

  it("falls back to default 50 on non-numeric limit", async () => {
    await GET(makeReq("/api/v1/cobrowse/sessions?limit=banana"))
    expect(prisma.cobrowseSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    )
  })
})

describe("GET /api/v1/cobrowse/sessions — secret exclusion", () => {
  it("joinToken is NOT in the select projection", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([])
    await GET(makeReq("/api/v1/cobrowse/sessions"))
    const call = vi.mocked(prisma.cobrowseSession.findMany).mock.calls[0][0]
    // joinToken must NEVER appear in list payloads — secrets stay
    // behind the per-id endpoint.
    expect((call?.select as Record<string, unknown>).joinToken).toBeUndefined()
    // Sanity: the public fields ARE selected.
    expect((call?.select as Record<string, unknown>).id).toBe(true)
    expect((call?.select as Record<string, unknown>).status).toBe(true)
    expect((call?.select as Record<string, unknown>).startedAt).toBe(true)
  })
})

describe("GET /api/v1/cobrowse/sessions — ordering", () => {
  it("orders by startedAt desc (newest first)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([])
    await GET(makeReq("/api/v1/cobrowse/sessions"))
    expect(prisma.cobrowseSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startedAt: "desc" } }),
    )
  })
})
