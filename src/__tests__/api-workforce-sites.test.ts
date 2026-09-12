import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAdminAuth: vi.fn((handler) => handler),
}))
vi.mock("@/lib/mtm-settings", () => ({
  getMtmSettings: vi.fn(),
}))

import { GET, POST } from "@/app/api/v1/workforce/configuration/sites/route"
import { POST as archivePost } from "@/app/api/v1/workforce/configuration/sites/[id]/archive/route"
import { POST as geofencePost } from "@/app/api/v1/workforce/configuration/sites/[id]/geofences/route"
import { GET as assignmentsGet, POST as assignmentsPost } from "@/app/api/v1/workforce/configuration/site-assignments/route"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"

const AUTH = { orgId: "org-1", userId: "admin-1", role: "admin" }
const site = {
  id: "site-1",
  code: "BAKU_HQ",
  name: "Baku headquarters",
  type: "OFFICE",
  timezone: "Asia/Baku",
  addressLabel: "Baku",
  responsibleTeamId: null,
  status: "ACTIVE",
  createdByUserId: "admin-1",
  archivedByUserId: null,
  archivedAt: null,
  createdAt: new Date("2026-08-30T00:00:00.000Z"),
  updatedAt: new Date("2026-08-30T00:00:00.000Z"),
}

function request(path: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, body === undefined ? {} : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-08-30T08:00:00.000Z"))
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("Workforce site configuration API", () => {
  it("lists only tenant-scoped Workforce sites", async () => {
    vi.mocked(prisma.workforceSite.findMany).mockResolvedValue([site] as never)

    const response = await GET(request("/api/v1/workforce/configuration/sites"), AUTH as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { sites: [{ id: "site-1" }] } })
    expect(prisma.workforceSite.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1" },
    }))
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
  })

  it("creates a site without turning it into attendance or a Route location", async () => {
    vi.mocked(prisma.workforceSite.create).mockResolvedValue(site as never)
    vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)

    const response = await POST(request("/api/v1/workforce/configuration/sites", {
      code: "BAKU_HQ",
      name: "Baku headquarters",
      type: "OFFICE",
      timezone: "Asia/Baku",
      addressLabel: "Baku",
    }), AUTH as never)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ data: { site: { id: "site-1" } } })
    expect(prisma.workforceSite.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: "org-1", type: "OFFICE" }),
    }))
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.create).not.toHaveBeenCalled()
  })

  it("returns an invalid request before writing a site", async () => {
    const response = await POST(request("/api/v1/workforce/configuration/sites", {
      code: "invalid code",
      name: "Bad site",
      type: "FIELD",
      timezone: "UTC",
    }), AUTH as never)

    expect(response.status).toBe(400)
    expect(prisma.workforceSite.create).not.toHaveBeenCalled()
  })

  it("archives with the route id and tenant scope, never deleting", async () => {
    const archivedAt = new Date("2026-08-31T00:00:00.000Z")
    vi.mocked(prisma.workforceSite.findFirst)
      .mockResolvedValueOnce(site as never)
      .mockResolvedValueOnce({ ...site, status: "ARCHIVED", archivedByUserId: "admin-1", archivedAt } as never)
    vi.mocked(prisma.workforceSite.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-2" } as never)

    const response = await archivePost(request("/api/v1/workforce/configuration/sites/site-1/archive", {
      reason: "Office lease ended",
    }), AUTH as never, { params: Promise.resolve({ id: "site-1" }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { site: { status: "ARCHIVED" } } })
    expect(prisma.workforceSite.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "site-1", organizationId: "org-1", status: "ACTIVE" },
    }))
    expect(prisma.workforceSite.delete).not.toHaveBeenCalled()
  })

  it("schedules a calibrated future circle using server organization time", async () => {
    const revision = {
      id: "fence-1",
      siteId: "site-1",
      revision: 1,
      kind: "CIRCLE",
      centerLatitude: 40.4093,
      centerLongitude: 49.8671,
      radiusMeters: 75,
      calibrationReference: "CAL-2026-01",
      definitionHash: "a".repeat(64),
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveTo: null,
      createdByUserId: "admin-1",
      createdAt: new Date("2026-08-30T00:00:00.000Z"),
    }
    vi.mocked(prisma.workforceSite.findFirst).mockResolvedValue({
      id: "site-1", code: "BAKU_HQ", status: "ACTIVE",
    } as never)
    vi.mocked(prisma.workforceSiteGeofenceRevision.findMany).mockResolvedValue([])
    vi.mocked(prisma.workforceSiteGeofenceRevision.create).mockResolvedValue(revision as never)
    vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-3" } as never)

    const response = await geofencePost(request("/api/v1/workforce/configuration/sites/site-1/geofences", {
      effectiveFrom: "2026-09-01",
      centerLatitude: 40.4093,
      centerLongitude: 49.8671,
      radiusMeters: 75,
      calibrationReference: "CAL-2026-01",
    }), AUTH as never, { params: Promise.resolve({ id: "site-1" }) })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ data: { revision: { id: "fence-1" } } })
    expect(prisma.workforceSiteGeofenceRevision.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: "org-1", siteId: "site-1" }),
    }))
    expect(prisma.mtmCustomer.findFirst).not.toHaveBeenCalled()
  })

  it("lists and schedules a tenant-scoped future site assignment without Route tables", async () => {
    const assignment = {
      id: "assignment-1",
      agentId: "agent-1",
      siteId: "site-1",
      kind: "PRIMARY",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveTo: null,
      assignedByUserId: "admin-1",
      createdAt: new Date("2026-08-30T00:00:00.000Z"),
    }
    vi.mocked(prisma.workforceSiteAssignment.findMany).mockResolvedValue([assignment] as never)
    const listed = await assignmentsGet(request("/api/v1/workforce/configuration/site-assignments"), AUTH as never)
    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toMatchObject({ data: { assignments: [{ id: "assignment-1" }] } })
    expect(prisma.workforceSiteAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1" },
    }))

    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.workforceSite.findFirst).mockResolvedValue({ id: "site-1", status: "ACTIVE" } as never)
    vi.mocked(prisma.workforceSiteAssignment.findMany).mockResolvedValue([])
    vi.mocked(prisma.workforceSiteAssignment.create).mockResolvedValue(assignment as never)
    vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-4" } as never)
    const scheduled = await assignmentsPost(request("/api/v1/workforce/configuration/site-assignments", {
      agentId: "agent-1",
      siteId: "site-1",
      kind: "PRIMARY",
      effectiveFrom: "2026-09-01",
    }), AUTH as never)
    expect(scheduled.status).toBe(201)
    await expect(scheduled.json()).resolves.toMatchObject({ data: { assignment: { id: "assignment-1" } } })
    expect(prisma.mtmRouteAssignment.create).not.toHaveBeenCalled()
  })
})
