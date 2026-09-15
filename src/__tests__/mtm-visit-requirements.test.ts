import { describe, expect, it, vi } from "vitest"

import {
  completeMtmVisit,
  createVisitRequirementSnapshot,
  getVisitCompletionReadiness,
  lockAndVerifyMtmRoutePointForCheckIn,
  lockMtmActiveVisitSlot,
} from "@/lib/mtm/visit-requirements"
import { lockPublishedRoutePoints, mtmRoutePointCheckInLockKey } from "@/lib/mtm/route-published-diff"

function transactionClient(visit: Record<string, unknown>) {
  return {
    mtmVisit: {
      findFirst: vi.fn().mockResolvedValue(visit),
      update: vi.fn().mockResolvedValue({
        id: "visit-1",
        agentId: "agent-1",
        status: "CHECKED_OUT",
        checkOutAt: new Date("2026-07-13T10:30:00Z"),
        duration: 30,
        routeId: "route-1",
        routePointId: "point-1",
      }),
    },
    mtmRoutePoint: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(1),
    },
    mtmRoute: {
      findFirst: vi.fn().mockResolvedValue({ id: "route-1", totalPoints: 1, status: "IN_PROGRESS" }),
      update: vi.fn().mockResolvedValue({ id: "route-1" }),
    },
  }
}

const activeVisit = {
  id: "visit-1",
  agentId: "agent-1",
  status: "CHECKED_IN",
  checkInAt: new Date("2026-07-13T10:00:00Z"),
  checkOutAt: null,
  routeId: "route-1",
  routePointId: "point-1",
  requirementSnapshot: {
    requirements: [
      { id: "req-photo", actionKey: "PHOTO", minCount: 2, allowWaiver: false },
      { id: "req-note", actionKey: "VISIT_NOTE", minCount: 1, allowWaiver: true },
    ],
  },
  actionResults: [{ actionKey: "VISIT_NOTE", status: "WAIVED" }],
  _count: { photos: 1 },
}

