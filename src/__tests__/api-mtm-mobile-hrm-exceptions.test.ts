import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET } from "@/app/api/v1/mtm/mobile/hrm/exceptions/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"

function request() {
  return new NextRequest("http://localhost/api/v1/mtm/mobile/hrm/exceptions", {
    headers: { Authorization: "Bearer mobile" },
  })
}

const AUTH = {
  orgId: "org-1",
  agentId: "agent-1",
  role: "AGENT",
  tenantCapabilities: { routeField: false, workforceHrm: true },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
  vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([])
})

describe("GET /api/v1/mtm/mobile/hrm/exceptions", () => {
  it("returns only the authenticated employee's bounded generic correction cards", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([{
      id: "case-00000001",
      kind: "LATE_START",
      createdAt: new Date("2026-08-31T09:00:00.000Z"),
      workday: { id: "workday-1", workDate: new Date("2026-08-30T00:00:00.000Z") },
      rawLocation: "RAW_LOCATION_MUST_NOT_LEAK",
      qrPayload: "RAW_QR_MUST_NOT_LEAK",
      deviceProof: "RAW_DEVICE_MUST_NOT_LEAK",
      reason: "RAW_REASON_MUST_NOT_LEAK",
    }] as never)

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      data: {
        disposition: "SELF_SERVICE_CORRECTION_ONLY",
        responseRecording: "MIGRATION_REQUIRED",
        cases: [{
          caseId: "case-00000001",
          displayReference: "WF-00000001",
          type: "LATE_START",
          workdayId: "workday-1",
          availableAction: "REQUEST_CORRECTION",
        }],
      },
    })
    expect(JSON.stringify(body)).not.toMatch(/RAW_LOCATION|RAW_QR|RAW_DEVICE|RAW_REASON/)
    expect(prisma.workforceExceptionCase.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", agentId: "agent-1", workdayId: { not: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 101,
      select: {
        id: true,
        kind: true,
        createdAt: true,
        workday: { select: { id: true, workDate: true } },
      },
    })
  })

  it("rejects a disabled tenant before reading employee or exception records", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as never)

    const response = await GET(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: "TENANT_CAPABILITY_DISABLED",
      capabilityId: "workforce-hrm",
    })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionCase.findMany).not.toHaveBeenCalled()
  })

  it("fails closed instead of silently truncating more than one safe page", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue(
      Array.from({ length: 101 }, () => ({
        id: "case-00000001",
        kind: "LATE_START",
        createdAt: new Date("2026-08-31T09:00:00.000Z"),
        workday: { id: "workday-1", workDate: new Date("2026-08-30T00:00:00.000Z") },
      })) as never,
    )

    const response = await GET(request())

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_SELF_EXCEPTION_LIMIT_EXCEEDED" })
  })
})
