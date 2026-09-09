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

import { GET } from "@/app/api/v2/mtm/mobile/sync/routes/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { consumeMtmMobileSyncV2RateLimit } from "@/lib/mtm/mobile-sync-v2-rate-guard"
import {
  MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
  mobileSyncV2RouteHorizon,
  nextMobileSyncV2SnapshotCursor,
  nextMobileSyncV2DeltaCursor,
  readMobileSyncV2Cursor,
} from "@/lib/mtm/mobile-sync-v2"

const ORG = "org-1"
const AGENT = "agent-1"
const DEVICE = "device-1"
const auth = (overrides: Record<string, unknown> = {}) => ({
  orgId: ORG,
  agentId: AGENT,
  userId: "user-1",
  email: "agent@example.test",
  name: "Agent",
  role: "AGENT",
  tenantCapabilities: { routeField: true, workforceHrm: false },
  ...overrides,
})

const streamState = (overrides: Record<string, unknown> = {}) => ({
  revision: 0n,
  retentionFloorRevision: 0n,
  ...overrides,
})

const agentScope = (scopeRevision = 0n) => ({ scopeRevision })

function route(id: string, ordinal = 0) {
  return {
    id,
    agentId: AGENT,
    date: new Date(Date.UTC(2026, 7, 28 + Math.floor(ordinal / 1_000))),
    name: `Route ${ordinal}`,
    status: "PLANNED",
    version: 1,
    publishedVersion: null,
    totalPoints: 1,
    visitedPoints: 0,
    updatedAt: new Date("2026-08-28T12:00:00.000Z"),
    assignments: [{ agentId: AGENT, role: "PRIMARY", assignedAt: new Date("2026-08-28T08:00:00.000Z") }],
    points: [{
      id: `point-${id}`,
      customerId: `customer-${id}`,
      contactId: null,
      orderIndex: 1,
      status: "PENDING",
      plannedTime: null,
      visitedAt: null,
    }],
    // The actual Prisma select does not expose this. Keeping it in the mock
    // proves the public projection does not accidentally echo arbitrary route
    // fields such as notes.
    notes: "private route note",
  }
}

function request(query = "", deviceId = DEVICE) {
  return new NextRequest(`http://localhost:3000/api/v2/mtm/mobile/sync/routes${query}`, {
    headers: {
      Authorization: "Bearer valid-token",
      ...(deviceId ? { "x-field-device-id": deviceId } : {}),
    },
  })
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
  vi.mocked(prisma.mtmMobileSyncStream.findUnique).mockResolvedValue(streamState() as never)
  vi.mocked(prisma.mtmMobileSyncSnapshot.create).mockResolvedValue({ id: "snapshot-1" } as never)
  vi.mocked(prisma.mtmMobileSyncSnapshot.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmMobileSyncSnapshotItem.createMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.mtmMobileSyncSnapshotItem.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmMobileSyncChange.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  // Initial requests first claim a durable lease and then lock the actor scope
  // in the repeatable-read transaction. The shared raw mock supplies the
  // values each query needs without pretending an advisory lock exists.
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ ...agentScope(), leaseToken: "claimed" }] as never)
})

