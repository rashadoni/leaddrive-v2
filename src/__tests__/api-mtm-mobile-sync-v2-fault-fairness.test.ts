import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/mtm/mobile-sync-v2-rate-guard", () => ({ consumeMtmMobileSyncV2RateLimit: vi.fn() }))

import { GET as routes } from "@/app/api/v2/mtm/mobile/sync/routes/route"
import { GET as workforce } from "@/app/api/v2/mtm/mobile/sync/workforce/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { consumeMtmMobileSyncV2RateLimit } from "@/lib/mtm/mobile-sync-v2-rate-guard"
import { mobileSyncV2RouteHorizon, mobileSyncV2WorkdayHorizon, nextMobileSyncV2DeltaCursor, readMobileSyncV2Cursor } from "@/lib/mtm/mobile-sync-v2"

type Stream = "routes" | "workforce"
const streams: Stream[] = ["routes", "workforce"]
const handlers = { routes, workforce }
const allowed = { allowed: true, retryAfterSeconds: 0, unavailable: false }
const denied = { allowed: false, retryAfterSeconds: 17, unavailable: false }
const unavailable = { allowed: false, retryAfterSeconds: 1, unavailable: true }
const context = (stream: Stream) => ({ organizationId: "org-fault", agentId: "agent-fault", deviceId: "device-fault", stream })
const auth = (routeField = true, workforceHrm = true) => ({ orgId: "org-fault", agentId: "agent-fault", userId: "user-fault", role: "AGENT", tenantCapabilities: { routeField, workforceHrm } })
function cursor(stream: Stream, revision = 0) {
  return nextMobileSyncV2DeltaCursor({ context: context(stream), revision: BigInt(revision), scopeRevision: BigInt(0),
    horizonKey: stream === "routes" ? mobileSyncV2RouteHorizon("Asia/Baku").key : mobileSyncV2WorkdayHorizon().key })
}
function request(stream: Stream, token = cursor(stream), limit = 1) {
  return new NextRequest(`http://localhost/api/v2/mtm/mobile/sync/${stream}?cursor=${encodeURIComponent(token)}&limit=${limit}`, {
    headers: { Authorization: "Bearer synthetic-token", "x-field-device-id": "device-fault" },
  })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(auth() as never)
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-fault", plan: "enterprise", addons: [], features: [], modules: { mtm: true, "workforce-hrm": true } } as never)
  vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({ id: "cohort" } as never)
  vi.mocked(prisma.mtmMobileSyncStream.findUnique).mockImplementation(async (args: { where: { organizationId_stream: { stream: string } } }) => ({ revision: BigInt(args.where.organizationId_stream.stream === "routes" ? 7 : 13), retentionFloorRevision: BigInt(0) }) as never)
  vi.mocked(prisma.mtmMobileSyncChange.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ scopeRevision: BigInt(0), leaseToken: "claimed" }] as never)
  vi.mocked(consumeMtmMobileSyncV2RateLimit).mockResolvedValue(allowed)
})
afterEach(() => vi.restoreAllMocks())

describe("F1–F3 bounded stream faults with actual cursor sealing and handlers", () => {
  it.each(streams)("a pending %s protection dependency does not stall the other stream", async blocked => {
    const entered = deferred<void>()
    const gate = deferred<typeof allowed>()
    const healthy = blocked === "routes" ? "workforce" : "routes"
    vi.mocked(consumeMtmMobileSyncV2RateLimit).mockImplementation(async input => {
      if (input.stream !== blocked) return allowed
      entered.resolve()
      return gate.promise
    })
    let blockedSettled = false
    const pending = handlers[blocked](request(blocked)).then(response => { blockedSettled = true; return response })
    await entered.promise
    try {
      const response = await handlers[healthy](request(healthy))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ stream: healthy, complete: true })
      expect(blockedSettled).toBe(false)
    } finally { gate.resolve(unavailable) }
    expect((await pending).status).toBe(503)
  })

  it.each(streams)("%s 503/429 bursts do not advance either cursor before a successful retry", async blocked => {
    const healthy = blocked === "routes" ? "workforce" : "routes"
    const original = cursor(blocked, 2)
    const other = cursor(healthy, 3)
    for (const failure of [unavailable, unavailable, denied, denied]) {
      vi.mocked(consumeMtmMobileSyncV2RateLimit).mockImplementation(async input => input.stream === blocked ? failure : allowed)
      vi.mocked(prisma.mtmMobileSyncChange.findMany).mockClear()
      const response = await handlers[blocked](request(blocked, original))
      expect(response.status).toBe(failure.unavailable ? 503 : 429)
      expect(Number(response.headers.get("Retry-After"))).toBe(failure.unavailable ? 5 : 17)
      expect(await response.json()).not.toHaveProperty("nextCursor")
      expect(prisma.mtmMobileSyncChange.findMany).not.toHaveBeenCalled()
      expect(readMobileSyncV2Cursor(original, context(blocked))).toMatchObject({ revision: "2" })
      const healthyResponse = await handlers[healthy](request(healthy, other))
      expect(healthyResponse.status).toBe(200)
      const body = await healthyResponse.json()
      expect(readMobileSyncV2Cursor(body.nextCursor, context(healthy))).toMatchObject({ revision: healthy === "routes" ? "7" : "13" })
    }
    vi.mocked(consumeMtmMobileSyncV2RateLimit).mockResolvedValue(allowed)
    const recovered = await handlers[blocked](request(blocked, original))
    expect(recovered.status).toBe(200)
    expect(readMobileSyncV2Cursor((await recovered.json()).nextCursor, context(blocked))).toMatchObject({ revision: blocked === "routes" ? "7" : "13" })
    expect(readMobileSyncV2Cursor(other, context(healthy))).toMatchObject({ revision: "3" })
  })

  it.each(streams)("rejects the other stream's genuine cursor at %s before reading stream state", async stream => {
    const other = stream === "routes" ? "workforce" : "routes"
    const response = await handlers[stream](request(stream, cursor(other)))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MOBILE_SYNC_V2_CURSOR_INVALID" })
    expect(prisma.mtmMobileSyncStream.findUnique).not.toHaveBeenCalled()
    expect(prisma.mtmMobileSyncChange.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmMobileSyncSnapshotItem.findMany).not.toHaveBeenCalled()
  })
})

