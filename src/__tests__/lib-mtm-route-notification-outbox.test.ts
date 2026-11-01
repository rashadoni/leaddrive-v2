import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  logMtmRouteObservability: vi.fn(),
  notifyAgents: vi.fn(),
}))

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/tenant-capability-access", () => ({
  getTenantCapabilityAccess: vi.fn(),
}))
vi.mock("@/lib/mtm/route-observability", () => ({
  logMtmRouteObservability: deps.logMtmRouteObservability,
}))
vi.mock("@/lib/mtm/push-notify", () => ({
  MTM_TEAM_MESSAGES_PUSH_CHANNEL: "team-messages",
  notifyAgents: deps.notifyAgents,
}))

import { prisma } from "@/lib/prisma"
import { getTenantCapabilityAccess } from "@/lib/tenant-capability-access"
import {
  drainMtmRouteNotificationOutbox,
  enqueueMtmRouteNotification,
} from "@/lib/mtm/route-notification-outbox"

const NOW = new Date("2026-08-28T12:00:00.000Z")
const OUTBOX_ITEM = {
  id: "outbox-1",
  organizationId: "org-1",
  agentId: "agent-1",
  dedupeKey: "route-change-request:request-1:decision:agent-1",
  title: "Route change approved",
  body: "Approved",
  type: "info",
  metadata: { requestId: "request-1" },
  status: "PENDING",
  attempts: 0,
  availableAt: new Date("2026-08-28T11:59:00.000Z"),
  leaseToken: null,
  leaseUntil: null,
  lastError: null,
  deliveredAt: null,
  suppressedAt: null,
  createdAt: new Date("2026-08-28T11:58:00.000Z"),
  updatedAt: new Date("2026-08-28T11:58:00.000Z"),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTenantCapabilityAccess).mockResolvedValue({ allowed: true, capability: null })
  vi.mocked(prisma.mtmRouteNotificationOutbox.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRouteNotificationOutbox.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.mtmNotification.upsert).mockResolvedValue({ id: "notification-1" })
  deps.notifyAgents.mockResolvedValue({ sent: 1, failed: 0, retired: 0 })
})