describe("visit completion requirements", () => {
  it("uses one transaction advisory key for every writer of an agent's active-visit slot", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0)

    await lockMtmActiveVisitSlot({ $executeRaw: executeRaw } as never, {
      organizationId: "org-1",
      agentId: "agent-1",
    })

    expect(executeRaw).toHaveBeenCalledTimes(1)
    const call = executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, string]
    expect(call[0].join("?")).toContain("pg_advisory_xact_lock")
    expect(call[1]).toBe("mtm-active-visit:org-1:agent-1")
  })

  it("locks and rechecks a route point without writing a false sync delta", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0)
    const queryRaw = vi.fn().mockResolvedValue([{ id: "point-1" }])
    const findFirst = vi.fn().mockResolvedValue({ id: "point-1" })

    const available = await lockAndVerifyMtmRoutePointForCheckIn({
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      mtmRoutePoint: { findFirst },
    } as never, {
      organizationId: "org-1",
      agentId: "agent-1",
      routePointId: "point-1",
      routeId: "route-1",
      customerId: "customer-1",
      contactId: null,
    })

    expect(available).toBe(true)
    expect(executeRaw).toHaveBeenCalledTimes(1)
    const call = executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, string]
    expect(call[0].join("?")).toContain("pg_advisory_xact_lock")
    expect(call[1]).toBe("mtm-route-point-check-in:org-1:point-1")
    expect(queryRaw).toHaveBeenCalledTimes(1)
    const lockCall = queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, string, string]
    expect(lockCall[0].join("?")).toContain('FROM "mtm_route_points"')
    expect(lockCall[0].join("?")).toContain("FOR UPDATE")
    expect(lockCall.slice(1)).toEqual(["point-1", "org-1"])
    expect(findFirst).toHaveBeenCalledTimes(2)
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "point-1",
        routeId: "route-1",
        status: "PENDING",
        deletedAt: null,
      }),
      select: { id: true },
    }))
  })

  it("check-in and a published-route edit take the very same per-point advisory lock", async () => {
    const checkInRaw = vi.fn().mockResolvedValue(0)
    await lockAndVerifyMtmRoutePointForCheckIn({
      $executeRaw: checkInRaw,
      $queryRaw: vi.fn().mockResolvedValue([]),
      mtmRoutePoint: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never, {
      organizationId: "org-1",
      agentId: "agent-1",
      routePointId: "point-1",
      routeId: "route-1",
      customerId: "customer-1",
      contactId: null,
    })
    const editRaw = vi.fn().mockResolvedValue(0)
    await lockPublishedRoutePoints({
      $executeRaw: editRaw,
      $queryRaw: vi.fn().mockResolvedValue([]),
      mtmRoutePoint: { findMany: vi.fn().mockResolvedValue([]) },
    } as never, { organizationId: "org-1", routeId: "route-1", pointIds: ["point-1"] })

    const checkInKey = (checkInRaw.mock.calls[0] as unknown as [TemplateStringsArray, string])[1]
    const editKey = (editRaw.mock.calls[0] as unknown as [TemplateStringsArray, string])[1]
    expect(checkInKey).toBe(mtmRoutePointCheckInLockKey("org-1", "point-1"))
    expect(editKey).toBe(checkInKey)
    // Both must hash the key the same way, not just build the same string.
    expect((checkInRaw.mock.calls[0]![0] as TemplateStringsArray).join("?"))
      .toContain("hashtextextended(")
    expect((editRaw.mock.calls[0]![0] as TemplateStringsArray).join("?").replace(/\s+/g, ""))
      .toBe((checkInRaw.mock.calls[0]![0] as TemplateStringsArray).join("?").replace(/\s+/g, ""))
  })

  it("returns structured missing requirements and counts photo evidence", async () => {
    const tx = transactionClient(activeVisit)
    const result = await getVisitCompletionReadiness(tx as never, { organizationId: "org-1", visitId: "visit-1" })

    expect(result.found).toBe(true)
    expect(result.missing).toEqual([{
      actionKey: "PHOTO",
      requiredCount: 2,
      completedCount: 1,
      allowWaiver: false,
      code: "MTM_VISIT_ACTION_REQUIRED",
    }])
  })

  it("does not change visit or route while a required action is missing", async () => {
    const tx = transactionClient(activeVisit)
    const result = await completeMtmVisit(tx as never, { organizationId: "org-1", visitId: "visit-1" })

    expect(result.status).toBe("missing_requirements")
    expect(tx.mtmVisit.update).not.toHaveBeenCalled()
    expect(tx.mtmRoutePoint.updateMany).not.toHaveBeenCalled()
    expect(tx.mtmRoute.update).not.toHaveBeenCalled()
  })

  it("completes explicitly and marks the linked stop and route once requirements pass", async () => {
    const tx = transactionClient({ ...activeVisit, _count: { photos: 2 } })
    const result = await completeMtmVisit(tx as never, {
      organizationId: "org-1",
      visitId: "visit-1",
      expectedAgentId: "agent-1",
      checkOutAt: new Date("2026-07-13T10:30:00Z"),
    })

    expect(result.status).toBe("completed")
    expect(tx.mtmVisit.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "visit-1",
        organizationId: "org-1",
        agentId: "agent-1",
        status: "CHECKED_IN",
      }),
      data: expect.objectContaining({ status: "CHECKED_OUT", duration: 30 }),
    }))
    expect(tx.mtmRoutePoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "VISITED", version: { increment: 1 } }),
    }))
    expect(tx.mtmRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED", visitedPoints: 1 }),
    }))
  })

  it("treats a repeated completion as idempotent", async () => {
    const checkedOut = { ...activeVisit, status: "CHECKED_OUT", checkOutAt: new Date(), _count: { photos: 2 } }
    const tx = transactionClient(checkedOut)
    const result = await completeMtmVisit(tx as never, { organizationId: "org-1", visitId: "visit-1" })

    expect(result).toMatchObject({ status: "completed", idempotent: true })
    expect(tx.mtmVisit.update).not.toHaveBeenCalled()
  })
})

