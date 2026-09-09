/* eslint-disable @typescript-eslint/no-explicit-any */
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
vi.mock("@/lib/mtm/mobile-sync-v2-rate-guard", () => ({
  consumeMtmMobileSyncV2RateLimit: vi.fn(async () => ({
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
  })),
}))

import { GET as getVisits } from "@/app/api/v2/mtm/mobile/sync/visits/route"
import { GET as getTasks } from "@/app/api/v2/mtm/mobile/sync/tasks/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { consumeMtmMobileSyncV2RateLimit } from "@/lib/mtm/mobile-sync-v2-rate-guard"
import {
  mobileSyncV2ActiveVisitHorizon,
  MTM_MOBILE_SYNC_V2_TASK_STREAM,
  MTM_MOBILE_SYNC_V2_VISIT_STREAM,
  nextMobileSyncV2DeltaCursor,
  nextMobileSyncV2SnapshotCursor,
} from "@/lib/mtm/mobile-sync-v2"

const ORG = "org-1"
const AGENT = "agent-1"
const DEVICE = "device-1"

const auth = () => ({
  orgId: ORG,
  agentId: AGENT,
  userId: "user-1",
  email: "agent@example.test",
  name: "Agent",
  role: "AGENT",
  tenantCapabilities: { routeField: true, workforceHrm: false },
})

function request(stream: "visits" | "tasks", query = "", deviceId = DEVICE) {
  return new NextRequest(`http://localhost:3000/api/v2/mtm/mobile/sync/${stream}${query}`, {
    headers: {
      Authorization: "Bearer valid-token",
      ...(deviceId ? { "x-field-device-id": deviceId } : {}),
    },
  })
}

function visit(id: string) {
  return {
    id,
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
    // Hidden fields make accidental projection expansion observable.
    customerId: "customer-private",
    contactId: "contact-private",
    checkInLat: 40.4093,
    checkInLng: 49.8671,
    notes: "private visit note",
  }
}

function task(id: string) {
  return {
    id,
    visitId: "visit-1",
    status: "IN_PROGRESS",
    priority: "HIGH",
    scheduledStartAt: new Date("2026-08-29T07:00:00.000Z"),
    dueDate: new Date("2026-08-29T12:00:00.000Z"),
    completedAt: null,
    progress: 50,
    version: 3,
    acceptedAt: new Date("2026-08-29T07:05:00.000Z"),
    startedAt: new Date("2026-08-29T07:10:00.000Z"),
    updatedAt: new Date("2026-08-29T08:10:00.000Z"),
    // Hidden fields make accidental projection expansion observable.
    title: "private customer task",
    description: "private task description",
    result: "private task result",
    returnReason: "private task reason",
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(consumeMtmMobileSyncV2RateLimit).mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
  })
  vi.mocked(resolveMobileAuth).mockResolvedValue(auth() as any)
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({
    id: ORG,
    plan: "enterprise",
    addons: [],
    features: ["mtm"],
    modules: { mtm: true },
  } as never)
  vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({ id: "cohort-1" } as never)
  vi.mocked(prisma.mtmMobileSyncStream.findUnique).mockResolvedValue({ revision: 0n, retentionFloorRevision: 0n } as never)
  vi.mocked(prisma.mtmMobileSyncSnapshot.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmMobileSyncSnapshot.create).mockResolvedValue({ id: "snapshot-1" } as never)
  vi.mocked(prisma.mtmMobileSyncSnapshotItem.createMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.mtmMobileSyncSnapshotItem.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmMobileSyncChange.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ scopeRevision: 0n, leaseToken: "claimed" }] as never)
})

