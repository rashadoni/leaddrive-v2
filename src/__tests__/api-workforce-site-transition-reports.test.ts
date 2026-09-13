import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workforceSiteTransition: { findMany: vi.fn() },
    workforceSite: { findMany: vi.fn() },
    mtmAgent: { findFirst: vi.fn(), findMany: vi.fn() },
    mtmTeamMember: { findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
    workforceAccessGrant: { findMany: vi.fn() },
    mtmAuditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: vi.fn() }))
vi.mock("@/lib/workforce/approved-report-rate-limit", () => ({
  requireWorkforceSiteTransitionReportRateLimit: vi.fn(async () => null),
}))
vi.mock("@/lib/workforce/site-transition-report-access", () => ({
  requireWorkforceSiteTransitionReportAccess: vi.fn(async () => null),
}))
vi.mock("@/lib/workforce/sensitive-operation-log", () => ({
  logWorkforceSensitiveOperationFailure: vi.fn(),
}))

import { GET } from "@/app/api/v1/workforce/site-transition-reports/route"
import { getMtmSettings } from "@/lib/mtm-settings"
import { prisma } from "@/lib/prisma"
import { requireWorkforceSiteTransitionReportRateLimit } from "@/lib/workforce/approved-report-rate-limit"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"

const AUTH = { orgId: "org-1", userId: "admin-1", role: "admin", principalType: "session" as const }
const invoke = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function transition(kind: "ARRIVAL" | "DEPARTURE") {
  return {
    agentId: "agent-1",
    workdayId: "workday-1",
    segmentId: "segment-1",
    kind,
    claimedAt: new Date(kind === "ARRIVAL" ? "2026-09-13T05:00:00.000Z" : "2026-09-13T09:00:00.000Z"),
    attendanceReviewState: "NOT_REQUIRED",
    segment: { siteId: "site-a" },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmTeamMember.findMany).mockResolvedValue([])
  vi.mocked(prisma.workforceSiteTransition.findMany).mockResolvedValue([])
  vi.mocked(prisma.workforceSite.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({} as never)
  vi.mocked(requireWorkforceSiteTransitionReportRateLimit).mockResolvedValue(null)
})

describe("GET /api/v1/workforce/site-transition-reports", () => {
  it("returns a tenant-local, named aggregate without raw proof", async () => {
    vi.mocked(prisma.workforceSiteTransition.findMany).mockResolvedValue([
      transition("ARRIVAL"),
      transition("DEPARTURE"),
    ] as never)
    vi.mocked(prisma.workforceSite.findMany).mockResolvedValue([{ id: "site-a", name: "Baku HQ" }] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1", name: "Worker One" }] as never)

    const response = await invoke(new NextRequest(
      "http://localhost/api/v1/workforce/site-transition-reports?start=2026-09-13&end=2026-09-13",
    ), AUTH)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      data: {
        timezone: "Asia/Baku",
        dateBasis: "CLAIMED_AT",
        report: {
          summary: { claims: 2, completedSegments: 1, incompleteSegments: 0 },
          bySite: [{ siteId: "site-a", name: "Baku HQ" }],
          byEmployee: [{ agentId: "agent-1", name: "Worker One" }],
          boundaries: { physicalPresence: "CLAIMS_ARE_NOT_PHYSICAL_PRESENCE" },
        },
      },
    })
    expect(JSON.stringify(body)).not.toMatch(/latitude|longitude|qrToken|deviceKey|distanceMeters/)
    expect(prisma.workforceSiteTransition.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        claimedAt: {
          gte: new Date("2026-09-12T20:00:00.000Z"),
          lt: new Date("2026-09-13T20:00:00.000Z"),
        },
      }),
      take: 5_001,
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_SITE_TRANSITION_REPORT_VIEWED",
        newData: expect.not.objectContaining({ agentId: expect.anything(), siteId: expect.anything() }),
      }),
    }))
  })

  it("rejects ambiguous site-and-employee filters before transition reads", async () => {
    const response = await invoke(new NextRequest(
      "http://localhost/api/v1/workforce/site-transition-reports?agentId=agent-1&siteId=site-a",
    ), AUTH)
    expect(response.status).toBe(403)
    expect(prisma.workforceSiteTransition.findMany).not.toHaveBeenCalled()
  })

  it("stops before actor, settings and reads when rate limited", async () => {
    vi.mocked(requireWorkforceSiteTransitionReportRateLimit).mockResolvedValueOnce(
      new Response(null, { status: 429 }) as never,
    )
    const response = await invoke(new NextRequest(
      "http://localhost/api/v1/workforce/site-transition-reports",
    ), AUTH)
    expect(response.status).toBe(429)
    expect(getMtmSettings).not.toHaveBeenCalled()
    expect(prisma.workforceSiteTransition.findMany).not.toHaveBeenCalled()
  })

  it("refuses an oversized report instead of truncating counts", async () => {
    vi.mocked(prisma.workforceSiteTransition.findMany).mockResolvedValue(
      Array.from({ length: 5_001 }, () => transition("ARRIVAL")) as never,
    )
    const response = await invoke(new NextRequest(
      "http://localhost/api/v1/workforce/site-transition-reports",
    ), AUTH)
    expect(response.status).toBe(413)
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("fails closed when a historical transition has no site", async () => {
    vi.mocked(prisma.workforceSiteTransition.findMany).mockResolvedValue([
      { ...transition("ARRIVAL"), segment: { siteId: null } },
    ] as never)
    const response = await invoke(new NextRequest(
      "http://localhost/api/v1/workforce/site-transition-reports",
    ), AUTH)
    expect(response.status).toBe(409)
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("contains unexpected failures with a fixed operation label", async () => {
    vi.mocked(prisma.workforceSiteTransition.findMany).mockRejectedValue(new Error("private db detail"))
    const response = await invoke(new NextRequest(
      "http://localhost/api/v1/workforce/site-transition-reports",
    ), AUTH)
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(logWorkforceSensitiveOperationFailure).toHaveBeenCalledWith({
      operation: "read-site-transition-report",
    })
  })
})
