/**
 * CDP identity-scan cron — route handler tests.
 *
 * The sweep itself (scanFuzzyDuplicatesForOrg) is unit-tested in
 * lib-cdp-fuzzy-duplicate-scan.test.ts. Here we lock the route contract,
 * mirroring cron-cdp-profile-refresh:
 *   • x-cron-secret gating (401 without / wrong / unset)
 *   • runs the scan once per active org and sums totals
 *   • per-org failure isolation → 207 + ok:false + errorCount
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findMany: vi.fn() } },
}))
vi.mock("@/lib/identity-resolution/fuzzy-duplicate-scan", () => ({
  scanFuzzyDuplicatesForOrg: vi.fn(),
}))

import { POST } from "@/app/api/cron/cdp-identity-scan/route"
import { prisma } from "@/lib/prisma"
import { scanFuzzyDuplicatesForOrg } from "@/lib/identity-resolution/fuzzy-duplicate-scan"

const SECRET = "test-cron-secret"

function makeReq(secret?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (secret !== undefined) headers["x-cron-secret"] = secret
  return new NextRequest(new URL("http://localhost:3000/api/cron/cdp-identity-scan"), {
    method: "POST",
    headers,
  })
}

const ZERO = {
  profilesScanned: 0,
  comparisons: 0,
  candidatesCreated: 0,
  skippedExisting: 0,
  truncated: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
})

describe("POST /api/cron/cdp-identity-scan — auth", () => {
  it("401 when secret header is missing", async () => {
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
    expect(prisma.organization.findMany).not.toHaveBeenCalled()
  })

  it("401 when secret is wrong", async () => {
    const res = await POST(makeReq("nope"))
    expect(res.status).toBe(401)
  })

  it("503 when CRON_SECRET is not configured (fail-closed)", async () => {
    // requireCronAuth's documented contract: 503 when CRON_SECRET is UNSET
    // (server misconfiguration), 401 on a present-but-wrong secret. The prior
    // assertion (401) was wrong — fails identically against the pre-wrap HEAD
    // route, so this is a pre-existing test-expectation bug, not the RLS wrap.
    delete process.env.CRON_SECRET
    const res = await POST(makeReq("anything"))
    expect(res.status).toBe(503)
  })
})

describe("POST /api/cron/cdp-identity-scan — run", () => {
  it("runs the scan once per active org and sums totals", async () => {
    ;(prisma.organization.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "o1" },
      { id: "o2" },
    ])
    ;(scanFuzzyDuplicatesForOrg as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ZERO,
      profilesScanned: 10,
      candidatesCreated: 2,
    })

    const res = await POST(makeReq(SECRET))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.orgsProcessed).toBe(2)
    expect(scanFuzzyDuplicatesForOrg).toHaveBeenCalledTimes(2)
    expect(body.totals.candidatesCreated).toBe(4) // 2 + 2
    expect(body.totals.profilesScanned).toBe(20)
  })

  it("counts truncated orgs without aborting", async () => {
    ;(prisma.organization.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "big" }])
    ;(scanFuzzyDuplicatesForOrg as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ZERO,
      profilesScanned: 2000,
      truncated: true,
    })
    const res = await POST(makeReq(SECRET))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.totals.truncatedOrgs).toBe(1)
  })

  it("isolates a per-org failure — other orgs still processed", async () => {
    ;(prisma.organization.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ok1" },
      { id: "boom" },
      { id: "ok2" },
    ])
    ;(scanFuzzyDuplicatesForOrg as ReturnType<typeof vi.fn>).mockImplementation(
      async (_c: unknown, orgId: string) => {
        if (orgId === "boom") throw new Error("db exploded")
        return { ...ZERO, candidatesCreated: 1 }
      },
    )

    const res = await POST(makeReq(SECRET))
    const body = await res.json()

    expect(res.status).toBe(207)
    expect(body.ok).toBe(false)
    expect(body.errorCount).toBe(1)
    expect(body.orgsProcessed).toBe(3)
    expect(scanFuzzyDuplicatesForOrg).toHaveBeenCalledTimes(3)
    expect(body.totals.candidatesCreated).toBe(2) // ok1 + ok2
    const boom = body.perOrg.find((r: { organizationId: string }) => r.organizationId === "boom")
    expect(boom.error).toContain("db exploded")
  })
})
