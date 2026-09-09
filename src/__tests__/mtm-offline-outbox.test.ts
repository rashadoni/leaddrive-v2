/**
 * G — MTM offline outbox: pure queue reducer + web sync-push endpoint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

import {
  makeOp,
  enqueue,
  pending,
  pendingBatches,
  pendingCount,
  applyOutcome,
  prune,
  OUTBOX_MAX,
  OUTBOX_SYNC_BATCH_MAX,
} from "@/lib/mtm/offline-outbox"

describe("offline outbox (pure core)", () => {
  it("makeOp mints a pending op with a unique operationId", () => {
    const a = makeOp("visits", "update", { kind: "checkout", visitId: "v1" })
    const b = makeOp("visits", "update", { kind: "checkout", visitId: "v1" })
    expect(a.status).toBe("pending")
    expect(a.attempts).toBe(0)
    expect(a.operationId).not.toBe(b.operationId)
  })

  it("enqueue appends but de-dupes the same operationId", () => {
    const op = makeOp("visits", "update", {})
    const q1 = enqueue([], op)
    const q2 = enqueue(q1, op)
    expect(q1).toHaveLength(1)
    expect(q2).toHaveLength(1)
  })

  it("enqueue keeps the queue bounded", () => {
    let q: ReturnType<typeof makeOp>[] = []
    for (let i = 0; i < OUTBOX_MAX + 25; i++) q = enqueue(q, makeOp("visits", "update", { i }))
    expect(q.length).toBeLessThanOrEqual(OUTBOX_MAX)
  })

  it("pending / pendingCount count only pending + error", () => {
    const q = [
      { ...makeOp("visits", "update", {}), status: "pending" as const },
      { ...makeOp("visits", "update", {}), status: "synced" as const },
      { ...makeOp("visits", "update", {}), status: "error" as const },
      { ...makeOp("visits", "update", {}), status: "conflict" as const },
    ]
    expect(pendingCount(q)).toBe(2)
    expect(pending(q).every((o) => o.status === "pending" || o.status === "error")).toBe(true)
  })

  it("chunks a full pending queue to the web sync endpoint's 100-operation limit", () => {
    const queue = Array.from({ length: 201 }, (_, index) => makeOp("visits", "update", { index }))

    const batches = pendingBatches(queue)

    expect(OUTBOX_SYNC_BATCH_MAX).toBe(100)
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 1])
    expect(batches.flat().map((operation) => operation.operationId))
      .toEqual(queue.map((operation) => operation.operationId))
  })

  it("applyOutcome maps status and bumps attempts", () => {
    const op = makeOp("visits", "update", {})
    const q = applyOutcome([op], op.operationId, { status: "ok" })
    expect(q[0].status).toBe("synced")
    expect(q[0].attempts).toBe(1)
    expect(applyOutcome([op], op.operationId, { status: "conflict", error: "gone" })[0]).toMatchObject({ status: "conflict", lastError: "gone" })
  })

  it("prune keeps retryable ops, drops settled ones", () => {
    const q = [
      { ...makeOp("visits", "update", {}), status: "pending" as const },
      { ...makeOp("visits", "update", {}), status: "synced" as const },
      { ...makeOp("visits", "update", {}), status: "conflict" as const },
      { ...makeOp("visits", "update", {}), status: "error" as const },
    ]
    const pruned = prune(q)
    expect(pruned.map((o) => o.status).sort()).toEqual(["error", "pending"])
  })
})

// ── endpoint ────────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    mtmSyncOperation: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((v: unknown) => v instanceof Response),
}))
vi.mock("@/lib/mtm/visit-requirements", () => ({
  completeMtmVisit: vi.fn(),
  createVisitRequirementSnapshot: vi.fn(),
  lockAndVerifyMtmRoutePointForCheckIn: vi.fn(),
  lockMtmActiveVisitSlot: vi.fn(),
}))
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

import { POST } from "@/app/api/v1/mtm/sync/push/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import {
  completeMtmVisit,
  createVisitRequirementSnapshot,
  lockAndVerifyMtmRoutePointForCheckIn,
  lockMtmActiveVisitSlot,
} from "@/lib/mtm/visit-requirements"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

// Rich tx mock for the check-in path (build fresh per test).
let txMock: {
  mtmSyncOperation: { create: ReturnType<typeof vi.fn> }
  mtmAgent: { findFirst: ReturnType<typeof vi.fn> }
  mtmCustomer: { findFirst: ReturnType<typeof vi.fn> }
  mtmContact: { findFirst: ReturnType<typeof vi.fn> }
  mtmVisit: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> }
  mtmVisitActionResult: { create: ReturnType<typeof vi.fn> }
  mtmRoutePoint: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> }
  mtmSetting: { findFirst: ReturnType<typeof vi.fn> }
  mtmAlert: { create: ReturnType<typeof vi.fn> }
  mtmVisitParticipant: { createMany: ReturnType<typeof vi.fn> }
  mtmRoute: { updateMany: ReturnType<typeof vi.fn> }
}

const uuid = () => "123e4567-e89b-42d3-a456-426614174000"
const req = (body: unknown) =>
  new NextRequest("http://localhost/x", { method: "POST", headers: { "x-organization-id": "org-1", "content-type": "application/json" }, body: JSON.stringify(body) })
const checkoutOp = (operationId = uuid()) => ({ operationId, entity: "visits", op: "update", data: { kind: "checkout", visitId: "v1" } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "member" } as never)
  // This legacy web/PWA endpoint must admit a tenant that has only the new
  // Route & Field capability; it must not fall back to the legacy `mtm` gate.
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    plan: "enterprise",
    addons: [],
    features: ["route-field"],
    modules: { mtm: false, "route-field": true },
    settings: {},
  } as never)
  vi.mocked(prisma.mtmSyncOperation.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmSyncOperation.create).mockResolvedValue({} as never)
  vi.mocked(prisma.mtmSyncOperation.findFirst).mockResolvedValue(null as never)
  vi.mocked(createVisitRequirementSnapshot).mockResolvedValue({} as never)
  vi.mocked(lockAndVerifyMtmRoutePointForCheckIn).mockResolvedValue(true)
  vi.mocked(lockMtmActiveVisitSlot).mockResolvedValue(undefined)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({
    agentId: "mtm-agent-1",
    role: "AGENT",
    scopedAgentIds: ["mtm-agent-1"],
  })
  txMock = {
    mtmSyncOperation: { create: vi.fn().mockResolvedValue({}) },
    mtmAgent: { findFirst: vi.fn().mockResolvedValue({ id: "mtm-agent-1" }) },
    // Since audit A6 a customer without coordinates is a check-in conflict; the
    // default fixture therefore carries a pair (no GPS fix is sent by default).
    mtmCustomer: { findFirst: vi.fn().mockResolvedValue({ id: "cust-1", latitude: 40.0, longitude: 49.0, geofenceRadius: null }) },
    mtmContact: { findFirst: vi.fn().mockResolvedValue({ id: "contact-1" }) },
    mtmVisit: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "visit-new", status: "CHECKED_IN" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    mtmVisitActionResult: { create: vi.fn().mockResolvedValue({ id: "res-1", actionKey: "PHOTO", status: "COMPLETED" }) },
    mtmRoutePoint: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    mtmSetting: { findFirst: vi.fn().mockResolvedValue(null) },
    mtmAlert: { create: vi.fn().mockResolvedValue({}) },
    mtmVisitParticipant: { createMany: vi.fn().mockResolvedValue({}) },
    mtmRoute: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  }
  vi.mocked(prisma.$transaction).mockImplementation(((cb: (tx: unknown) => unknown) => cb(txMock)) as never)
})

describe("POST /api/v1/mtm/sync/push", () => {
  it("400 on a malformed payload", async () => {
    const res = await POST(req({ operations: [{ bad: true }] }), undefined as never)
    expect(res.status).toBe(400)
  })

  it("403 when the authenticated web principal has no fresh MTM actor", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(null)

    const res = await POST(req({ operations: [checkoutOp()] }), undefined as never)

    expect(res.status).toBe(403)
    expect(vi.mocked(prisma.mtmSyncOperation.findMany)).not.toHaveBeenCalled()
    expect(vi.mocked(completeMtmVisit)).not.toHaveBeenCalled()
  })

  it("checks out a visit → ok, records the idempotency row", async () => {
    vi.mocked(completeMtmVisit).mockResolvedValue({ status: "completed", visit: { id: "v1" } } as never)
    const res = await POST(req({ operations: [checkoutOp()] }), undefined as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.results[0].status).toBe("ok")
    expect(vi.mocked(completeMtmVisit)).toHaveBeenCalledTimes(1)
    expect(txMock.mtmVisit.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        deletedAt: null,
        id: "v1",
        status: "CHECKED_IN",
        agentId: { in: ["mtm-agent-1"] },
      },
      data: { status: "CHECKED_IN" },
    })
  })

  it("does not continue checkout when the active fence misses but a scoped CHECKED_IN row appears", async () => {
    txMock.mtmVisit.updateMany.mockResolvedValue({ count: 0 })
    txMock.mtmVisit.findFirst.mockResolvedValue({ id: "v1", agentId: "mtm-agent-1", status: "CHECKED_IN" })

    const res = await POST(req({ operations: [checkoutOp()] }), undefined as never)

    expect((await res.json()).data.results[0]).toMatchObject({
      status: "conflict",
      result: { status: "visit_not_found" },
    })
    expect(vi.mocked(completeMtmVisit)).not.toHaveBeenCalled()
  })

  it("allows an explicitly CHECKED_OUT scoped visit to replay checkout idempotently", async () => {
    txMock.mtmVisit.updateMany.mockResolvedValue({ count: 0 })
    txMock.mtmVisit.findFirst.mockResolvedValue({ id: "v1", agentId: "mtm-agent-1", status: "CHECKED_OUT" })
    vi.mocked(completeMtmVisit).mockResolvedValue({ status: "completed", visit: { id: "v1" }, idempotent: true } as never)

    const res = await POST(req({ operations: [checkoutOp()] }), undefined as never)

    expect((await res.json()).data.results[0].status).toBe("ok")
    expect(vi.mocked(completeMtmVisit)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      organizationId: "org-1",
      visitId: "v1",
      expectedAgentId: "mtm-agent-1",
    }))
  })

  it("replays a previously-seen operationId WITHOUT re-applying", async () => {
    vi.mocked(prisma.mtmSyncOperation.findMany).mockResolvedValue([
      { operationId: uuid(), status: "ok", result: { status: "completed" } },
    ] as never)
    const res = await POST(req({ operations: [checkoutOp()] }), undefined as never)
    const body = await res.json()
    expect(body.data.results[0]).toMatchObject({ status: "ok", replayed: true })
    expect(vi.mocked(completeMtmVisit)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.mtmSyncOperation.findMany)).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        agentId: "u-1",
        operationId: { in: [uuid()] },
      },
      select: { operationId: true, status: true, result: true },
    })
  })

  it("does not check out a visit outside the manager's current scope", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-1",
      role: "MANAGER",
      scopedAgentIds: ["managed-agent"],
    })
    txMock.mtmVisit.updateMany.mockResolvedValue({ count: 0 })
    txMock.mtmVisit.findFirst.mockResolvedValue(null)

    const res = await POST(req({ operations: [checkoutOp()] }), undefined as never)
    const outcome = (await res.json()).data.results[0]

    expect(outcome).toMatchObject({ status: "conflict", result: { status: "visit_not_found" } })
    expect(vi.mocked(completeMtmVisit)).not.toHaveBeenCalled()
    expect(txMock.mtmSyncOperation.create).toHaveBeenCalledTimes(1)
    expect(txMock.mtmVisit.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        deletedAt: null,
        id: "v1",
        agentId: { in: ["managed-agent"] },
      },
      select: { id: true, agentId: true, status: true },
    })
  })

  it("maps a rejected check-out (not_found / missing_requirements) to conflict", async () => {
    vi.mocked(completeMtmVisit).mockResolvedValue({ status: "missing_requirements", missing: ["photo"] } as never)
    const res = await POST(req({ operations: [checkoutOp()] }), undefined as never)
    const body = await res.json()
    expect(body.data.results[0].status).toBe("conflict")
  })

  it("returns error for an unsupported op kind", async () => {
    const res = await POST(req({ operations: [{ operationId: uuid(), entity: "visits", op: "update", data: { kind: "frobnicate" } }] }), undefined as never)
    const body = await res.json()
    expect(body.data.results[0].status).toBe("error")
    expect(vi.mocked(completeMtmVisit)).not.toHaveBeenCalled()
  })

  const checkinOp = (operationId = uuid(), extra: Record<string, unknown> = {}) => ({
    operationId, entity: "visits", op: "create", data: { kind: "checkin", customerId: "cust-1", ...extra },
  })

  it("checks in → creates the visit + requirement snapshot, status ok", async () => {
    const res = await POST(req({ operations: [checkinOp()] }), undefined as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.results[0].status).toBe("ok")
    expect(txMock.mtmVisit.create).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createVisitRequirementSnapshot)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(lockMtmActiveVisitSlot)).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      agentId: "mtm-agent-1",
    })
    expect(vi.mocked(lockMtmActiveVisitSlot).mock.invocationCallOrder[0])
      .toBeLessThan(txMock.mtmVisit.findFirst.mock.invocationCallOrder[0])
  })

  it("refuses a check-in at a customer without coordinates with the shared code (audit A6)", async () => {
    txMock.mtmCustomer.findFirst.mockResolvedValue({ id: "cust-1", latitude: null, longitude: null, geofenceRadius: null })
    const res = await POST(req({ operations: [checkinOp()] }), undefined as never)
    const body = await res.json()
    expect(body.data.results[0].status).toBe("conflict")
    expect(body.data.results[0].result).toMatchObject({
      status: "customer_no_coordinates",
      code: "MTM_VISIT_CUSTOMER_NO_COORDINATES",
      customerId: "cust-1",
    })
    expect(txMock.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("check-in conflicts when the agent already has an open visit", async () => {
    txMock.mtmVisit.findFirst.mockResolvedValue({ id: "open-visit" })
    const res = await POST(req({ operations: [checkinOp()] }), undefined as never)
    const body = await res.json()
    expect(body.data.results[0].status).toBe("conflict")
    expect(txMock.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("check-in conflicts when the user is not a field agent", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null })
    const res = await POST(req({ operations: [checkinOp()] }), undefined as never)
    expect((await res.json()).data.results[0].result.status).toBe("not_an_agent")
    expect(txMock.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("rejects an ad-hoc check-in when the only route access is observer visibility", async () => {
    txMock.mtmCustomer.findFirst.mockResolvedValue(null)

    const res = await POST(req({ operations: [checkinOp()] }), undefined as never)

    expect((await res.json()).data.results[0].result.status).toBe("customer_not_found")
    const mutationScope = (txMock.mtmCustomer.findFirst.mock.calls[0][0] as any).where.AND[0]
    expect(mutationScope.OR[1].routePoints.some.route.OR[1]).toEqual({
      assignments: {
        some: {
          agentId: { in: ["mtm-agent-1"] },
          removedAt: null,
          role: { not: "OBSERVER" },
        },
      },
    })
    expect(txMock.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("check-in errors without a customerId", async () => {
    const res = await POST(req({ operations: [{ operationId: uuid(), entity: "visits", op: "create", data: { kind: "checkin" } }] }), undefined as never)
    expect((await res.json()).data.results[0].status).toBe("error")
  })

  it("rejects an ad-hoc contact that is not active at the tenant customer", async () => {
    txMock.mtmContact.findFirst.mockResolvedValue(null)

    const res = await POST(req({ operations: [checkinOp(uuid(), { contactId: "contact-foreign" })] }), undefined as never)

    expect((await res.json()).data.results[0].result.status).toBe("contact_not_found")
    expect(txMock.mtmContact.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "contact-foreign",
        organizationId: "org-1",
        deletedAt: null,
        status: { not: "INACTIVE" },
      }),
    }))
    expect(txMock.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("rejects invalid or partial check-in coordinates before domain writes", async () => {
    const res = await POST(req({ operations: [checkinOp(uuid(), { checkInLat: 999, checkInLng: 49 })] }), undefined as never)

    expect((await res.json()).data.results[0].status).toBe("error")
    expect(txMock.mtmVisit.create).not.toHaveBeenCalled()
    expect(vi.mocked(lockMtmActiveVisitSlot)).not.toHaveBeenCalled()
  })

  it("rejects an out-of-zone check-in with an alert and no visit", async () => {
    txMock.mtmCustomer.findFirst.mockResolvedValue({ id: "cust-1", latitude: 40.0, longitude: 49.0, geofenceRadius: 100 })
    const res = await POST(req({ operations: [checkinOp(uuid(), { checkInLat: 41.0, checkInLng: 50.0 })] }), undefined as never)
    expect((await res.json()).data.results[0].result.status).toBe("out_of_zone")
    expect(txMock.mtmAlert.create).toHaveBeenCalledTimes(1)
    expect(txMock.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("check-in conflicts when a targeted route point isn't available to the agent", async () => {
    const res = await POST(req({ operations: [checkinOp(uuid(), { routePointId: "rp-1" })] }), undefined as never)
    expect((await res.json()).data.results[0].result.status).toBe("route_point_unavailable")
    expect(txMock.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("a route-point check-in fans out participants and advances a PLANNED route", async () => {
    txMock.mtmRoutePoint.findFirst.mockResolvedValue({
      id: "rp-1", routeId: "r-1", customerId: "cust-1", contactId: null,
      route: { status: "PLANNED", assignments: [{ agentId: "mtm-agent-1", role: "OWNER" }, { agentId: "other-agent", role: "PARTICIPANT" }] },
    })
    const res = await POST(req({ operations: [checkinOp(uuid(), { routePointId: "rp-1" })] }), undefined as never)
    expect((await res.json()).data.results[0].status).toBe("ok")
    expect(lockAndVerifyMtmRoutePointForCheckIn).toHaveBeenCalledWith(txMock, expect.objectContaining({
      routePointId: "rp-1",
      routeId: "r-1",
      customerId: "cust-1",
      contactId: null,
    }))
    expect(txMock.mtmRoutePoint.updateMany).not.toHaveBeenCalled()
    // only the OTHER agent becomes a participant
    expect(txMock.mtmVisitParticipant.createMany.mock.calls[0][0].data).toEqual([{
      organizationId: "org-1",
      visitId: "visit-new",
      agentId: "other-agent",
      role: "PARTICIPANT",
      joinedAt: expect.any(Date),
    }])
    expect(txMock.mtmVisitParticipant.createMany.mock.calls[0][0].data[0].joinedAt)
      .toEqual(txMock.mtmVisit.create.mock.calls[0][0].data.checkInAt)
    expect(txMock.mtmRoute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "r-1",
        organizationId: "org-1",
        status: "PLANNED",
        deletedAt: null,
      }),
    }))
  })

  it("does not create a visit when the route-point fence loses current assignment", async () => {
    txMock.mtmRoutePoint.findFirst.mockResolvedValue({
      id: "rp-1", routeId: "r-1", customerId: "cust-1", contactId: null,
      route: { status: "PLANNED", assignments: [] },
    })
    vi.mocked(lockAndVerifyMtmRoutePointForCheckIn).mockResolvedValue(false)

    const res = await POST(req({ operations: [checkinOp(uuid(), { routePointId: "rp-1" })] }), undefined as never)

    expect((await res.json()).data.results[0].result.status).toBe("route_point_unavailable")
    expect(txMock.mtmVisit.create).not.toHaveBeenCalled()
    expect(txMock.mtmVisitParticipant.createMany).not.toHaveBeenCalled()
  })

  const actionOp = (extra: Record<string, unknown> = {}) => ({
    operationId: uuid(), entity: "visits", op: "update",
    data: { kind: "visit_action", visitId: "v1", actionKey: "PHOTO", status: "COMPLETED", evidence: { note: "ok" }, ...extra },
  })

  it("records a visit action (survey answer) for a CHECKED_IN visit", async () => {
    txMock.mtmVisit.findFirst.mockResolvedValue({ id: "v1", agentId: "a1", status: "CHECKED_IN", requirementSnapshot: { requirements: [{ id: "req-1", actionKey: "PHOTO" }] } })
    const res = await POST(req({ operations: [actionOp()] }), undefined as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.results[0].status).toBe("ok")
    expect(txMock.mtmVisitActionResult.create).toHaveBeenCalledTimes(1)
    expect(txMock.mtmVisitActionResult.create.mock.calls[0][0].data).toMatchObject({
      visitId: "v1",
      requirementId: "req-1",
      actionKey: "PHOTO",
      completedByAgentId: "mtm-agent-1",
    })
  })

  it("visit_action fails closed before reading or writing when its active-visit fence misses", async () => {
    txMock.mtmVisit.updateMany.mockResolvedValue({ count: 0 })
    const res = await POST(req({ operations: [actionOp()] }), undefined as never)
    expect((await res.json()).data.results[0].result.status).toBe("visit_not_found")
    expect(txMock.mtmVisit.findFirst).not.toHaveBeenCalled()
    expect(txMock.mtmVisitActionResult.create).not.toHaveBeenCalled()
  })

  it("participant-only actor cannot add a visit action to another primary agent's visit", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "participant-1",
      role: "AGENT",
      scopedAgentIds: ["participant-1"],
    })
    txMock.mtmVisit.updateMany.mockResolvedValue({ count: 0 })

    const res = await POST(req({ operations: [actionOp()] }), undefined as never)
    const outcome = (await res.json()).data.results[0]

    expect(outcome).toMatchObject({ status: "conflict", result: { status: "visit_not_found" } })
    expect(txMock.mtmVisit.updateMany.mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1",
      deletedAt: null,
      id: "v1",
      agentId: { in: ["participant-1"] },
    })
    expect(txMock.mtmVisitActionResult.create).not.toHaveBeenCalled()
  })

  it("visit_action conflicts when the action isn't in the requirement snapshot", async () => {
    txMock.mtmVisit.findFirst.mockResolvedValue({ id: "v1", agentId: "a1", status: "CHECKED_IN", requirementSnapshot: { requirements: [{ id: "req-1", actionKey: "STOCK_CHECK" }] } })
    const res = await POST(req({ operations: [actionOp()] }), undefined as never)
    expect((await res.json()).data.results[0].result.status).toBe("action_hidden")
    expect(txMock.mtmVisitActionResult.create).not.toHaveBeenCalled()
  })

  it("visit_action rejects a waiver without the online-required reason", async () => {
    const res = await POST(req({ operations: [actionOp({ status: "WAIVED", evidence: {} })] }), undefined as never)

    expect((await res.json()).data.results[0].status).toBe("error")
    expect(txMock.mtmVisit.updateMany).not.toHaveBeenCalled()
    expect(txMock.mtmVisitActionResult.create).not.toHaveBeenCalled()
  })

  it("visit_action cannot waive a non-waivable requirement", async () => {
    txMock.mtmVisit.findFirst.mockResolvedValue({
      id: "v1",
      agentId: "mtm-agent-1",
      status: "CHECKED_IN",
      requirementSnapshot: { requirements: [{ id: "req-1", actionKey: "PHOTO", mode: "REQUIRED", allowWaiver: false }] },
    })

    const res = await POST(req({ operations: [actionOp({ status: "WAIVED", evidence: { reason: "Unavailable" } })] }), undefined as never)

    expect((await res.json()).data.results[0].result.status).toBe("waiver_forbidden")
    expect(txMock.mtmVisitActionResult.create).not.toHaveBeenCalled()
  })

  it("visit_action errors on missing required fields", async () => {
    const res = await POST(req({ operations: [{ operationId: uuid(), entity: "visits", op: "update", data: { kind: "visit_action", visitId: "v1" } }] }), undefined as never)
    expect((await res.json()).data.results[0].status).toBe("error")
  })
})
