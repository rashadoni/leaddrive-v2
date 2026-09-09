import { describe, expect, it } from "vitest"
import {
  MobileSyncV2CursorError,
  MTM_MOBILE_SYNC_V2_DELTA_CURSOR_TTL_MS,
  MTM_MOBILE_SYNC_V2_MAX_CURSOR_LENGTH,
  MTM_MOBILE_SYNC_V2_ROUTE_HORIZON_POLICY_VERSION,
  MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
  MTM_MOBILE_SYNC_V2_TASK_STREAM,
  MTM_MOBILE_SYNC_V2_TOMBSTONE_RETENTION_DAYS,
  MTM_MOBILE_SYNC_V2_VISIT_STREAM,
  MTM_MOBILE_SYNC_V2_WORKFORCE_STREAM,
  mobileSyncV2ActiveTaskHorizon,
  mobileSyncV2ActiveTaskWhere,
  mobileSyncV2ActiveVisitHorizon,
  mobileSyncV2ActiveVisitWhere,
  mobileSyncV2RouteHorizon,
  mobileSyncV2RouteScope,
  mobileSyncV2WorkdayHorizon,
  mobileSyncV2WorkdayWhere,
  nextMobileSyncV2DeltaCursor,
  nextMobileSyncV2SnapshotCursor,
  parseMobileSyncV2DeviceId,
  parseMobileSyncV2PageSize,
  projectMtmMobileSyncV2Route,
  projectMtmMobileSyncV2Task,
  projectMtmMobileSyncV2Visit,
  projectMtmMobileSyncV2Workday,
  readMobileSyncV2Cursor,
  type MobileSyncV2CursorContext,
} from "@/lib/mtm/mobile-sync-v2"

const context: MobileSyncV2CursorContext = {
  organizationId: "org-1",
  agentId: "agent-1",
  deviceId: "device-1",
  stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
}

describe("MTM mobile sync v2 opaque cursors", () => {
  it("seals tenant, agent, device, stream and decimal revision", () => {
    const nowMs = Date.parse("2026-08-28T12:00:00.000Z")
    const token = nextMobileSyncV2DeltaCursor({
      context,
      revision: 42n,
      scopeRevision: 7n,
      horizonKey: "2026-08-28",
      nowMs,
    })

    expect(token).toMatch(/^v1:/)
    expect(token).not.toContain("org-1")
    expect(token).not.toContain("agent-1")
    expect(readMobileSyncV2Cursor(token, context, nowMs)).toMatchObject({
      kind: "delta",
      revision: "42",
      scopeRevision: "7",
      horizonKey: "2026-08-28",
    })
  })

  it("rejects a cursor replayed by another tenant, agent or device", () => {
    const token = nextMobileSyncV2DeltaCursor({
      context,
      revision: 0n,
      scopeRevision: 0n,
      horizonKey: "2026-08-28",
    })

    expect(() => readMobileSyncV2Cursor(token, { ...context, organizationId: "org-2" }))
      .toThrow(MobileSyncV2CursorError)
    expect(() => readMobileSyncV2Cursor(token, { ...context, agentId: "agent-2" }))
      .toThrow(MobileSyncV2CursorError)
    expect(() => readMobileSyncV2Cursor(token, { ...context, deviceId: "device-2" }))
      .toThrow(MobileSyncV2CursorError)
    expect(() => readMobileSyncV2Cursor(token, { ...context, stream: MTM_MOBILE_SYNC_V2_VISIT_STREAM }))
      .toThrow(MobileSyncV2CursorError)
  })

  it("rejects oversized opaque input before attempting decryption", () => {
    expect(() => readMobileSyncV2Cursor("v1:" + "a".repeat(MTM_MOBILE_SYNC_V2_MAX_CURSOR_LENGTH), context))
      .toThrow(MobileSyncV2CursorError)
  })

  it("keeps delta cursors usable through the supported offline horizon and expires snapshot pages", () => {
    const nowMs = Date.parse("2026-08-28T12:00:00.000Z")
    const delta = nextMobileSyncV2DeltaCursor({
      context,
      revision: 0n,
      scopeRevision: 0n,
      horizonKey: "2026-08-28",
      nowMs,
    })
    expect(MTM_MOBILE_SYNC_V2_DELTA_CURSOR_TTL_MS)
      .toBe(MTM_MOBILE_SYNC_V2_TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1_000)
    expect(() => readMobileSyncV2Cursor(delta, context, nowMs + 7 * 24 * 60 * 60 * 1_000 - 1))
      .not.toThrow()

    const snapshot = nextMobileSyncV2SnapshotCursor({
      context,
      snapshotId: "snapshot-1",
      ordinal: 500,
      scopeRevision: 0n,
      horizonKey: "2026-08-28",
      expiresAt: new Date(nowMs - 1),
    })
    expect(() => readMobileSyncV2Cursor(snapshot, context, nowMs)).toThrow(MobileSyncV2CursorError)
  })
})