describe("F6 serialized page bound and recovery", () => {
  it("retries the same Workforce cursor with a smaller page, then advances only through returned workdays", async () => {
    const ids = [1, 2].map(i => `workday-${i}-${"x".repeat(300_000)}`)
    const changes = ids.map((entityId, i) => ({ revision: BigInt(i + 1), changeType: "UPSERT", entityType: "workday", entityId, audienceAgentId: "agent-fault", tombstoneReason: null }))
    vi.mocked(prisma.mtmMobileSyncStream.findUnique).mockResolvedValue({ revision: BigInt(2), retentionFloorRevision: BigInt(0) } as never)
    vi.mocked(prisma.mtmMobileSyncChange.findMany).mockImplementation(async (args: { where?: { revision?: { gt: bigint } }; take?: number }) => changes.filter(c => c.revision > BigInt(args.where?.revision?.gt ?? 0)).slice(0, args.take ?? 3) as never)
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockImplementation(async (args: { where: { id: { in: string[] } } }) => ids.filter(id => args.where.id.in.includes(id)).map(id => ({ id, workDate: new Date("2026-10-06"), status: "STARTED", startedAt: new Date("2026-10-06T08:00:00Z"), pausedAt: null, completedAt: null, totalPausedSeconds: 0, updatedAt: new Date("2026-10-06T08:00:00Z"), events: [{ note: "PRIVATE-F6-NOTE" }] })) as never)
    const original = cursor("workforce")
    const response = await workforce(request("workforce", original, 2))
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: "Sync page is too large; retry with a smaller limit", code: "MOBILE_SYNC_V2_PAYLOAD_TOO_LARGE", recommendedPageSize: 100 })
    expect(readMobileSyncV2Cursor(original, context("workforce"))).toMatchObject({ revision: "0" })
    const first = await workforce(request("workforce", original, 1))
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody.items).toHaveLength(1)
    expect(firstBody.complete).toBe(false)
    expect(JSON.stringify(firstBody)).not.toContain("PRIVATE-F6-NOTE")
    expect(readMobileSyncV2Cursor(firstBody.nextCursor, context("workforce"))).toMatchObject({ revision: "1" })
    const last = await workforce(request("workforce", firstBody.nextCursor, 1))
    expect(last.status).toBe(200)
    const lastBody = await last.json()
    expect(lastBody.items).toHaveLength(1)
    expect(lastBody.complete).toBe(true)
    expect(readMobileSyncV2Cursor(lastBody.nextCursor, context("workforce"))).toMatchObject({ revision: "2" })
  })
})

describe("F8 four entitlement modes under a failing dependency", () => {
  it.each([[false, false], [false, true], [true, false], [true, true]])("Routes=%s HRM=%s deny absent capabilities before guard calls", async (routeField, workforceHrm) => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(auth(routeField, workforceHrm) as never)
    vi.mocked(consumeMtmMobileSyncV2RateLimit).mockResolvedValue(unavailable)
    for (const stream of streams) {
      vi.mocked(consumeMtmMobileSyncV2RateLimit).mockClear()
      const entitled = stream === "routes" ? routeField : workforceHrm
      const response = await handlers[stream](request(stream))
      expect(response.status).toBe(entitled ? 503 : 403)
      expect(consumeMtmMobileSyncV2RateLimit).toHaveBeenCalledTimes(entitled ? 1 : 0)
      expect(prisma.mtmMobileSyncChange.findMany).not.toHaveBeenCalled()
    }
  })
})
