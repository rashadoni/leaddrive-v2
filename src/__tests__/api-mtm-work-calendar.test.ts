import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET, PUT } from "@/app/api/v1/mtm/work-calendar/route"
import { DELETE } from "@/app/api/v1/mtm/work-calendar/[id]/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const ADMIN_AUTH: AuthResult = {
  orgId: ORG,
  userId: "admin-user",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1]

function request(path: string, init?: NextRequestInit): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), init)
}

function putRequest(body: unknown): NextRequest {
  return request("/api/v1/mtm/work-calendar", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(ADMIN_AUTH)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmWorkCalendarDay.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as any)
})

describe("GET /api/v1/mtm/work-calendar", () => {
  it("returns an organization-scoped calendar range and management capability", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([{
      id: "holiday-1",
      organizationId: ORG,
      date: new Date("2026-07-15T00:00:00.000Z"),
      kind: "PUBLIC_HOLIDAY",
      team: null,
      agent: null,
    }] as any)

    const response = await GET(request(
      "/api/v1/mtm/work-calendar?start=2026-07-13&endExclusive=2026-07-20",
    ))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data).toMatchObject({
      timezone: "Asia/Baku",
      start: "2026-07-13",
      endExclusive: "2026-07-20",
      capabilities: { canManage: true },
    })
    expect(json.data.days).toHaveLength(1)

    const args = vi.mocked(prisma.mtmWorkCalendarDay.findMany).mock.calls[0][0] as any
    expect(args.where).toMatchObject({
      organizationId: ORG,
      deletedAt: null,
      date: {
        gte: new Date("2026-07-13T00:00:00.000Z"),
        lt: new Date("2026-07-20T00:00:00.000Z"),
      },
    })
  })

  it("rejects invalid or excessive ranges", async () => {
    const invalid = await GET(request(
      "/api/v1/mtm/work-calendar?start=2026-02-29&endExclusive=2026-03-02",
    ))
    expect(invalid.status).toBe(400)

    const excessive = await GET(request(
      "/api/v1/mtm/work-calendar?start=2026-01-01&endExclusive=2028-01-01",
    ))
    expect(excessive.status).toBe(400)
    expect(await excessive.json()).toMatchObject({ code: "MTM_CALENDAR_RANGE_TOO_LARGE" })
  })
})

describe("PUT /api/v1/mtm/work-calendar", () => {
  it("creates an organization calendar override and writes an audit event", async () => {
    const created = {
      id: "calendar-1",
      organizationId: ORG,
      date: new Date("2026-07-15T00:00:00.000Z"),
      kind: "PUBLIC_HOLIDAY",
      name: "National holiday",
      teamId: null,
      agentId: null,
    }
    vi.mocked(prisma.mtmWorkCalendarDay.create).mockResolvedValue(created as any)

    const response = await PUT(putRequest({
      date: "2026-07-15",
      kind: "PUBLIC_HOLIDAY",
      name: "National holiday",
    }))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ success: true, data: { id: "calendar-1" } })
    expect(prisma.mtmWorkCalendarDay.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        teamId: null,
        agentId: null,
        kind: "PUBLIC_HOLIDAY",
        createdBy: "admin-user",
      }),
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "WORK_CALENDAR_CREATE", organizationId: ORG }),
    }))
  })

  it("updates an existing scoped override instead of creating a duplicate", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findFirst).mockResolvedValue({
      id: "calendar-1",
      organizationId: ORG,
      date: new Date("2026-07-15T00:00:00.000Z"),
      kind: "PUBLIC_HOLIDAY",
    } as any)
    vi.mocked(prisma.mtmWorkCalendarDay.update).mockResolvedValue({
      id: "calendar-1",
      kind: "EXCEPTION_WORKDAY",
    } as any)

    const response = await PUT(putRequest({
      date: "2026-07-15",
      kind: "EXCEPTION_WORKDAY",
      routePlanningAllowed: true,
    }))
    expect(response.status).toBe(200)
    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()
    expect(prisma.mtmWorkCalendarDay.update).toHaveBeenCalledWith({
      where: { id: "calendar-1" },
      data: expect.objectContaining({ kind: "EXCEPTION_WORKDAY", routePlanningAllowed: true }),
    })
  })

  it("requires a destination for moved days and rejects cross-tenant scope references", async () => {
    const invalidMoved = await PUT(putRequest({
      date: "2026-07-15",
      kind: "MOVED_DAY_OFF",
    }))
    expect(invalidMoved.status).toBe(400)

    vi.mocked(prisma.mtmTeam.findFirst).mockResolvedValue(null)
    const invalidTeam = await PUT(putRequest({
      date: "2026-07-15",
      kind: "WORKING_DAY",
      teamId: "outside-team",
    }))
    expect(invalidTeam.status).toBe(400)
    expect(await invalidTeam.json()).toMatchObject({ code: "MTM_CALENDAR_REFERENCE_INVALID" })
  })

  it("allows only an MTM administrator to mutate the calendar", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...ADMIN_AUTH, role: "viewer" })
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)
    const response = await PUT(putRequest({
      date: "2026-07-15",
      kind: "PUBLIC_HOLIDAY",
    }))
    expect(response.status).toBe(403)
    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/v1/mtm/work-calendar/:id", () => {
  it("soft-deletes an organization-scoped override", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findFirst).mockResolvedValue({
      id: "calendar-1",
      organizationId: ORG,
      kind: "PUBLIC_HOLIDAY",
    } as any)
    vi.mocked(prisma.mtmWorkCalendarDay.updateMany).mockResolvedValue({ count: 1 } as any)

    const response = await DELETE(
      request("/api/v1/mtm/work-calendar/calendar-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "calendar-1" }) },
    )
    expect(response.status).toBe(200)
    expect(prisma.mtmWorkCalendarDay.updateMany).toHaveBeenCalledWith({
      where: { id: "calendar-1", organizationId: ORG, deletedAt: null },
      data: expect.objectContaining({ deletedAt: expect.any(Date), updatedBy: "admin-user" }),
    })
  })
})