describe("MTM mobile sync v2 route contract helpers", () => {
  it.each([
    [null, 200],
    ["", 200],
    ["0", 1],
    ["1", 1],
    ["500", 500],
    ["501", 500],
    ["not-a-number", 200],
  ])("bounds page size %s to %d", (value, expected) => {
    expect(parseMobileSyncV2PageSize(value)).toBe(expected)
  })

  it("accepts only stable, transport-safe device ids", () => {
    expect(parseMobileSyncV2DeviceId("android-uuid:abc_123")).toBe("android-uuid:abc_123")
    expect(parseMobileSyncV2DeviceId(" device-1 ")).toBe("device-1")
    expect(parseMobileSyncV2DeviceId("device with spaces")).toBeNull()
    expect(parseMobileSyncV2DeviceId("\nunsafe")).toBeNull()
  })

  it("uses active primary-or-non-observer assignment scope and an explicit date horizon", () => {
    expect(mobileSyncV2RouteScope("org-1", "agent-1")).toEqual({
      organizationId: "org-1",
      deletedAt: null,
      OR: [
        { agentId: "agent-1" },
        {
          assignments: {
            some: {
              organizationId: "org-1",
              agentId: "agent-1",
              removedAt: null,
              role: { not: "OBSERVER" },
            },
          },
        },
      ],
    })
    const horizon = mobileSyncV2RouteHorizon("Asia/Baku", new Date("2026-08-28T12:00:00.000Z"))
    expect(horizon.key).toBe(`${MTM_MOBILE_SYNC_V2_ROUTE_HORIZON_POLICY_VERSION}:Asia/Baku:2026-08-28`)
    expect(horizon.from.toISOString()).toBe("2026-08-27T20:00:00.000Z")
    expect(horizon.until.toISOString()).toBe("2026-09-03T20:00:00.000Z")
  })

  it("changes the horizon fence when tenant timezone changes within the same local day", () => {
    const now = new Date("2026-08-28T12:00:00.000Z")
    expect(mobileSyncV2RouteHorizon("Asia/Baku", now).key)
      .not.toBe(mobileSyncV2RouteHorizon("Europe/Moscow", now).key)
  })

  it("projects route execution data without notes, customer/contact PII or GPS", () => {
    const projection = projectMtmMobileSyncV2Route({
      id: "route-1",
      agentId: "agent-1",
      date: new Date("2026-08-28T00:00:00.000Z"),
      name: "Friday route",
      status: "PLANNED",
      version: 3,
      publishedVersion: 2,
      totalPoints: 1,
      visitedPoints: 0,
      updatedAt: new Date("2026-08-28T12:00:00.000Z"),
      assignments: [{ agentId: "agent-1", role: "PRIMARY", assignedAt: new Date("2026-08-28T08:00:00.000Z") }],
      points: [{
        id: "point-1",
        customerId: "customer-1",
        contactId: "contact-1",
        orderIndex: 1,
        status: "PENDING",
        plannedTime: null,
        visitedAt: null,
      }],
    })

    expect(projection).toMatchObject({ id: "route-1", points: [{ id: "point-1", customerId: "customer-1" }] })
    expect(projection).not.toHaveProperty("notes")
    expect(JSON.stringify(projection)).not.toContain("latitude")
    expect(JSON.stringify(projection)).not.toContain("longitude")
  })

  it("keeps active visit/task/workday horizons and projections independently PII/GPS/media-free", () => {
    expect(mobileSyncV2ActiveVisitHorizon().key).toBe("active-visits:v1")
    expect(mobileSyncV2ActiveTaskHorizon().key).toBe("active-tasks:v1")
    expect(mobileSyncV2ActiveVisitWhere("org-1", "agent-1")).toEqual({
      organizationId: "org-1",
      deletedAt: null,
      status: "CHECKED_IN",
      agentId: "agent-1",
    })
    expect(mobileSyncV2ActiveTaskWhere("org-1", "agent-1")).toEqual({
      organizationId: "org-1",
      agentId: "agent-1",
      deletedAt: null,
      status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
    })
    expect(mobileSyncV2WorkdayHorizon().key).toBe("active-workdays:v1")
    expect(mobileSyncV2WorkdayWhere({ organizationId: "org-1", agentId: "agent-1" })).toEqual({
      organizationId: "org-1",
      agentId: "agent-1",
      status: { in: ["STARTED", "PAUSED"] },
    })

    const visit = projectMtmMobileSyncV2Visit({
      id: "visit-1",
      routeId: "route-1",
      routePointId: "point-1",
      status: "CHECKED_IN",
      checkInAt: new Date("2026-08-29T08:00:00.000Z"),
      checkOutAt: null,
      duration: null,
      outcome: null,
      potential: "HIGH",
      nextActionDueAt: null,
      updatedAt: new Date("2026-08-29T08:10:00.000Z"),
    })
    const task = projectMtmMobileSyncV2Task({
      id: "task-1",
      visitId: "visit-1",
      status: "PENDING",
      priority: "HIGH",
      scheduledStartAt: null,
      dueDate: null,
      completedAt: null,
      progress: null,
      version: 1,
      acceptedAt: null,
      startedAt: null,
      updatedAt: new Date("2026-08-29T08:10:00.000Z"),
    })
    const workday = projectMtmMobileSyncV2Workday({
      id: "workday-1",
      workDate: new Date("2026-08-29T00:00:00.000Z"),
      status: "PAUSED",
      startedAt: new Date("2026-08-29T05:00:00.000Z"),
      pausedAt: new Date("2026-08-29T08:00:00.000Z"),
      completedAt: null,
      totalPausedSeconds: 120,
      updatedAt: new Date("2026-08-29T08:10:00.000Z"),
    })

    expect(JSON.stringify(visit)).not.toMatch(/customer|contact|latitude|longitude|notes|media/i)
    expect(JSON.stringify(task)).not.toMatch(/title|description|result|reason|media/i)
    expect(JSON.stringify(workday)).not.toMatch(/latitude|longitude|note|event|media/i)
    expect(task.id).toBe("task-1")
    expect(MTM_MOBILE_SYNC_V2_TASK_STREAM).toBe("tasks")
    expect(MTM_MOBILE_SYNC_V2_WORKFORCE_STREAM).toBe("workforce")
  })
})
