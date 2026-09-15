import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import {
  applyPublishedRoutePointDiff,
  diffPublishedRoutePoints,
  isRetryableRouteTransactionConflict,
  lockPublishedRoutePoints,
  samePublishedRoutePointDiff,
  PublishedRoutePointsChangedError,
  publishedRouteResultPoints,
  toPublishedRouteExistingPoint,
  type PublishedRouteExistingPoint,
} from "@/lib/mtm/route-published-diff"

const at = (time: string) => new Date(`2026-09-15T${time}:00.000Z`)

function point(
  id: string,
  customerId: string,
  orderIndex: number,
  extra: Partial<PublishedRouteExistingPoint> = {},
): PublishedRouteExistingPoint {
  return {
    id,
    customerId,
    contactId: null,
    orderIndex,
    plannedTime: null,
    status: "PENDING",
    visitCount: 0,
    pendingChangeRequestCount: 0,
    ...extra,
  }
}

describe("diffPublishedRoutePoints", () => {
  it("keeps ids of stops that stay, removes dropped stops and adds new ones in the requested order", () => {
    const existing = [point("p1", "c1", 0), point("p2", "c2", 1), point("p3", "c3", 2)]
    const diff = diffPublishedRoutePoints(existing, [
      { customerId: "c3", plannedTime: "2026-09-15T09:00:00.000Z" },
      { customerId: "c4" },
      { customerId: "c1" },
    ])

    expect(diff).toEqual({
      ok: true,
      kept: [
        { id: "p3", orderIndex: 0, plannedTime: at("09:00"), changed: true, locked: false },
        { id: "p1", orderIndex: 2, plannedTime: null, changed: true, locked: false },
      ],
      removed: [existing[1]],
      added: [{ customerId: "c4", contactId: null, orderIndex: 1, plannedTime: null }],
    })
  })

  it("marks an unchanged stop as needing no write", () => {
    const diff = diffPublishedRoutePoints([point("p1", "c1", 0, { plannedTime: at("10:00") })], [
      { customerId: "c1", plannedTime: "2026-09-15T10:00:00.000Z" },
    ])
    expect(diff.ok && diff.kept[0]).toMatchObject({ id: "p1", changed: false })
  })

  it("treats the same doctor at another clinic as a different stop", () => {
    const existing = [point("p1", "clinic-1", 0, { contactId: "doctor-1" })]
    const diff = diffPublishedRoutePoints(existing, [{ customerId: "clinic-2", contactId: "doctor-1" }])
    expect(diff).toMatchObject({ ok: true, kept: [], removed: [{ id: "p1" }], added: [{ customerId: "clinic-2" }] })
  })

  it("locks a visited stop against removal", () => {
    const diff = diffPublishedRoutePoints(
      [point("p1", "c1", 0, { status: "VISITED" }), point("p2", "c2", 1)],
      [{ customerId: "c2" }],
    )
    expect(diff).toEqual({ ok: false, code: "ROUTE_VISITED_POINTS_LOCKED", pointIds: ["p1"] })
  })

  it("locks a PENDING stop that already has a visit", () => {
    const diff = diffPublishedRoutePoints(
      [point("p1", "c1", 0, { visitCount: 1 }), point("p2", "c2", 1)],
      [{ customerId: "c2" }],
    )
    expect(diff).toEqual({ ok: false, code: "ROUTE_VISITED_POINTS_LOCKED", pointIds: ["p1"] })
  })

  it("refuses to swap two locked stops but lets new and pending stops move around them", () => {
    const existing = [
      point("p1", "c1", 0, { status: "VISITED" }),
      point("p2", "c2", 1, { status: "SKIPPED" }),
      point("p3", "c3", 2),
    ]
    expect(diffPublishedRoutePoints(existing, [{ customerId: "c2" }, { customerId: "c1" }, { customerId: "c3" }]))
      .toEqual({ ok: false, code: "ROUTE_VISITED_POINTS_LOCKED", pointIds: ["p1", "p2"] })

    const allowed = diffPublishedRoutePoints(existing, [
      { customerId: "c3" },
      { customerId: "c1" },
      { customerId: "c9" },
      { customerId: "c2" },
    ])
    expect(allowed).toMatchObject({
      ok: true,
      kept: [
        { id: "p3", orderIndex: 0, locked: false },
        { id: "p1", orderIndex: 1, locked: true },
        { id: "p2", orderIndex: 3, locked: true },
      ],
      removed: [],
      added: [{ customerId: "c9", orderIndex: 2 }],
    })
  })

  it("refuses to retime a locked stop but ignores sub-minute noise", () => {
    const existing = [point("p1", "c1", 0, { status: "VISITED", plannedTime: new Date("2026-09-15T09:00:30.000Z") })]
    expect(diffPublishedRoutePoints(existing, [{ customerId: "c1", plannedTime: "2026-09-15T10:00:00.000Z" }]))
      .toEqual({ ok: false, code: "ROUTE_VISITED_POINTS_LOCKED", pointIds: ["p1"] })
    const same = diffPublishedRoutePoints(existing, [{ customerId: "c1", plannedTime: "2026-09-15T09:00:00.000Z" }])
    expect(same).toMatchObject({
      ok: true,
      kept: [{ id: "p1", plannedTime: new Date("2026-09-15T09:00:30.000Z"), changed: false }],
    })
  })

  it("refuses to remove a stop with a pending change request", () => {
    const diff = diffPublishedRoutePoints(
      [point("p1", "c1", 0, { pendingChangeRequestCount: 1 }), point("p2", "c2", 1)],
      [{ customerId: "c2" }],
    )
    expect(diff).toEqual({ ok: false, code: "ROUTE_POINT_CHANGE_PENDING", pointIds: ["p1"] })
  })

  it("returns the resulting stop list for dedupe and conflict checks", () => {
    const existing = [point("p1", "c1", 0, { status: "VISITED", plannedTime: new Date("2026-09-15T09:00:30.000Z") })]
    const requested = [{ customerId: "c1", plannedTime: "2026-09-15T09:00:00.000Z" }, { customerId: "c2" }]
    const diff = diffPublishedRoutePoints(existing, requested)
    if (!diff.ok) throw new Error("diff refused")
    expect(publishedRouteResultPoints(requested, diff)).toEqual([
      { customerId: "c1", contactId: null, plannedTime: new Date("2026-09-15T09:00:30.000Z"), deletedAt: null },
      { customerId: "c2", contactId: null, plannedTime: null, deletedAt: null },
    ])
  })

  it("reads visit and pending-request counts from the Prisma select", () => {
    expect(toPublishedRouteExistingPoint({
      id: "p1",
      customerId: "c1",
      contactId: null,
      orderIndex: 0,
      plannedTime: null,
      status: "PENDING",
      _count: { visits: 2, changeRequests: 1 },
    })).toMatchObject({ visitCount: 2, pendingChangeRequestCount: 1 })
  })
})