describe("requirement snapshot honours the visit-policy switch", () => {
  function snapshotTx(settings: Record<string, unknown>) {
    return {
      mtmAgent: { findFirst: vi.fn().mockResolvedValue({ id: "agent-1", teamId: null }) },
      mtmCustomer: { findFirst: vi.fn().mockResolvedValue({ id: "customer-1", category: "A", objectType: "DOCTOR" }) },
      mtmSetting: {
        findFirst: vi.fn(({ where }: { where: { key: string } }) => Promise.resolve(
          where.key in settings ? { value: settings[where.key] } : null,
        )),
      },
      mtmVisitPolicy: {
        findMany: vi.fn().mockResolvedValue([{
          id: "policy-strict",
          name: "Strict",
          teamId: null,
          visitType: "DEFAULT",
          priority: 1,
          effectiveFrom: new Date("2026-01-01"),
          actions: [{ actionKey: "PRESENTATION", mode: "REQUIRED", minCount: 1, conditions: null, allowWaiver: false }],
        }]),
      },
      mtmVisitRequirementSnapshot: { create: vi.fn().mockResolvedValue({ id: "snapshot-1", requirements: [] }) },
    }
  }
  const input = { organizationId: "org-1", visitId: "visit-1", agentId: "agent-1", customerId: "customer-1" }

  it("snapshots no REQUIRED rule action while the switch is off", async () => {
    const tx = snapshotTx({ visitPoliciesEnabled: false })
    await createVisitRequirementSnapshot(tx as never, input)
    const data = tx.mtmVisitRequirementSnapshot.create.mock.calls[0][0].data
    expect(data.sourcePolicyId).toBeNull()
    expect(data.requirements.create.every((item: { mode: string }) => item.mode === "OPTIONAL")).toBe(true)
  })

  it("snapshots the active rule while the switch is on", async () => {
    const tx = snapshotTx({ visitPoliciesEnabled: true })
    await createVisitRequirementSnapshot(tx as never, input)
    const data = tx.mtmVisitRequirementSnapshot.create.mock.calls[0][0].data
    expect(data.sourcePolicyId).toBe("policy-strict")
    expect(data.requirements.create.find((item: { actionKey: string }) => item.actionKey === "PRESENTATION").mode).toBe("REQUIRED")
  })
})

describe("check-out never demands more photos than an agent may upload", () => {
  const overCapVisit = {
    ...activeVisit,
    requirementSnapshot: { requirements: [{ id: "req-photo", actionKey: "PHOTO", minCount: 15, allowWaiver: false }] },
    actionResults: [],
    _count: { photos: 10 },
  }

  function withSetting(visit: Record<string, unknown>, value: unknown) {
    return {
      ...transactionClient(visit),
      mtmSetting: { findFirst: vi.fn().mockResolvedValue(value === undefined ? null : { value }) },
    }
  }

  it("treats a PHOTO minimum above maxPhotosPerVisit as met at the cap, with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const tx = withSetting(overCapVisit, 10)
    const result = await completeMtmVisit(tx as never, { organizationId: "org-1", visitId: "visit-1" })
    expect(result.status).toBe("completed")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("capping"), expect.objectContaining({ minCount: 15, maxPhotosPerVisit: 10 }))
    warn.mockRestore()
  })

  it("still reports the capped count while below the cap (default cap 10 when unset)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const tx = withSetting({ ...overCapVisit, _count: { photos: 4 } }, undefined)
    const result = await getVisitCompletionReadiness(tx as never, { organizationId: "org-1", visitId: "visit-1" })
    expect(result.missing).toEqual([expect.objectContaining({ actionKey: "PHOTO", requiredCount: 10, completedCount: 4 })])
    warn.mockRestore()
  })

  it("does not read the setting when the photo minimum is already met", async () => {
    const tx = withSetting({ ...overCapVisit, requirementSnapshot: { requirements: [{ id: "r", actionKey: "PHOTO", minCount: 2, allowWaiver: false }] }, _count: { photos: 3 } }, 10)
    await getVisitCompletionReadiness(tx as never, { organizationId: "org-1", visitId: "visit-1" })
    expect(tx.mtmSetting.findFirst).not.toHaveBeenCalled()
  })
})
