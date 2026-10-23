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
vi.mock("@/lib/mtm/territory-scope", () => ({
  resolveAgentScope: vi.fn(),
}))
vi.mock("@/lib/mtm/attendance-request-review", () => ({ listAttendanceRequestsForReview: vi.fn() }))
vi.mock("@/lib/mtm/attendance-request-decision", async (original) => ({ ...(await original<object>()), decideAttendanceRequest: vi.fn() }))

import { GET as approvalsGet } from "@/app/api/v1/mtm/mobile/manager/approvals/route"
import { GET as teamGet } from "@/app/api/v1/mtm/mobile/manager/team/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"
import { POST as attendanceDecision } from "@/app/api/v1/mtm/mobile/manager/attendance-requests/[id]/decision/route"
import { listAttendanceRequestsForReview } from "@/lib/mtm/attendance-request-review"
import { decideAttendanceRequest } from "@/lib/mtm/attendance-request-decision"

const AUTH = {
  orgId: "org-1",
  agentId: "manager-1",
  role: "MANAGER",
  tenantCapabilities: { routeField: true, workforceHrm: true },
}

function request(path: "team" | "approvals") {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/mobile/manager/${path}`, {
    headers: { Authorization: "Bearer valid-token" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH as never)
  vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1"] } as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRouteChangeRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmCustomerCreateRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmContactChangeRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
})

describe("mobile manager mixed workforce boundaries", () => {
  it("does not select active workdays for a Routes-only manager", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Agent",
      role: "AGENT",
      status: "ACTIVE",
      teamId: "team-1",
      isOnline: true,
      lastSeenAt: null,
    }] as never)

    const response = await teamGet(request("team"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.agents[0].workday).toBeNull()
    const query = vi.mocked(prisma.mtmAgent.findMany).mock.calls[0][0] as any
    expect(query.select.workdays).toBeUndefined()
  })

  it("returns active workdays for an HRM-only manager without route entitlement", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      tenantCapabilities: { routeField: false, workforceHrm: true },
    } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Agent",
      role: "AGENT",
      status: "ACTIVE",
      teamId: "team-1",
      isOnline: true,
      lastSeenAt: null,
      workdays: [{ id: "workday-1", status: "STARTED", startedAt: new Date(), pausedAt: null }],
    }] as never)

    const body = await (await teamGet(request("team"))).json()

    expect(body.data.agents[0].workday).toMatchObject({ id: "workday-1", status: "STARTED" })
    const query = vi.mocked(prisma.mtmAgent.findMany).mock.calls[0][0] as any
    expect(query.select.workdays).toEqual(expect.objectContaining({ take: 2 }))
    // No route data for a manager without Routes.
    expect(body.data.agents[0]).not.toHaveProperty("routeToday")
    expect(body.data.agents[0]).not.toHaveProperty("openVisitSince")
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
  })

  // Owner, 2026-10-17: a day finished at six read «İş günü başlamayıb».
  it("says a day was finished, and prefers a day still open — begun yesterday — to it", async () => {
    const finished = { id: "workday-today", status: "COMPLETED", startedAt: new Date("2026-10-17T05:10:00Z"), pausedAt: null, completedAt: new Date("2026-10-17T14:00:00Z") }
    const open = { id: "workday-yesterday", status: "STARTED", startedAt: new Date("2026-10-16T20:00:00Z"), pausedAt: null, completedAt: null }
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Agent One", role: "AGENT", status: "ACTIVE", teamId: "team-1", isOnline: false, lastSeenAt: null, workdays: [finished] },
      { id: "agent-2", name: "Agent Two", role: "AGENT", status: "ACTIVE", teamId: "team-1", isOnline: true, lastSeenAt: null, workdays: [finished, open] },
    ] as never)

    const body = await (await teamGet(request("team"))).json()

    expect(body.data.agents[0].workday).toMatchObject({ id: "workday-today", status: "COMPLETED" })
    expect(body.data.agents[1].workday).toMatchObject({ id: "workday-yesterday", status: "STARTED" })
    const query = vi.mocked(prisma.mtmAgent.findMany).mock.calls[0][0] as { select: { workdays: { where: unknown } } }
    expect(query.select.workdays.where).toEqual({ OR: [{ status: { in: ["STARTED", "PAUSED"] } }, { workDate: new Date(`${body.data.date}T00:00:00.000Z`) }] })
  })

  // «Визиты 3 из 8» on each team card (owner, 2026-10-17).
  it("counts today's published route points of each employee by what became of them", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Agent One", role: "AGENT", status: "ACTIVE", teamId: "team-1", isOnline: true, lastSeenAt: null, workdays: [] },
      { id: "agent-2", name: "Agent Two", role: "AGENT", status: "ACTIVE", teamId: "team-1", isOnline: true, lastSeenAt: null, workdays: [] },
    ] as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([
      { agentId: "agent-1", points: [{ status: "VISITED" }, { status: "VISITED" }, { status: "SKIPPED" }, { status: "PENDING" }] },
      { agentId: "agent-1", points: [{ status: "PENDING" }] },
    ] as never)

    const body = await (await teamGet(request("team"))).json()

    expect(body.data.agents[0].routeToday).toEqual({ planned: 5, visited: 2, skipped: 1 })
    expect(body.data.agents[1].routeToday).toBeNull()
    const query = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as { where: unknown }
    expect(query.where).toMatchObject({
      organizationId: "org-1",
      agentId: { in: ["agent-1", "agent-2"] },
      date: new Date(`${body.data.date}T00:00:00.000Z`),
      deletedAt: null,
      status: { in: ["PLANNED", "IN_PROGRESS", "COMPLETED", "INCOMPLETE"] },
    })
  })

  // A visit left open five days took the next visit's photo (owner, 2026-10-17).
  it("names the visit each employee left open on an earlier day, and only that one", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Agent One", role: "AGENT", status: "ACTIVE", teamId: "team-1", isOnline: true, lastSeenAt: null, workdays: [] },
      { id: "agent-2", name: "Agent Two", role: "AGENT", status: "ACTIVE", teamId: "team-1", isOnline: true, lastSeenAt: null, workdays: [] },
    ] as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
    const now = new Date()
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
      { agentId: "agent-1", checkInAt: new Date(now.getTime() - 5 * 24 * 3_600_000) },
      // Started this instant: today's visit, not a forgotten one.
      { agentId: "agent-2", checkInAt: now },
    ] as never)

    const body = await (await teamGet(request("team"))).json()

    expect(body.data.agents[0].openVisitSince).toBe(new Date(now.getTime() - 5 * 24 * 3_600_000).toISOString())
    expect(body.data.agents[1].openVisitSince).toBeNull()
    const query = vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as { where: unknown }
    expect(query.where).toEqual({ organizationId: "org-1", agentId: { in: ["agent-1", "agent-2"] }, status: "CHECKED_IN", deletedAt: null })
  })

  it("does not read HRM request reasons for a Routes-only manager", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as never)

    const body = await (await approvalsGet(request("approvals"))).json()

    expect(body.data.counts.hrm).toBe(0)
    expect(body.data.hrm).toEqual([])
    expect(prisma.mtmHrmRequest.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRouteChangeRequest.findMany).toHaveBeenCalledTimes(1)
  })

  it("reads only HRM approvals for an HRM-only manager", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      tenantCapabilities: { routeField: false, workforceHrm: true },
    } as never)
    vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([{
      id: "request-1",
      agentId: "agent-1",
      type: "LEAVE",
      reason: "Annual leave",
    }] as never)

    const body = await (await approvalsGet(request("approvals"))).json()

    expect(body.data.counts).toMatchObject({ hrm: 1, routeChanges: 0, customers: 0, contactChanges: 0 })
    expect(body.data.hrm).toEqual([expect.objectContaining({ id: "request-1" })])
    expect(prisma.mtmHrmRequest.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.mtmRouteChangeRequest.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmCustomerCreateRequest.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmContactChangeRequest.findMany).not.toHaveBeenCalled()
  })

  // Owner, 2026-10-17: Personnel leave requests never reached the manager's
  // «Təsdiqlər» — that section was read only behind the withdrawn Workforce HRM.
  it("lists Personnel requests for review as the manager's linked CRM user", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...AUTH, tenantCapabilities: { routeField: true, workforceHrm: false, personnel: true } } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ userId: "user-togrul" } as never)
    vi.mocked(listAttendanceRequestsForReview).mockResolvedValue({ items: [{ id: "11111111-1111-4111-8111-111111111111", employeeName: "Aygün" }], nextCursor: null } as never)
    const body = await (await approvalsGet(request("approvals"))).json()
    expect(body.data.counts.attendance).toBe(1)
    expect(body.data.attendance).toEqual([expect.objectContaining({ employeeName: "Aygün" })])
    expect(listAttendanceRequestsForReview).toHaveBeenCalledWith({ organizationId: "org-1", userId: "user-togrul", principalType: "session" }, { status: "PENDING" })
  })

  it("leaves out a request this manager already passed to HR under two-step approval (owner, 2026-10-21)", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...AUTH, tenantCapabilities: { routeField: true, workforceHrm: false, personnel: true } } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ userId: "user-togrul" } as never)
    vi.mocked(listAttendanceRequestsForReview).mockResolvedValue({ items: [
      { id: "11111111-1111-4111-8111-111111111111", employeeName: "Aygün", canDecide: true },
      { id: "22222222-2222-4222-8222-222222222222", employeeName: "Nigar", canDecide: false },
    ], nextCursor: null } as never)
    const body = await (await approvalsGet(request("approvals"))).json()
    expect(body.data.counts.attendance).toBe(1)
    expect(body.data.attendance).toEqual([expect.objectContaining({ employeeName: "Aygün" })])
  })

  it("shows no Personnel requests to a manager card without a CRM login, and still answers", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...AUTH, tenantCapabilities: { routeField: true, workforceHrm: false, personnel: true } } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ userId: null } as never)
    const response = await approvalsGet(request("approvals"))
    expect(response.status).toBe(200)
    expect((await response.json()).data.attendance).toEqual([])
    expect(listAttendanceRequestsForReview).not.toHaveBeenCalled()
  })

  it("decides a Personnel request from the app with the browser's own decision", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...AUTH, tenantCapabilities: { routeField: true, workforceHrm: false, personnel: true } } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ userId: "user-togrul" } as never)
    vi.mocked(decideAttendanceRequest).mockResolvedValue({ request: { id: "r1", status: "APPROVED" }, idempotent: false } as never)
    const id = "11111111-1111-4111-8111-111111111111"
    const body = { decision: "APPROVED", version: "2026-10-17T08:00:00.000Z", note: null }
    const response = await attendanceDecision(new NextRequest(`http://localhost:3000/api/v1/mtm/mobile/manager/attendance-requests/${id}/decision`, {
      method: "POST", headers: { Authorization: "Bearer valid-token", "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(200)
    expect(decideAttendanceRequest).toHaveBeenCalledWith({ organizationId: "org-1", userId: "user-togrul", principalType: "session" }, id, body)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ userId: null } as never)
    const refused = await attendanceDecision(new NextRequest(`http://localhost:3000/api/v1/mtm/mobile/manager/attendance-requests/${id}/decision`, {
      method: "POST", headers: { Authorization: "Bearer valid-token", "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })
    expect(refused.status).toBe(403)
  })
})
