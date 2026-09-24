import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

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

vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

vi.mock("@/lib/mtm/visit-requirements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/visit-requirements")>()
  return {
    ...actual,
    completeMtmVisit: vi.fn(async () => ({
      status: "completed",
      visit: { id: "visit-1", agentId: "agent-1", status: "CHECKED_OUT", checkOutAt: new Date(), duration: 25, routeId: null, routePointId: null },
      idempotent: false,
    })),
  }
})

import { PUT } from "@/app/api/v1/mtm/visits/[id]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { completeMtmVisit } from "@/lib/mtm/visit-requirements"

/**
 * Visits audit 2026-09-24: the office edit form (pencil in the visit row)
 * sends the visit's status and its check-in point back with every save. It
 * could set a completed visit back to «on site», close an agent's open visit
 * with the check-in point written as the GPS of the exit, and an edit of a
 * completed visit answered «saved» while saving nothing. The phone closes its
 * own visits through the same route and must keep doing so.
 */
const ORG = "org-1"
const office = { agentId: null, role: "ADMIN", scopedAgentIds: null }
const phone = { agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] }
const visitRow = (status: "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED") => ({
  agentId: "agent-1",
  customerId: "cust-1",
  contactId: null,
  checkInAt: new Date("2026-09-20T09:00:00.000Z"),
  status,
})
// What the office form sends: the row's own status and check-in point, prefilled.
const checkIn = { latitude: 40.4093, longitude: 49.8671 }

function put(body: unknown) {
  return PUT(
    new NextRequest(new URL("http://localhost:3000/api/v1/mtm/visits/visit-1"), {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: "visit-1" }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin",
  } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(office as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-2" } as never)
  vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 1 } as never)
})

describe("the office edit of a visit", () => {
  it("cannot set a completed or cancelled visit back to «on site»", async () => {
    for (const status of ["CHECKED_OUT", "CANCELLED"] as const) {
      vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(visitRow(status) as never)
      const res = await put({ status: "CHECKED_IN", ...checkIn })
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: "MTM_VISIT_REOPEN_FORBIDDEN" })
    }
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
    expect(completeMtmVisit).not.toHaveBeenCalled()
  })

  it("saves the new agent and note of a completed visit instead of answering «already completed»", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(visitRow("CHECKED_OUT") as never)
    const res = await put({ status: "CHECKED_OUT", agentId: "agent-2", notes: "moved to Leyla", ...checkIn })
    expect(res.status).toBe(200)
    expect(completeMtmVisit).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.updateMany).toHaveBeenCalledTimes(1)
    const { data } = vi.mocked(prisma.mtmVisit.updateMany).mock.calls[0][0] as { data: Record<string, unknown> }
    expect(data).toEqual({ agentId: "agent-2", notes: "moved to Leyla" })
  })

  it("closes an agent's open visit without writing the check-in point as the GPS of the exit", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(visitRow("CHECKED_IN") as never)
    const res = await put({ status: "CHECKED_OUT", notes: "closed from the office", ...checkIn })
    expect(res.status).toBe(200)
    expect(completeMtmVisit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(completeMtmVisit).mock.calls[0][1]).toMatchObject({ expectedAgentId: "agent-1", latitude: null, longitude: null })
    // The note typed in the same save is kept.
    const { data } = vi.mocked(prisma.mtmVisit.updateMany).mock.calls[0][0] as { data: Record<string, unknown> }
    expect(data).toEqual({ notes: "closed from the office" })
  })
})

describe("the phone closing its own visit", () => {
  beforeEach(() => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(phone as never)
  })

  it("still records where it left, and only that", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(visitRow("CHECKED_IN") as never)
    const res = await put({ status: "CHECKED_OUT", latitude: 40.5, longitude: 49.9 })
    expect(res.status).toBe(200)
    expect(vi.mocked(completeMtmVisit).mock.calls[0][1]).toMatchObject({ latitude: 40.5, longitude: 49.9 })
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
  })

  it("repeats a check-out from its outbox as an idempotent check-out, not an edit", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(visitRow("CHECKED_OUT") as never)
    const res = await put({ status: "CHECKED_OUT", latitude: 40.5, longitude: 49.9 })
    expect(res.status).toBe(200)
    expect(completeMtmVisit).toHaveBeenCalledTimes(1)
    // The exit point must never land in the check-in columns.
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
  })
})
