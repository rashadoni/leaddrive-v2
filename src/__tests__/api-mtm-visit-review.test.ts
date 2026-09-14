import { beforeEach, describe, expect, it, vi } from "vitest"
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

import { GET as getVisitDetail } from "@/app/api/v1/mtm/visits/[id]/route"
import { GET as getVisitReview } from "@/app/api/v1/mtm/visits/[id]/review/route"
import { GET as getActiveVisits } from "@/app/api/v1/mtm/visits/active/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

/**
 * Office review of /mtm/visits (prod audit 2026-09-14): the focused row lost
 * its address and GPS, and a finished visit had no review at all.
 */
const ORG = "org-1"

function request(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"))
}

const finishedVisit = {
  id: "visit-1789389965880-yrl4e52p",
  agentId: "agent-anar",
  customerId: "customer-adv-22",
  status: "CHECKED_OUT",
  checkInAt: new Date("2026-09-14T12:46:00.000Z"),
  checkOutAt: new Date("2026-09-14T13:09:00.000Z"),
  duration: 23,
  checkInLat: 40.4094,
  checkInLng: 49.8671,
  checkOutLat: null,
  checkOutLng: null,
  notes: "E2E yoxlama",
  outcome: null,
  potential: null,
  resultNotes: null,
  nextActionDueAt: null,
  agent: { id: "agent-anar", name: "Anar Mammadov" },
  customer: { id: "customer-adv-22", name: "ADV-Store 22", address: "Nizami küç. 22", city: "Bakı", latitude: 40.4093, longitude: 49.8671, geofenceRadius: null },
  contact: null,
  route: { id: "route-1", name: "Bazar ertəsi", date: new Date("2026-09-14T00:00:00.000Z") },
  routePoint: { id: "point-3", orderIndex: 2, plannedTime: new Date("2026-09-14T12:30:00.000Z") },
  participants: [],
  requirementSnapshot: { requirements: [{ id: "req-photo", actionKey: "PHOTO", mode: "REQUIRED", minCount: 1 }] },
  actionResults: [{
    id: "sig-1",
    actionKey: "SIGNATURE",
    status: "COMPLETED",
    evidence: { method: "drawn", svgPath: "M10 20 L30 40", widthPx: 600, heightPx: 240, signerName: "Leyla" },
    completedAt: new Date("2026-09-14T13:05:00.000Z"),
  }],
  photos: [
    { id: "photo-1", url: "/uploads/mtm-photos/a.jpg", thumbnailUrl: null, status: "PENDING", createdAt: new Date("2026-09-14T12:50:00.000Z") },
    { id: "photo-2", url: "/uploads/mtm-photos/b.jpg", thumbnailUrl: null, status: "PENDING", createdAt: new Date("2026-09-14T12:51:00.000Z") },
    { id: "photo-3", url: "/uploads/mtm-photos/c.jpg", thumbnailUrl: null, status: "PENDING", createdAt: new Date("2026-09-14T12:52:00.000Z") },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "manager-user", role: "admin", email: "m@example.com", name: "Manager" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmTask.count).mockResolvedValue(0)
})

describe("GET /api/v1/mtm/visits/[id] customer facts", () => {
  it("returns the customer's address, pin and geofence like the list row it replaces", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(finishedVisit as never)

    const response = await getVisitDetail(request(`/api/v1/mtm/visits/${finishedVisit.id}`), { params: Promise.resolve({ id: finishedVisit.id }) })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.customer).toEqual({
      id: "customer-adv-22",
      name: "ADV-Store 22",
      address: "Nizami küç. 22",
      city: "Bakı",
      latitude: 40.4093,
      longitude: 49.8671,
      geofenceRadius: null,
    })
    // Backwards compatible: the fields old clients read are still there.
    expect(json.data).toMatchObject({ id: finishedVisit.id, canMutate: true, agent: { name: "Anar Mammadov" } })
    expect(prisma.mtmVisit.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        customer: { select: { id: true, name: true, address: true, city: true, latitude: true, longitude: true, geofenceRadius: true } },
      }),
    }))
  })
})