describe("applyPublishedRoutePointDiff", () => {
  function client(removedCount: number) {
    return {
      mtmRoutePoint: {
        updateMany: vi.fn().mockResolvedValueOnce({ count: removedCount }).mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
  }

  it("fences removal on PENDING, no visit and no pending request, then reorders and creates", async () => {
    const existing = [point("p1", "c1", 0), point("p2", "c2", 1)]
    const diff = diffPublishedRoutePoints(existing, [{ customerId: "c2" }, { customerId: "c3" }])
    if (!diff.ok) throw new Error("diff refused")
    const tx = client(1)
    const now = new Date("2026-09-15T08:00:00.000Z")

    await applyPublishedRoutePointDiff(tx as never, { organizationId: "org-1", routeId: "r1", diff, now })

    expect(tx.mtmRoutePoint.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: { in: ["p1"] },
        routeId: "r1",
        organizationId: "org-1",
        deletedAt: null,
        status: "PENDING",
        visits: { none: { deletedAt: null } },
        changeRequests: { none: { status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] } } },
      },
      data: { deletedAt: now, version: { increment: 1 } },
    })
    expect(tx.mtmRoutePoint.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      // An unlocked stop is moved only while it is still without field history.
      where: expect.objectContaining({ id: "p2", status: "PENDING", visits: { none: { deletedAt: null } } }),
      data: { orderIndex: 0, plannedTime: null, version: { increment: 1 } },
    }))
    expect(tx.mtmRoutePoint.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: "org-1", routeId: "r1", customerId: "c3", contactId: null, orderIndex: 1, plannedTime: null }],
    })
  })

  it("throws when a stop got a check-in between the read and the write", async () => {
    const diff = diffPublishedRoutePoints([point("p1", "c1", 0), point("p2", "c2", 1)], [{ customerId: "c2" }])
    if (!diff.ok) throw new Error("diff refused")
    const tx = client(0)
    await expect(applyPublishedRoutePointDiff(tx as never, {
      organizationId: "org-1",
      routeId: "r1",
      diff,
      now: new Date(),
    })).rejects.toBeInstanceOf(PublishedRoutePointsChangedError)
    expect(tx.mtmRoutePoint.createMany).not.toHaveBeenCalled()
  })
})