describe("MTM route notification outbox", () => {
  it("enqueues a stable business event in the caller transaction without rewriting a replay", async () => {
    await enqueueMtmRouteNotification(prisma as never, {
      organizationId: "org-1",
      agentId: "agent-1",
      dedupeKey: "route-change-request:request-1:manager-review",
      title: "Route change needs approval",
      body: "Agent One submitted a route change request.",
      type: "task",
      metadata: { requestId: "request-1" },
    })

    expect(prisma.mtmRouteNotificationOutbox.upsert).toHaveBeenCalledWith({
      where: {
        organizationId_dedupeKey: {
          organizationId: "org-1",
          dedupeKey: "route-change-request:request-1:manager-review",
        },
      },
      create: expect.objectContaining({
        organizationId: "org-1",
        agentId: "agent-1",
        type: "task",
      }),
      update: {},
    })
  })

  it("claims and materializes a ready event with the outbox source as the unique key", async () => {
    vi.mocked(prisma.mtmRouteNotificationOutbox.findMany).mockResolvedValue([OUTBOX_ITEM] as never)

    const result = await drainMtmRouteNotificationOutbox({ now: NOW })

    expect(result).toEqual({ examined: 1, claimed: 1, delivered: 1, suppressed: 0, deferred: 0, failed: 0 })
    expect(prisma.mtmNotification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId_outboxId: {
          organizationId: "org-1",
          outboxId: "outbox-1",
        },
      },
      create: expect.objectContaining({
        organizationId: "org-1",
        agentId: "agent-1",
        outboxId: "outbox-1",
      }),
      update: {},
    }))
    expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
    expect(prisma.mtmRouteNotificationOutbox.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "outbox-1", status: "PROCESSING" }),
      data: expect.objectContaining({ status: "DELIVERED", deliveredAt: NOW }),
    }))
    expect(deps.logMtmRouteObservability).toHaveBeenCalledWith(expect.objectContaining({
      operation: "ROUTE_NOTIFICATION_OUTBOX_DRAIN",
      outcome: "DELIVERED",
      rowCount: 1,
      queueAgeMs: 2 * 60_000,
      outbox: { claimed: 1, delivered: 1, suppressed: 0, deferred: 0, failed: 0 },
    }))
    const serialized = JSON.stringify(deps.logMtmRouteObservability.mock.calls)
    for (const secret of ["outbox-1", "org-1", "agent-1", "Route change approved", "request-1"]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it("suppresses a claimed event when the tenant no longer has route-field enabled", async () => {
    vi.mocked(prisma.mtmRouteNotificationOutbox.findMany).mockResolvedValue([OUTBOX_ITEM] as never)
    vi.mocked(getTenantCapabilityAccess).mockResolvedValue({ allowed: false, capability: null, error: "disabled" })

    const result = await drainMtmRouteNotificationOutbox({ now: NOW })

    expect(result).toEqual({ examined: 1, claimed: 1, delivered: 0, suppressed: 1, deferred: 0, failed: 0 })
    expect(prisma.mtmNotification.upsert).not.toHaveBeenCalled()
    expect(prisma.mtmRouteNotificationOutbox.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SUPPRESSED", suppressedAt: NOW }),
    }))
  })

  it("does not create a second notification when a worker loses its delivery lease", async () => {
    vi.mocked(prisma.mtmRouteNotificationOutbox.findMany).mockResolvedValue([OUTBOX_ITEM] as never)
    vi.mocked(prisma.mtmRouteNotificationOutbox.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never)

    const result = await drainMtmRouteNotificationOutbox({ now: NOW })

    expect(result).toEqual({ examined: 1, claimed: 1, delivered: 0, suppressed: 0, deferred: 1, failed: 0 })
    expect(prisma.mtmNotification.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.mtmNotification.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }))
    expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
  })

  // Owner 2026-11-01: «Сотрудник получит новый порядок в приложении» — in his
  // own words, with a push, not an English line in the bell.
  it("tells the agent his route changed in his own language, with the day and the visits, and pushes it", async () => {
    vi.mocked(prisma.mtmRouteNotificationOutbox.findMany).mockResolvedValue([{
      ...OUTBOX_ITEM,
      dedupeKey: "route:route-1:published:4:agent-1",
      title: "Route updated",
      body: "Route for 2026-11-05 was changed.",
      type: "task",
      metadata: { routeId: "route-1", publishedVersion: 4, event: "route_updated" },
    }] as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ appLanguage: "ru", user: { preferredLanguage: "az" } } as never)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({ date: new Date("2026-11-05T00:00:00.000Z"), _count: { points: 8 } } as never)

    const result = await drainMtmRouteNotificationOutbox({ now: NOW })

    expect(result.delivered).toBe(1)
    expect(prisma.mtmNotification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ title: "Маршрут на 5 ноября изменён", body: "8 визитов. Откройте маршрут в приложении." }),
    }))
    expect(deps.notifyAgents).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      agentIds: ["agent-1"],
      title: "Маршрут на 5 ноября изменён",
      data: { routeId: "route-1" },
      channelId: "team-messages",
    }))
  })

  it("keeps the words of any other route notice, and pushes nothing for it", async () => {
    vi.mocked(prisma.mtmRouteNotificationOutbox.findMany).mockResolvedValue([OUTBOX_ITEM] as never)
    await drainMtmRouteNotificationOutbox({ now: NOW })
    expect(prisma.mtmNotification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ title: "Route change approved", body: "Approved" }),
    }))
    expect(deps.notifyAgents).not.toHaveBeenCalled()
  })

  it("delivers the bell line even when the push fails", async () => {
    vi.mocked(prisma.mtmRouteNotificationOutbox.findMany).mockResolvedValue([{
      ...OUTBOX_ITEM,
      metadata: { routeId: "route-1", publishedVersion: 1, event: "route_published" },
    }] as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ appLanguage: null, user: null } as never)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({ date: new Date("2026-11-05T00:00:00.000Z"), _count: { points: 1 } } as never)
    deps.notifyAgents.mockRejectedValue(new Error("fcm down"))
    const result = await drainMtmRouteNotificationOutbox({ now: NOW })
    expect(result.delivered).toBe(1)
    expect(prisma.mtmNotification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ title: "Marşrut hazırdır: 5 noyabr", body: "1 vizit. Tətbiqdə açın." }),
    }))
  })
})
