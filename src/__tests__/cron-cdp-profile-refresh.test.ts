/**
 * CDP profile-refresh cron — route handler tests.
 *
 * The heavy lifting (buildProfilesForOrg) is unit-tested separately in
 * lib-cdp-profile-builder.test.ts. Here we lock the route contract:
 *   • x-cron-secret gating (401 without / with wrong secret)
 *   • iterates active orgs and calls the builder once per org
 *   • per-org failure isolation — one tenant throwing doesn't abort the run
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findMany: vi.fn() } },
}))
vi.mock("@/lib/unified-profile/profile-builder", () => ({
  buildProfilesForOrg: vi.fn(),
}))

import { POST } from "@/app/api/cron/cdp-profile-refresh/route"
import { prisma } from "@/lib/prisma"
import { buildProfilesForOrg } from "@/lib/unified-profile/profile-builder"

const SECRET = "test-cron-secret"

function makeReq(secret?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (secret !== undefined) headers["x-cron-secret"] = secret
  return new NextRequest(new URL("http://localhost:3000/api/cron/cdp-profile-refresh"), {
    method: "POST",
    headers,
  })
}

const ZERO = { profilesCreated: 0, profilesUpdated: 0, sourcesLinked: 0, mergeCandidates: 0, rejected: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
})

describe("POST /api/cron/cdp-profile-refresh — auth", () => {
  it("401 when secret header is missing", async () => {
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
    expect(prisma.organization.findMany).not.toHaveBeenCalled()
  })

  it("401 when secret is wrong", async () => {
    const res = await POST(makeReq("nope"))
    expect(res.status).toBe(401)
  })

  it("503 when CRON_SECRET is not configured (closed-by-default, requireCronAuth)", async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeReq("anything"))
    expect(res.status).toBe(503)
  })
})

describe("POST /api/cron/cdp-profile-refresh — run", () => {
  it("calls the builder once per active org and sums totals", async () => {
    ;(prisma.organization.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "o1" },
      { id: "o2" },
    ])
    ;(buildProfilesForOrg as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ZERO,
      profilesCreated: 3,
      sourcesLinked: 3,
    })

    const res = await POST(makeReq(SECRET))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.orgsProcessed).toBe(2)
    expect(buildProfilesForOrg).toHaveBeenCalledTimes(2)
    expect(body.totals.profilesCreated).toBe(6) // 3 + 3
    expect(body.totals.sourcesLinked).toBe(6)
  })

  it("isolates a per-org failure — other orgs still processed", async () => {
    ;(prisma.organization.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ok1" },
      { id: "boom" },
      { id: "ok2" },
    ])
    ;(buildProfilesForOrg as ReturnType<typeof vi.fn>).mockImplementation(async (_c: unknown, orgId: string) => {
      if (orgId === "boom") throw new Error("db exploded")
      return { ...ZERO, profilesUpdated: 1 }
    })

    const res = await POST(makeReq(SECRET))
    const body = await res.json()

    // W1.5: a per-org failure surfaces as 207 + ok:false + errorCount, so the
    // shell wrapper (HTTP != 200) flags it instead of reporting false-green.
    expect(res.status).toBe(207)
    expect(body.ok).toBe(false)
    expect(body.errorCount).toBe(1)
    expect(body.orgsProcessed).toBe(3)
    expect(buildProfilesForOrg).toHaveBeenCalledTimes(3)
    expect(body.totals.profilesUpdated).toBe(2) // ok1 + ok2
    const boom = body.perOrg.find((r: { organizationId: string }) => r.organizationId === "boom")
    expect(boom.error).toContain("db exploded")
  })
})
