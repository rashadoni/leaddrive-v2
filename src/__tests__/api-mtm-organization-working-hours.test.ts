/**
 * PUT /api/v1/mtm/organizations/working-hours — «Часы приёма» of one place or
 * of many at once (owner 2026-11-02, mockup «MTM: часы приёма клиентов»).
 */
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

import { PUT } from "@/app/api/v1/mtm/organizations/working-hours/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const ADMIN: AuthResult = { orgId: ORG, userId: "admin-user", role: "admin", email: "a@example.com", name: "Admin" }

const day = { open: "09:00", close: "20:00", breakFrom: "13:00", breakTo: "14:00" }
const week = { 1: day, 2: day, 3: day, 4: day, 5: day, 6: { open: "10:00", close: "16:00" }, 7: null }

function request(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/organizations/working-hours", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
const call = (body: unknown) => PUT(request(body), { params: Promise.resolve({}) } as never)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(ADMIN)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "p1", workingHours: null }, { id: "p2", workingHours: null }] as never)
  vi.mocked(prisma.mtmCustomer.updateMany).mockResolvedValue({ count: 2 } as never)
})

describe("setting «часы приёма»", () => {
  it("writes the same week to every selected place, with who and when", async () => {
    const response = await call({ organizationIds: ["p1", "p2"], workingHours: week })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { updated: 2 } })
    const update = vi.mocked(prisma.mtmCustomer.updateMany).mock.calls[0][0] as { where: { id: { in: string[] }; organizationId: string }; data: Record<string, unknown> }
    expect(update.where).toMatchObject({ id: { in: ["p1", "p2"] }, organizationId: ORG })
    expect(update.data.workingHours).toEqual({ 1: day, 2: day, 3: day, 4: day, 5: day, 6: { open: "10:00", close: "16:00" }, 7: null })
    expect(update.data.workingHoursUpdatedBy).toBe("admin-user")
    expect(update.data.workingHoursUpdatedAt).toBeInstanceOf(Date)
  })

  it("clears the hours back to «не указаны»", async () => {
    const response = await call({ organizationIds: ["p1", "p2"], workingHours: null })
    expect(response.status).toBe(200)
    const update = vi.mocked(prisma.mtmCustomer.updateMany).mock.calls[0][0] as { data: Record<string, unknown> }
    expect(update.data.workingHoursUpdatedBy).toBeNull()
    expect(update.data.workingHoursUpdatedAt).toBeNull()
  })

  it("refuses a week that closes before it opens and writes nothing", async () => {
    const response = await call({ organizationIds: ["p1"], workingHours: { ...week, 1: { open: "18:00", close: "09:00" } } })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe("MTM_WORKING_HOURS_INVALID")
    expect(prisma.mtmCustomer.updateMany).not.toHaveBeenCalled()
  })

  it("changes nothing when one of the places is outside the scope", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "p1", workingHours: null }] as never)
    const response = await call({ organizationIds: ["p1", "p2"], workingHours: week })
    expect(response.status).toBe(404)
    expect(prisma.mtmCustomer.updateMany).not.toHaveBeenCalled()
  })

  it("does not let an agent edit a place: agents propose, they do not edit", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...ADMIN, role: "sales", userId: "agent-user" } as AuthResult)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT", status: "ACTIVE" } as never)
    const response = await call({ organizationIds: ["p1"], workingHours: week })
    expect(response.status).toBe(403)
    expect(prisma.mtmCustomer.updateMany).not.toHaveBeenCalled()
  })
})
