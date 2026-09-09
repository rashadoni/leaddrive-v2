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

import { GET } from "@/app/api/v2/mtm/mobile/sync/workforce/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { consumeMtmMobileSyncV2RateLimit } from "@/lib/mtm/mobile-sync-v2-rate-guard"
import {
  MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
  MTM_MOBILE_SYNC_V2_WORKFORCE_STREAM,
  mobileSyncV2WorkdayHorizon,
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
  tenantCapabilities: { routeField: false, workforceHrm: true },
})

function request(query = "", deviceId = DEVICE) {
  return new NextRequest(`http://localhost:3000/api/v2/mtm/mobile/sync/workforce${query}`, {
    headers: {
      Authorization: "Bearer valid-token",
      ...(deviceId ? { "x-field-device-id": deviceId } : {}),
    },
  })
}

function workday(id: string) {
  return {
    id,
    workDate: new Date("2026-08-29T00:00:00.000Z"),
    status: "PAUSED",
    startedAt: new Date("2026-08-29T05:00:00.000Z"),
    pausedAt: new Date("2026-08-29T08:00:00.000Z"),
    completedAt: null,
    totalPausedSeconds: 120,
    updatedAt: new Date("2026-08-29T08:10:00.000Z"),
    // Hidden fields make an accidental GPS/event projection expansion visible.
    startLatitude: 40.4093,
    startLongitude: 49.8671,
    endLatitude: null,
    endLongitude: null,
    events: [{ note: "private workday note", latitude: 40.4093 }],
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
  vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ scopeRevision: 0n, leaseToken: "claimed" }] as never)
})

describe("v2 workforce active-workday read-only pilot", () => {
  it("requires its own exact workforce cohort before touching generic state", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MOBILE_SYNC_V2_COHORT_DISABLED" })
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("does not substitute a route cohort or route-field entitlement for workforce", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...auth(),
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as any)

    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(prisma.mtmMobileSyncCohort.findFirst).not.toHaveBeenCalled()
  })

  it("materialises only the authenticated agent's active workday without GPS or notes", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValueOnce([workday("workday-1")] as never)

    const response = await GET(request("?limit=1"))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({ stream: "workforce", complete: true, items: [expect.objectContaining({ id: "workday-1" })] })
    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain("40.4093")
    expect(serialized).not.toContain("private workday note")
    expect(prisma.mtmAgentWorkday.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        agentId: AGENT,
        status: { in: ["STARTED", "PAUSED"] },
      }),
    }))
  })

  it("returns a workday tombstone without exposing an unreviewed workforce entity", async () => {
    vi.mocked(prisma.mtmMobileSyncStream.findUnique).mockResolvedValue({ revision: 3n, retentionFloorRevision: 0n } as never)
    vi.mocked(prisma.mtmMobileSyncChange.findMany).mockResolvedValue([{
      revision: 2n,
      changeType: "TOMBSTONE",
      entityType: "hrm-request-unreviewed",
      entityId: "must-not-cross-contract",
      audienceAgentId: AGENT,
      tombstoneReason: "UNRELATED",
    }, {
      revision: 3n,
      changeType: "TOMBSTONE",
      entityType: "workday",
      entityId: "workday-closed",
      audienceAgentId: AGENT,
      tombstoneReason: "ACTIVE_STATE_EXIT",
    }] as never)
    const cursor = nextMobileSyncV2DeltaCursor({
      context: { organizationId: ORG, agentId: AGENT, deviceId: DEVICE, stream: MTM_MOBILE_SYNC_V2_WORKFORCE_STREAM },
      revision: 0n,
      scopeRevision: 0n,
      horizonKey: mobileSyncV2WorkdayHorizon().key,
    })

    const response = await GET(request(`?cursor=${encodeURIComponent(cursor)}`))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      stream: "workforce",
      tombstones: [{ id: "workday-closed", reason: "ACTIVE_STATE_EXIT", revision: "3" }],
      complete: true,
    })
    expect(JSON.stringify(json)).not.toContain("must-not-cross-contract")
    expect(prisma.mtmMobileSyncChange.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stream: MTM_MOBILE_SYNC_V2_WORKFORCE_STREAM, audienceAgentId: AGENT }),
    }))
  })

  it("rejects a cursor from another v2 stream before reading a workday snapshot", async () => {
    const cursor = nextMobileSyncV2SnapshotCursor({
      context: { organizationId: ORG, agentId: AGENT, deviceId: DEVICE, stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM },
      snapshotId: "route-snapshot",
      ordinal: 1,
      scopeRevision: 0n,
      horizonKey: "route-horizon",
      expiresAt: new Date(Date.now() + 60_000),
    })

    const response = await GET(request(`?cursor=${encodeURIComponent(cursor)}`))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MOBILE_SYNC_V2_CURSOR_INVALID" })
    expect(prisma.mtmMobileSyncSnapshotItem.findMany).not.toHaveBeenCalled()
  })
})