describe("v2 active visits/tasks read-only pilots", () => {
  it("requires an exact per-stream cohort before touching generic stream state", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue(null)

    const response = await getVisits(request("visits"))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MOBILE_SYNC_V2_COHORT_DISABLED" })
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("keeps visits unavailable independently when its shared v2 guard is down", async () => {
    vi.mocked(consumeMtmMobileSyncV2RateLimit).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 1,
      unavailable: true,
    })

    const response = await getVisits(request("visits", "?limit=1", "device-guard-unavailable"))

    expect(response.status).toBe(503)
    expect(response.headers.get("Retry-After")).toBe("5")
    expect(await response.json()).toEqual({
      error: "Sync protection is temporarily unavailable",
      code: "MOBILE_SYNC_V2_UNAVAILABLE",
    })
    expect(consumeMtmMobileSyncV2RateLimit).toHaveBeenCalledWith(expect.objectContaining({
      stream: "visits",
      phase: "pull",
      deviceId: "device-guard-unavailable",
    }))
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("materialises a stable PII/GPS/media-free active visit projection", async () => {
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValueOnce([visit("visit-1")] as never)

    const response = await getVisits(request("visits", "?limit=1"))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({ stream: "visits", complete: true, items: [expect.objectContaining({ id: "visit-1" })] })
    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain("customer-private")
    expect(serialized).not.toContain("contact-private")
    expect(serialized).not.toContain("private visit note")
    expect(serialized).not.toContain("40.4093")
    expect(prisma.mtmVisit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: ORG, agentId: AGENT, status: "CHECKED_IN" }),
    }))
  })

  it("materialises a PII/media-free active task projection with an independent stream", async () => {
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValueOnce([task("task-1")] as never)

    const response = await getTasks(request("tasks", "?limit=1"))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({ stream: "tasks", complete: true, items: [expect.objectContaining({ id: "task-1" })] })
    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain("private customer task")
    expect(serialized).not.toContain("private task description")
    expect(serialized).not.toContain("private task result")
    expect(prisma.mtmTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: ORG, agentId: AGENT, status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] } }),
    }))
  })

  it("uses snapshot page cursors without committing a delta cursor early", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => visit(`visit-${index}`))
    vi.mocked(prisma.mtmVisit.findMany)
      .mockResolvedValueOnce(rows.slice(0, 250) as never)
      .mockResolvedValueOnce(rows.slice(250, 500) as never)
      .mockResolvedValueOnce(rows.slice(500) as never)

    const json = await (await getVisits(request("visits", "?limit=500", "device-visits-501"))).json()

    expect(json).toMatchObject({ stream: "visits", complete: false, nextCursor: null })
    expect(json.items).toHaveLength(500)
    expect(json.nextPage).toMatch(/^v1:/)
  })

  it("returns a targeted tombstone and leaves another stream cursor untouched", async () => {
    vi.mocked(prisma.mtmMobileSyncStream.findUnique).mockResolvedValue({ revision: 3n, retentionFloorRevision: 0n } as never)
    vi.mocked(prisma.mtmMobileSyncChange.findMany).mockResolvedValue([{
      revision: 2n,
      changeType: "TOMBSTONE",
      entityType: "task-event-unreviewed",
      entityId: "must-not-cross-contract",
      audienceAgentId: AGENT,
      tombstoneReason: "UNRELATED",
    }, {
      revision: 3n,
      changeType: "TOMBSTONE",
      entityType: "task",
      entityId: "task-removed",
      audienceAgentId: AGENT,
      tombstoneReason: "SCOPE_REMOVED",
    }] as never)
    const cursor = nextMobileSyncV2DeltaCursor({
      context: { organizationId: ORG, agentId: AGENT, deviceId: DEVICE, stream: MTM_MOBILE_SYNC_V2_TASK_STREAM },
      revision: 0n,
      scopeRevision: 0n,
      horizonKey: "active-tasks:v1",
    })

    const response = await getTasks(request("tasks", `?cursor=${encodeURIComponent(cursor)}`))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      stream: "tasks",
      tombstones: [{ id: "task-removed", reason: "SCOPE_REMOVED", revision: "3" }],
      complete: true,
    })
    expect(JSON.stringify(json)).not.toContain("must-not-cross-contract")
    expect(prisma.mtmMobileSyncChange.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stream: MTM_MOBILE_SYNC_V2_TASK_STREAM, audienceAgentId: AGENT }),
    }))
  })

  it("rejects a cursor from another v2 stream before reading a snapshot", async () => {
    const cursor = nextMobileSyncV2SnapshotCursor({
      context: { organizationId: ORG, agentId: AGENT, deviceId: DEVICE, stream: MTM_MOBILE_SYNC_V2_VISIT_STREAM },
      snapshotId: "visit-snapshot",
      ordinal: 1,
      scopeRevision: 0n,
      horizonKey: mobileSyncV2ActiveVisitHorizon().key,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const response = await getTasks(request("tasks", `?cursor=${encodeURIComponent(cursor)}`))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MOBILE_SYNC_V2_CURSOR_INVALID" })
    expect(prisma.mtmMobileSyncSnapshotItem.findMany).not.toHaveBeenCalled()
  })
})
