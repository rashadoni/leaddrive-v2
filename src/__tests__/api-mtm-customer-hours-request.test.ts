/**
 * «Часы не те?» (owner 2026-11-02, mockup «MTM: часы приёма клиентов»): the
 * agent proposes a place's real «часы приёма» from the spot, a manager
 * accepts them or leaves the old ones. The agent never edits the place.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

import { POST as propose } from "@/app/api/v2/mtm/mobile/route-field/organizations/[id]/hours-request/route"
import { POST as decide } from "@/app/api/v1/mtm/customer-hours-requests/[id]/decision/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const AGENT = "agent-1"
const day = { open: "10:00", close: "19:00" }
const week = { 1: day, 2: day, 3: day, 4: day, 5: day, 6: null, 7: null }
const old = { 1: { open: "09:00", close: "19:00" }, 2: day, 3: day, 4: day, 5: day, 6: null, 7: null }

function mobileRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v2/mtm/mobile/route-field/organizations/c1/hours-request", {
    method: "POST",
    headers: { Authorization: "Bearer valid-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
const send = (body: unknown) => propose(mobileRequest(body), { params: Promise.resolve({ id: "c1" }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue({
    orgId: ORG, agentId: AGENT, userId: "user-1", email: "a@example.test", name: "Agent", role: "AGENT",
    tenantCapabilities: { routeField: true, workforceHrm: false },
  } as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT, role: "AGENT", canPlanOwnRoutes: true } as never)
  vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "c1", name: "Aptek «Dərman+»", workingHours: old } as never)
  vi.mocked(prisma.mtmCustomerHoursRequest.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmCustomerHoursRequest.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "r1", status: "SUBMITTED", customerId: "c1", requestedByAgentId: AGENT, proposedHours: data.proposedHours,
    decisionComment: null, submittedAt: new Date("2026-11-05T10:00:00Z"), reviewedAt: null,
  }) as never)
})

describe("the agent proposes", () => {
  it("records the week he saw and the week he proposes, and changes nothing about the place", async () => {
    const response = await send({ idempotencyKey: "key-12345678", hours: week, comment: "Табличка на двери" })
    expect(response.status).toBe(201)
    const created = vi.mocked(prisma.mtmCustomerHoursRequest.create).mock.calls[0][0] as { data: Record<string, unknown> }
    expect(created.data).toMatchObject({ customerId: "c1", requestedByAgentId: AGENT, previousHours: old, comment: "Табличка на двери" })
    expect(created.data.proposedHours).toEqual(week)
    expect(prisma.mtmCustomer.updateMany).not.toHaveBeenCalled()
    expect((await response.json()).data.request).toMatchObject({ status: "SUBMITTED", mine: true, proposedHours: week })
  })

  it("refuses the hours the place already has", async () => {
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "c1", name: "X", workingHours: week } as never)
    const response = await send({ idempotencyKey: "key-12345678", hours: week })
    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe("MTM_HOURS_REQUEST_UNCHANGED")
    expect(prisma.mtmCustomerHoursRequest.create).not.toHaveBeenCalled()
  })

  it("refuses a week that closes before it opens", async () => {
    const response = await send({ idempotencyKey: "key-12345678", hours: { ...week, 1: { open: "19:00", close: "10:00" } } })
    expect(response.status).toBe(400)
  })

  it("refuses a place outside his own", async () => {
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue(null)
    expect((await send({ idempotencyKey: "key-12345678", hours: week })).status).toBe(404)
  })
})

describe("the manager decides", () => {
  const ADMIN: AuthResult = { orgId: ORG, userId: "admin-user", role: "admin", email: "a@example.com", name: "Admin" }
  const decision = (body: unknown) => decide(new NextRequest("http://localhost:3000/api/v1/mtm/customer-hours-requests/r1/decision", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "r1" }) })

  beforeEach(() => {
    vi.mocked(getMobileAuth).mockReturnValue(null)
    vi.mocked(resolveMobileAuth).mockResolvedValue(null)
    vi.mocked(requireAuth).mockResolvedValue(ADMIN)
    vi.mocked(prisma.mtmCustomerHoursRequest.findFirst).mockResolvedValue({
      id: "r1", status: "SUBMITTED", customerId: "c1", requestedByAgentId: AGENT, previousHours: old, proposedHours: week,
      customer: { id: "c1", name: "Aptek «Dərman+»" }, requestedByAgent: { appLanguage: "ru" },
    } as never)
    vi.mocked(prisma.mtmCustomerHoursRequest.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ workingHours: old, updatedAt: new Date("2026-11-01T00:00:00Z") } as never)
    vi.mocked(prisma.mtmCustomer.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmRouteNotificationOutbox.upsert).mockResolvedValue({} as never)
  })

  it("accepting writes the agent's week as the place's hours and tells the agent in his language", async () => {
    const response = await decision({ decision: "APPROVED" })
    expect(response.status).toBe(200)
    const written = vi.mocked(prisma.mtmCustomer.updateMany).mock.calls[0][0] as { data: Record<string, unknown> }
    expect(written.data.workingHours).toEqual(week)
    expect(written.data.workingHoursUpdatedBy).toBe("admin-user")
    const notice = vi.mocked(prisma.mtmRouteNotificationOutbox.upsert).mock.calls[0][0] as { create: { title: string; body: string } }
    expect(notice.create.title).toBe("Часы приёма изменены")
    expect(notice.create.body).toContain("Aptek «Dərman+»")
  })

  it("does not overwrite hours somebody changed after the agent asked, unless the manager confirms", async () => {
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ workingHours: week, updatedAt: new Date() } as never)
    const response = await decision({ decision: "APPROVED" })
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("MTM_HOURS_REQUEST_CUSTOMER_CHANGED")
    expect(prisma.mtmCustomer.updateMany).not.toHaveBeenCalled()
    expect((await decision({ decision: "APPROVED", confirmHoursChanged: true })).status).toBe(200)
  })

  it("leaving it as it was changes nothing about the place", async () => {
    const response = await decision({ decision: "REJECTED", comment: "Звонили — часы прежние" })
    expect(response.status).toBe(200)
    expect(prisma.mtmCustomer.updateMany).not.toHaveBeenCalled()
    const notice = vi.mocked(prisma.mtmRouteNotificationOutbox.upsert).mock.calls[0][0] as { create: { body: string } }
    expect(notice.create.body).toContain("Звонили — часы прежние")
  })
})