describe("GET /api/v2/mtm/mobile/sync/routes", () => {
  it("requires the Route Field capability before it reads the v2 cohort", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(auth({
      tenantCapabilities: { routeField: false, workforceHrm: true },
    }) as any)

    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "TENANT_CAPABILITY_DISABLED", capabilityId: "route-field" })
    expect(prisma.mtmMobileSyncCohort.findFirst).not.toHaveBeenCalled()
  })

  it("requires an exact server-side device cohort before any stream state is created", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MOBILE_SYNC_V2_COHORT_DISABLED" })
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("requires a safe device header", async () => {
    const response = await GET(request("", ""))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MOBILE_SYNC_V2_DEVICE_REQUIRED" })
  })

  it("returns a stream-local 429 when the shared device/tenant guard rejects", async () => {
    vi.mocked(consumeMtmMobileSyncV2RateLimit).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 17,
      unavailable: false,
    })

    const response = await GET(request("?limit=1", "device-over-limit"))

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("17")
    expect(await response.json()).toMatchObject({ code: "MOBILE_SYNC_V2_RATE_LIMITED" })
    expect(consumeMtmMobileSyncV2RateLimit).toHaveBeenCalledWith({
      stream: "routes",
      phase: "pull",
      organizationId: ORG,
      agentId: AGENT,
      userId: "user-1",
      deviceId: "device-over-limit",
    })
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("fails the optional v2 pull closed when the shared guard is unavailable", async () => {
    vi.mocked(consumeMtmMobileSyncV2RateLimit).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 1,
      unavailable: true,
    })

    const response = await GET(request("?limit=1", "device-guard-unavailable"))

    expect(response.status).toBe(503)
    expect(response.headers.get("Retry-After")).toBe("5")
    expect(await response.json()).toEqual({
      error: "Route sync protection is temporarily unavailable",
      code: "MOBILE_SYNC_V2_UNAVAILABLE",
    })
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("fails an initial snapshot closed before it writes a cache when its shared guard is unavailable", async () => {
    vi.mocked(consumeMtmMobileSyncV2RateLimit)
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, unavailable: false })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 1, unavailable: true })

    const response = await GET(request("?limit=1", "device-initial-guard-unavailable"))

    expect(response.status).toBe(503)
    expect(response.headers.get("Retry-After")).toBe("5")
    expect(await response.json()).toEqual({
      error: "Route sync protection is temporarily unavailable",
      code: "MOBILE_SYNC_V2_UNAVAILABLE",
    })
    expect(consumeMtmMobileSyncV2RateLimit).toHaveBeenLastCalledWith(expect.objectContaining({
      stream: "routes",
      phase: "initial-snapshot",
      deviceId: "device-initial-guard-unavailable",
    }))
    expect(prisma.mtmMobileSyncSnapshot.create).not.toHaveBeenCalled()
  })

  it("returns a bounded Retry-After envelope when a route sync dependency is unavailable", async () => {
    vi.mocked(prisma.$executeRaw).mockRejectedValueOnce(new Error("stream anchor unavailable"))

    const response = await GET(request("?limit=1", "device-unavailable"))

    expect(response.status).toBe(503)
    expect(response.headers.get("Retry-After")).toBe("5")
    const json = await response.json()
    expect(json).toEqual({
      error: "Route sync is temporarily unavailable",
      code: "MOBILE_SYNC_V2_UNAVAILABLE",
    })
    expect(json).not.toHaveProperty("cursor")
    expect(json).not.toHaveProperty("nextCursor")
    expect(prisma.mtmMobileSyncSnapshot.create).not.toHaveBeenCalled()
  })

  it("returns a complete stable initial snapshot for 0, 1 and exactly 500 rows", async () => {
    const empty = await GET(request("?limit=500"))
    expect((await empty.json())).toMatchObject({ complete: true, items: [], tombstones: [] })

    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValueOnce([route("route-1")] as never)
    const one = await GET(request("?limit=500"))
    const oneJson = await one.json()
    expect(oneJson).toMatchObject({ complete: true, items: [expect.objectContaining({ id: "route-1" })] })
    expect(JSON.stringify(oneJson)).not.toContain("private route note")

    const rows = Array.from({ length: 500 }, (_, index) => route(`route-${index}`, index))
    vi.mocked(prisma.mtmRoute.findMany)
      .mockResolvedValueOnce(rows.slice(0, 250) as never)
      .mockResolvedValueOnce(rows.slice(250) as never)
    const fiveHundred = await GET(request("?limit=500"))
    const fiveHundredJson = await fiveHundred.json()
    expect(fiveHundredJson.items).toHaveLength(500)
    expect(fiveHundredJson.complete).toBe(true)
    expect(fiveHundredJson.nextPage).toBeNull()
  })

  it("anchors a new stream with raw no-op inserts instead of polling upserts", async () => {
    const response = await GET(request("?limit=1", "device-anchor"))

    expect(response.status).toBe(200)
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2)
    expect(prisma.mtmMobileSyncStream.upsert).not.toHaveBeenCalled()
    expect(prisma.mtmMobileSyncAgentScope.upsert).not.toHaveBeenCalled()
    const statements = vi.mocked(prisma.$executeRaw).mock.calls.map((call) => String(call[0]))
    expect(statements.join("\n")).toContain('ON CONFLICT ("organizationId", "stream") DO NOTHING')
    expect(statements.join("\n")).toContain('ON CONFLICT ("organizationId", "stream", "agentId") DO NOTHING')
  })

  it("returns a snapshot page token but no committed delta cursor for 501 rows", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => route(`route-${index}`, index))
    vi.mocked(prisma.mtmRoute.findMany)
      .mockResolvedValueOnce(rows.slice(0, 250) as never)
      .mockResolvedValueOnce(rows.slice(250, 500) as never)
      .mockResolvedValueOnce(rows.slice(500) as never)

    const response = await GET(request("?limit=500", "device-501"))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.items).toHaveLength(500)
    expect(json.complete).toBe(false)
    expect(json.nextPage).toMatch(/^v1:/)
    expect(json.nextCursor).toBeNull()
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "RepeatableRead" }),
    )
    const guardOrder = vi.mocked(consumeMtmMobileSyncV2RateLimit).mock.invocationCallOrder
    const transactionOrder = vi.mocked(prisma.$transaction).mock.invocationCallOrder
    expect(guardOrder).toHaveLength(2)
    expect(transactionOrder).toHaveLength(2)
    // pull guard → short reusable preflight → initial guard → final RR build
    expect(guardOrder[1]).toBeGreaterThan(transactionOrder[0]!)
    expect(guardOrder[1]).toBeLessThan(transactionOrder[1]!)
  })

  it("reuses an active device snapshot while holding the initial-sync lease", async () => {
    const expiresAt = new Date(Date.now() + 60_000)
    vi.mocked(prisma.mtmMobileSyncSnapshot.findFirst).mockResolvedValue({
      id: "snapshot-reused",
      boundaryRevision: 7n,
      scopeRevision: 0n,
      expiresAt,
    } as never)
    vi.mocked(prisma.mtmMobileSyncSnapshotItem.findMany).mockResolvedValue([{
      payload: {
        id: "route-reused",
        agentId: AGENT,
        date: "2026-08-28T00:00:00.000Z",
        name: "Reused route",
        status: "PLANNED",
        version: 1,
        publishedVersion: null,
        totalPoints: 0,
        visitedPoints: 0,
        updatedAt: "2026-08-28T12:00:00.000Z",
        assignments: [],
        points: [],
      },
    }] as never)

    const response = await GET(request("?limit=500", "device-reused-snapshot"))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      snapshotId: "snapshot-reused",
      complete: true,
      items: [expect.objectContaining({ id: "route-reused" })],
    })
    expect(prisma.mtmMobileSyncSnapshot.create).not.toHaveBeenCalled()
    // The scope row and device/horizon lease both use the transaction's raw
    // lock connection; no-cursor retries cannot bypass this shared fence.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    expect(consumeMtmMobileSyncV2RateLimit).toHaveBeenCalledTimes(1)
  })

  it("returns Retry-After instead of creating a second snapshot while the device lease is held", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as never)

    const response = await GET(request("?limit=500", "device-lease-held"))

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("2")
    expect(await response.json()).toMatchObject({ code: "MOBILE_SYNC_V2_SNAPSHOT_LEASE_BUSY" })
    expect(prisma.mtmMobileSyncSnapshot.create).not.toHaveBeenCalled()
  })

  it("materialises a stable 10,000-row snapshot in bounded write chunks", async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => route(`route-${index}`, index))
    const routeFindMany = vi.mocked(prisma.mtmRoute.findMany)
    for (let offset = 0; offset < rows.length; offset += 250) {
      routeFindMany.mockResolvedValueOnce(rows.slice(offset, offset + 250) as never)
    }
    routeFindMany.mockResolvedValueOnce([] as never)

    const response = await GET(request("?limit=500", "device-10000"))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.items).toHaveLength(500)
    expect(json.complete).toBe(false)
    expect(json.nextPage).toMatch(/^v1:/)
    expect(prisma.mtmMobileSyncSnapshotItem.createMany).toHaveBeenCalledTimes(40)
  })

  it("finishes an existing snapshot with a boundary cursor only after its final page", async () => {
    const initialRows = Array.from({ length: 501 }, (_, index) => route(`route-${index}`, index))
    vi.mocked(prisma.mtmRoute.findMany)
      .mockResolvedValueOnce(initialRows.slice(0, 250) as never)
      .mockResolvedValueOnce(initialRows.slice(250, 500) as never)
      .mockResolvedValueOnce(initialRows.slice(500) as never)
    const initial = await (await GET(request("?limit=500", "device-snapshot-page"))).json()

    vi.mocked(prisma.mtmMobileSyncSnapshot.findFirst).mockResolvedValue({
      id: initial.snapshotId,
      boundaryRevision: 9n,
      scopeRevision: 0n,
      expiresAt: new Date(Date.now() + 60_000),
    } as never)
    vi.mocked(prisma.mtmMobileSyncSnapshotItem.findMany).mockResolvedValue([{
      ordinal: 501,
      payload: {
        id: "route-500",
        agentId: AGENT,
        date: "2026-08-28T00:00:00.000Z",
        name: "Route 500",
        status: "PLANNED",
        version: 1,
        publishedVersion: null,
        totalPoints: 1,
        visitedPoints: 0,
        updatedAt: "2026-08-28T12:00:00.000Z",
        assignments: [],
        points: [],
      },
    }] as never)

    const page = await GET(request(`?cursor=${encodeURIComponent(initial.nextPage)}`, "device-snapshot-page"))
    const json = await page.json()
    expect(json).toMatchObject({ complete: true, nextPage: null, items: [expect.objectContaining({ id: "route-500" })] })
    expect(json.nextCursor).toMatch(/^v1:/)
  })

  it("requires a resnapshot before serving a snapshot page after the actor loses scope", async () => {
    const revokedDevice = "device-scope-revoked"
    const horizonKey = mobileSyncV2RouteHorizon("Asia/Baku", new Date()).key
    const cursor = nextMobileSyncV2SnapshotCursor({
      context: {
        organizationId: ORG,
        agentId: AGENT,
        deviceId: revokedDevice,
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      },
      snapshotId: "snapshot-revoked",
      ordinal: 200,
      scopeRevision: 0n,
      horizonKey,
      expiresAt: new Date(Date.now() + 60_000),
    })
    // The membership trigger advances this row in the same transaction as the
    // revoke. The page reader locks and compares it before looking at immutable
    // snapshot items, so the old route projection cannot leak.
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ ...agentScope(1n), leaseToken: "claimed" }] as never)

    const response = await GET(request(`?cursor=${encodeURIComponent(cursor)}`, revokedDevice))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MOBILE_SYNC_V2_RESNAPSHOT_REQUIRED",
      reason: "SCOPE_CHANGED",
    })
    expect(prisma.mtmMobileSyncSnapshotItem.findMany).not.toHaveBeenCalled()
  })

  it("fails closed for a cursor borrowed from another tenant", async () => {
    const cursor = nextMobileSyncV2DeltaCursor({
      context: {
        organizationId: "org-foreign",
        agentId: AGENT,
        deviceId: DEVICE,
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      },
      revision: 0n,
      scopeRevision: 0n,
      horizonKey: "2026-08-28",
    })

    const response = await GET(request(`?cursor=${encodeURIComponent(cursor)}`))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MOBILE_SYNC_V2_CURSOR_INVALID" })
  })

  it("returns controlled resnapshot when tombstone retention has passed", async () => {
    const retained = streamState({
      revision: 10n,
      retentionFloorRevision: 5n,
    })
    vi.mocked(prisma.mtmMobileSyncStream.findUnique).mockResolvedValue(retained as never)
    const cursor = nextMobileSyncV2DeltaCursor({
      context: {
        organizationId: ORG,
        agentId: AGENT,
        deviceId: DEVICE,
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      },
      revision: 4n,
      scopeRevision: 0n,
      horizonKey: mobileSyncV2RouteHorizon("Asia/Baku", new Date()).key,
    })

    const response = await GET(request(`?cursor=${encodeURIComponent(cursor)}`))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MOBILE_SYNC_V2_RESNAPSHOT_REQUIRED",
      reason: "RETENTION_EXPIRED",
      resnapshotRequired: true,
    })
  })

  it("returns controlled resnapshot instead of moving a cursor backwards after a journal restore", async () => {
    const restored = streamState({ revision: 3n })
    vi.mocked(prisma.mtmMobileSyncStream.findUnique).mockResolvedValue(restored as never)
    const cursor = nextMobileSyncV2DeltaCursor({
      context: {
        organizationId: ORG,
        agentId: AGENT,
        deviceId: "device-restored-journal",
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      },
      revision: 4n,
      scopeRevision: 0n,
      horizonKey: mobileSyncV2RouteHorizon("Asia/Baku", new Date()).key,
    })

    const response = await GET(request(`?cursor=${encodeURIComponent(cursor)}`, "device-restored-journal"))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MOBILE_SYNC_V2_RESNAPSHOT_REQUIRED",
      reason: "STREAM_REWOUND",
    })
  })

  it("requires a rebuild when a same-day tenant timezone change alters the horizon fingerprint", async () => {
    const timezoneChangedDevice = "device-timezone-changed"
    const cursor = nextMobileSyncV2DeltaCursor({
      context: {
        organizationId: ORG,
        agentId: AGENT,
        deviceId: timezoneChangedDevice,
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      },
      revision: 0n,
      scopeRevision: 0n,
      // The server mock still resolves Asia/Baku; this is a valid old cursor
      // from a different timezone on the same calendar date.
      horizonKey: mobileSyncV2RouteHorizon("Europe/Moscow", new Date()).key,
    })

    const response = await GET(request(`?cursor=${encodeURIComponent(cursor)}`, timezoneChangedDevice))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MOBILE_SYNC_V2_RESNAPSHOT_REQUIRED",
      reason: "HORIZON_CHANGED",
    })
    expect(prisma.mtmMobileSyncChange.findMany).not.toHaveBeenCalled()
  })

  it("returns a targeted scope-loss tombstone and advances only the route stream cursor", async () => {
    const state = streamState({ revision: 1n })
    vi.mocked(prisma.mtmMobileSyncStream.findUnique).mockResolvedValue(state as never)
    vi.mocked(prisma.mtmMobileSyncChange.findMany).mockResolvedValue([{
      revision: 1n,
      changeType: "TOMBSTONE",
      entityType: "route",
      entityId: "route-removed",
      audienceAgentId: AGENT,
      tombstoneReason: "SCOPE_REMOVED",
    }] as never)
    const cursor = nextMobileSyncV2DeltaCursor({
      context: {
        organizationId: ORG,
        agentId: AGENT,
        deviceId: DEVICE,
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      },
      revision: 0n,
      scopeRevision: 0n,
      horizonKey: mobileSyncV2RouteHorizon("Asia/Baku", new Date()).key,
    })

    const response = await GET(request(`?cursor=${encodeURIComponent(cursor)}`))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      stream: "routes",
      tombstones: [{ id: "route-removed", reason: "SCOPE_REMOVED", revision: "1" }],
      complete: true,
    })
    expect(json.nextCursor).toMatch(/^v1:/)
    expect(prisma.mtmMobileSyncChange.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
        audienceAgentId: AGENT,
      }),
    }))
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "RepeatableRead" }),
    )
  })

  it("does not drain another actor's journal and skips irrelevant revisions at the sampled stream head", async () => {
    const isolatedDevice = "device-foreign-change"
    const state = streamState({ revision: 9n })
    vi.mocked(prisma.mtmMobileSyncStream.findUnique).mockResolvedValue(state as never)
    // The production predicate excludes this row. Returning a foreign actor
    // from the mock also pins the output-side defence: a maintenance
    // regression cannot leak another actor's route id or deletion reason.
    vi.mocked(prisma.mtmMobileSyncChange.findMany).mockResolvedValue([{
      revision: 8n,
      changeType: "TOMBSTONE",
      entityType: "route",
      entityId: "foreign-route",
      audienceAgentId: "other-agent",
      tombstoneReason: "DELETED",
    }] as never)
    const horizonKey = mobileSyncV2RouteHorizon("Asia/Baku", new Date()).key
    const cursor = nextMobileSyncV2DeltaCursor({
      context: {
        organizationId: ORG,
        agentId: AGENT,
        deviceId: isolatedDevice,
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      },
      revision: 7n,
      scopeRevision: 0n,
      horizonKey,
    })

    const response = await GET(request(`?cursor=${encodeURIComponent(cursor)}`, isolatedDevice))
    const json = await response.json()
    const next = readMobileSyncV2Cursor(json.nextCursor, {
      organizationId: ORG,
      agentId: AGENT,
      deviceId: isolatedDevice,
      stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
    })

    expect(response.status).toBe(200)
    expect(json.tombstones).toEqual([])
    expect(next).toMatchObject({ kind: "delta", revision: "9" })
    expect(prisma.mtmMobileSyncChange.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        revision: { gt: 7n, lte: 9n },
        audienceAgentId: AGENT,
      }),
    }))
  })
})
