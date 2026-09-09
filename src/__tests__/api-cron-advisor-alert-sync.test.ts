import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const db = {
  orgs: [{ id: "org-1" }],
}

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: vi.fn(() => null),
}))

vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: vi.fn((fn: () => unknown) => fn()),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findMany: vi.fn(async () => db.orgs),
    },
  },
}))

vi.mock("@/lib/ai/advisor/service", () => ({
  getAdvisorPayload: vi.fn(async () => ({
    capabilities: [],
    collectorHealth: [],
    overview: {
      totalSignals: 2,
      critical: 1,
      high: 1,
      medium: 0,
      low: 0,
      revenueAtRisk: 0,
      pendingActions: 0,
    },
    signals: [
      { id: "finance:1", severity: "critical" },
      { id: "sales:1", severity: "high" },
    ],
  })),
}))

import { POST } from "@/app/api/cron/advisor-alert-sync/route"
import { requireCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { getAdvisorPayload } from "@/lib/ai/advisor/service"

function req(url = "http://localhost/api/cron/advisor-alert-sync") {
  return new NextRequest(url, { method: "POST" })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.orgs = [{ id: "org-1" }]
  vi.mocked(requireCronAuth).mockReturnValue(null)
})

describe("POST /api/cron/advisor-alert-sync", () => {
  it("requires cron auth before syncing Advisor proactive alerts", async () => {
    const authError = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    vi.mocked(requireCronAuth).mockReturnValue(authError)

    const res = await POST(req())
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
    expect(getAdvisorPayload).not.toHaveBeenCalled()
  })

  it("syncs Advisor alerts through an explicit cron path", async () => {
    const res = await POST(req("http://localhost/api/cron/advisor-alert-sync?organizationId=org-1"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(prisma.organization.findMany).toHaveBeenCalledWith({
      where: { isActive: true, id: "org-1" },
      select: { id: true },
      take: 1,
    })
    expect(getAdvisorPayload).toHaveBeenCalledWith("org-1", undefined, undefined, { syncAlerts: true })
    expect(json).toMatchObject({
      ok: true,
      scannedOrganizations: 1,
      results: [{ organizationId: "org-1", ok: true, signals: 2, alerts: 2 }],
    })
  })
})