describe("GET /api/v1/mtm/visits/[id]/review", () => {
  it("returns a finished visit with photos, signature, note, route point and the effective geofence", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(finishedVisit as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "geofenceRadius", value: 150 }] as never)
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([{ id: "task-1", title: "Qalığı yoxla", priority: "HIGH", dueDate: null }] as never)
    vi.mocked(prisma.mtmTask.count).mockResolvedValue(7)

    const response = await getVisitReview(request(`/api/v1/mtm/visits/${finishedVisit.id}/review`), { params: Promise.resolve({ id: finishedVisit.id }) })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.visit).toMatchObject({
      status: "CHECKED_OUT",
      notes: "E2E yoxlama",
      outcome: null,
      checkOutLat: null,
      customer: { address: "Nizami küç. 22", latitude: 40.4093, longitude: 49.8671 },
      routePoint: { orderIndex: 2 },
    })
    expect(json.data.visit.photos.map((photo: { id: string }) => photo.id)).toEqual(["photo-1", "photo-2", "photo-3"])
    expect(json.data.visit.actionResults[0].evidence.signerName).toBe("Leyla")
    expect(json.data.geofenceRadius).toBe(150)
    expect(json.data.openTasks).toEqual({ count: 7, items: [{ id: "task-1", title: "Qalığı yoxla", priority: "HIGH", dueDate: null }] })
    expect(json.data.viewer).toEqual({ canExecute: false })
    expect(json.data.visit).not.toHaveProperty("participants")
  })

  it("prefers the customer's own radius over the organization setting", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({ ...finishedVisit, customer: { ...finishedVisit.customer, geofenceRadius: 400 } } as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "geofenceRadius", value: 150 }] as never)

    const response = await getVisitReview(request("/api/v1/mtm/visits/v/review"), { params: Promise.resolve({ id: finishedVisit.id }) })
    expect((await response.json()).data.geofenceRadius).toBe(400)
  })

  it("uses the read visibility of the exact detail endpoint, not the mutation scope", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "manager-1", role: "MANAGER", scopedAgentIds: ["manager-1", "agent-anar"] } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(finishedVisit as never)

    const response = await getVisitReview(request("/api/v1/mtm/visits/v/review"), { params: Promise.resolve({ id: finishedVisit.id }) })

    expect(response.status).toBe(200)
    const where = (vi.mocked(prisma.mtmVisit.findFirst).mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(where).toMatchObject({ id: finishedVisit.id, organizationId: ORG, deletedAt: null })
    expect(where.OR).toEqual(expect.any(Array))
    expect(where).not.toHaveProperty("status")
    expect(prisma.mtmTask.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        customerId: "customer-adv-22",
        AND: [{ agentId: { in: ["manager-1", "agent-anar"] } }],
      }),
    }))
    // A manager reviews; only the visit's own agent executes.
    expect((await response.json()).data.viewer.canExecute).toBe(false)
  })

  it("hides an out-of-scope primary agent from a participant reviewer", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "agent-2", role: "AGENT", scopedAgentIds: ["agent-2"] } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      ...finishedVisit,
      participants: [{ agentId: "agent-2", role: "PARTICIPANT", joinedAt: new Date("2026-09-14T12:00:00.000Z"), leftAt: null }],
    } as never)

    const response = await getVisitReview(request("/api/v1/mtm/visits/v/review"), { params: Promise.resolve({ id: finishedVisit.id }) })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.visit.agent).toBeNull()
    expect(json.data.visit.agentId).toBeNull()
    expect(JSON.stringify(json)).not.toContain("Anar Mammadov")
  })

  it("answers 404 for a visit outside the reviewer's scope at check-in", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "agent-2", role: "AGENT", scopedAgentIds: ["agent-2"] } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      ...finishedVisit,
      participants: [{ agentId: "agent-2", role: "PARTICIPANT", joinedAt: new Date("2026-09-14T13:30:00.000Z"), leftAt: null }],
    } as never)

    const response = await getVisitReview(request("/api/v1/mtm/visits/v/review"), { params: Promise.resolve({ id: finishedVisit.id }) })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "MTM_VISIT_NOT_FOUND" })
    expect(prisma.mtmTask.findMany).not.toHaveBeenCalled()
  })

  it("lets the visit's own agent execute it only while it is open", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "agent-anar", role: "AGENT", scopedAgentIds: ["agent-anar"] } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({ ...finishedVisit, status: "CHECKED_IN", checkOutAt: null } as never)
    const open = await getVisitReview(request("/api/v1/mtm/visits/v/review"), { params: Promise.resolve({ id: finishedVisit.id }) })
    expect((await open.json()).data.viewer.canExecute).toBe(true)

    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(finishedVisit as never)
    const finished = await getVisitReview(request("/api/v1/mtm/visits/v/review"), { params: Promise.resolve({ id: finishedVisit.id }) })
    expect((await finished.json()).data.viewer.canExecute).toBe(false)
  })

  it("refuses a web user who is not linked to MTM", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(null)
    const response = await getVisitReview(request("/api/v1/mtm/visits/v/review"), { params: Promise.resolve({ id: finishedVisit.id }) })
    expect(response.status).toBe(403)
    expect(prisma.mtmVisit.findFirst).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/mtm/visits/active viewer", () => {
  it("tells the page who is looking so only their own visits open the execution workspace", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "manager-1", role: "MANAGER", scopedAgentIds: ["manager-1", "agent-anar"] } as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{ id: "visit-2", agentId: "agent-anar", status: "CHECKED_IN" }] as never)

    const response = await getActiveVisits(request("/api/v1/mtm/visits/active"))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.visits).toEqual([{ id: "visit-2", agentId: "agent-anar", status: "CHECKED_IN" }])
    expect(json.data.viewer).toEqual({ agentId: "manager-1", role: "MANAGER" })
  })
})