describe("lockPublishedRoutePoints", () => {
  function lockClient(freshIds: string[]) {
    const calls: string[] = []
    const tx = {
      $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push(`advisory:${String(values[0])}`)
        return Promise.resolve(1)
      }),
      $queryRaw: vi.fn((strings: TemplateStringsArray) => {
        calls.push(strings.join("?").includes("FOR UPDATE") ? "row-lock" : "query")
        return Promise.resolve([])
      }),
      mtmRoutePoint: {
        findMany: vi.fn(() => {
          calls.push("fresh-read")
          return Promise.resolve(freshIds.map((id, index) => ({
            id,
            customerId: `c-${id}`,
            contactId: null,
            orderIndex: index,
            plannedTime: null,
            status: "PENDING",
            _count: { visits: id === "p1" ? 1 : 0, changeRequests: 0 },
          })))
        }),
      },
    }
    return { tx, calls }
  }

  it("takes check-in's advisory lock per point in sorted order, then row locks, then reads in a new statement", async () => {
    const { tx, calls } = lockClient(["p3", "p1", "p2"])

    const points = await lockPublishedRoutePoints(tx as never, {
      organizationId: "org-1",
      routeId: "r1",
      pointIds: ["p3", "p1", "p2", "p1"],
    })

    expect(calls).toEqual([
      "advisory:mtm-route-point-check-in:org-1:p1",
      "advisory:mtm-route-point-check-in:org-1:p2",
      "advisory:mtm-route-point-check-in:org-1:p3",
      "row-lock",
      "fresh-read",
    ])
    const rowLockSql = (tx.$queryRaw.mock.calls[0]![0] as TemplateStringsArray).join("?")
    expect(rowLockSql).toMatch(/ORDER BY "id"\s+FOR UPDATE/)
    // The visit that committed while we waited is visible in the fresh read.
    expect(points?.find((point) => point.id === "p1")).toMatchObject({ visitCount: 1 })
  })

  it("returns null when a stop appeared after the route was read", async () => {
    const { tx } = lockClient(["p1", "p2", "p9"])
    await expect(lockPublishedRoutePoints(tx as never, { organizationId: "org-1", routeId: "r1", pointIds: ["p1", "p2"] }))
      .resolves.toBeNull()
  })

  it("compares a pre-lock diff with the locked one", () => {
    const before = diffPublishedRoutePoints([point("p1", "c1", 0), point("p2", "c2", 1)], [{ customerId: "c2" }])
    const same = diffPublishedRoutePoints([point("p1", "c1", 0), point("p2", "c2", 1)], [{ customerId: "c2" }])
    const moved = diffPublishedRoutePoints([point("p1", "c1", 1), point("p2", "c2", 0)], [{ customerId: "c2" }])
    if (!before.ok || !same.ok || !moved.ok) throw new Error("diff refused")
    expect(samePublishedRoutePointDiff(before, same)).toBe(true)
    expect(samePublishedRoutePointDiff(before, moved)).toBe(false)
  })
})

describe("isRetryableRouteTransactionConflict", () => {
  it("recognizes deadlocks and serialization failures, not other errors", () => {
    const known = (code: string, meta?: Record<string, unknown>) =>
      new Prisma.PrismaClientKnownRequestError("boom", { code, clientVersion: "6", meta })
    expect(isRetryableRouteTransactionConflict(known("P2034"))).toBe(true)
    expect(isRetryableRouteTransactionConflict(known("P2028"))).toBe(true)
    expect(isRetryableRouteTransactionConflict(known("P2024"))).toBe(true)
    expect(isRetryableRouteTransactionConflict(known("P2010", { code: "40P01" }))).toBe(true)
    expect(isRetryableRouteTransactionConflict(new Error("ERROR: deadlock detected"))).toBe(true)
    expect(isRetryableRouteTransactionConflict(new Error("could not serialize access due to concurrent update"))).toBe(true)
    expect(isRetryableRouteTransactionConflict(known("P2002"))).toBe(false)
    expect(isRetryableRouteTransactionConflict(new Error("database unavailable"))).toBe(false)
  })
})

