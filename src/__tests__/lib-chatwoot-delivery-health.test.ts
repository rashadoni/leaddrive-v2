import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createNotification: vi.fn(),
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: mocks.createNotification,
}))

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  CHATWOOT_DELIVERY_FAILURE_LIMIT,
  DELIVERY_PROBE_INTERVAL_MS,
  deliveryFailureStreak,
  reconcileChatwootDeliveryFailures,
  stopAutoReplyForBrokenDelivery,
} from "@/lib/inbox/chatwoot-delivery-health"

const MAPI_ERROR = "40002: Direct message error: User is not entitled to access MAPI capabilities."

function messageDb(rows: Array<Record<string, unknown>>) {
  const findMany = vi.fn(async () => rows)
  const update = vi.fn(async () => ({}))
  return { db: { channelMessage: { findMany, update } }, findMany, update }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createNotification.mockResolvedValue(undefined)
})

describe("Chatwoot delivery reconciliation", () => {
  it("marks our row failed and keeps the provider's own words", async () => {
    const { db, findMany, update } = messageDb([
      {
        id: "row_1",
        externalId: "9001",
        metadata: { deliveryIdempotencyKey: "ai-draft:abc", deliveryConfirmed: true },
      },
    ])

    const reconciled = await reconcileChatwootDeliveryFailures(db as never, {
      organizationId: "org_1",
      messages: [
        { id: 9001, message_type: "outgoing", status: "failed", content_attributes: { external_error: MAPI_ERROR } },
      ],
    })

    expect(reconciled).toBe(1)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org_1",
        direction: "outbound",
        externalId: { in: ["9001"] },
        status: { not: "failed" },
      }),
    }))
    expect(update).toHaveBeenCalledWith({
      where: { id: "row_1" },
      data: {
        status: "failed",
        metadata: {
          // The delivery ledger survives: losing the idempotency key would let a
          // retry send the customer the same message twice.
          deliveryIdempotencyKey: "ai-draft:abc",
          deliveryConfirmed: false,
          deliveryFailed: true,
          providerStatus: "failed",
          providerError: MAPI_ERROR,
          error: MAPI_ERROR,
        },
      },
    })
  })

  it("reads no rows when the provider refused nothing", async () => {
    const { db, findMany } = messageDb([])

    const reconciled = await reconcileChatwootDeliveryFailures(db as never, {
      organizationId: "org_1",
      messages: [
        { id: 1, message_type: "outgoing", status: "delivered" },
        { id: 2, message_type: "incoming", status: "failed" },
        { id: 3, message_type: "outgoing", status: "failed", private: true },
      ],
    })

    expect(reconciled).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe("Chatwoot delivery failure streak", () => {
  it("counts only the unbroken run of failures and surfaces the newest error and time", async () => {
    const newest = new Date("2026-08-31T10:04:00Z")
    const { db } = messageDb([
      { status: "failed", metadata: { providerError: MAPI_ERROR }, createdAt: newest },
      { status: "failed", metadata: { providerError: "40105: Access token is invalid" }, createdAt: new Date("2026-08-30T10:00:00Z") },
      { status: "delivered", metadata: {}, createdAt: new Date("2026-08-27T10:00:00Z") },
      { status: "failed", metadata: { providerError: "older" }, createdAt: new Date("2026-08-25T10:00:00Z") },
    ])

    await expect(deliveryFailureStreak(db as never, {
      organizationId: "org_1",
      conversationId: "conv_1",
    })).resolves.toEqual({ streak: 2, providerError: MAPI_ERROR, newestFailureAt: newest })
  })

  it("clears once a reply gets through", async () => {
    const { db } = messageDb([
      { status: "delivered", metadata: {}, createdAt: new Date() },
      { status: "failed", metadata: {}, createdAt: new Date() },
    ])

    await expect(deliveryFailureStreak(db as never, {
      organizationId: "org_1",
      conversationId: "conv_1",
    })).resolves.toEqual({ streak: 0, providerError: null, newestFailureAt: null })
  })
})

describe("Auto-reply gate on a broken channel", () => {
  function gateDb(
    statuses: string[],
    recentNotice: { id: string } | null = null,
    failureAge = 0,
  ) {
    return {
      channelMessage: {
        findMany: vi.fn(async () => statuses.map((status) => ({
          status,
          metadata: { providerError: MAPI_ERROR },
          createdAt: new Date(Date.now() - failureAge),
        }))),
        update: vi.fn(),
      },
      notification: { findFirst: vi.fn(async () => recentNotice) },
      user: { findMany: vi.fn(async () => [{ id: "user_1" }, { id: "user_2" }]) },
    }
  }

  it("lets one failure pass — a single hiccup must not park a live conversation", async () => {
    const db = gateDb(["failed", "delivered"])

    await expect(stopAutoReplyForBrokenDelivery(
      { orgId: "org_1", conversationId: "conv_1", contactName: "nota_music0" },
      db as never,
    )).resolves.toBe(false)
    expect(mocks.createNotification).not.toHaveBeenCalled()
  })

  it("stops the bots and tells the team the provider's reason", async () => {
    const db = gateDb(Array(CHATWOOT_DELIVERY_FAILURE_LIMIT).fill("failed"))

    await expect(stopAutoReplyForBrokenDelivery(
      { orgId: "org_1", conversationId: "conv_1", contactName: "nota_music0" },
      db as never,
    )).resolves.toBe(true)
    expect(mocks.createNotification).toHaveBeenCalledTimes(2)
    expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      entityId: "conv_1",
      message: expect.stringContaining(MAPI_ERROR),
    }))
  })

  it("still stays silent when the team was already told today", async () => {
    const db = gateDb(Array(CHATWOOT_DELIVERY_FAILURE_LIMIT).fill("failed"), { id: "note_1" })

    await expect(stopAutoReplyForBrokenDelivery(
      { orgId: "org_1", conversationId: "conv_1", contactName: "nota_music0" },
      db as never,
    )).resolves.toBe(true)
    expect(mocks.createNotification).not.toHaveBeenCalled()
  })

  it("lets one probe through after the interval so a healed channel reopens itself", async () => {
    // The tenant's ads run at night with nobody on shift. A permanently parked
    // conversation would need a human to unpark it; the probe means the agent
    // walks back in on its own once the provider restores access.
    const db = gateDb(
      Array(CHATWOOT_DELIVERY_FAILURE_LIMIT).fill("failed"),
      null,
      DELIVERY_PROBE_INTERVAL_MS + 60_000,
    )

    await expect(stopAutoReplyForBrokenDelivery(
      { orgId: "org_1", conversationId: "conv_1", contactName: "nota_music0" },
      db as never,
    )).resolves.toBe(false)
    expect(mocks.createNotification).not.toHaveBeenCalled()
  })

  it("keeps the gate closed while the newest refusal is younger than the interval", async () => {
    const db = gateDb(
      Array(CHATWOOT_DELIVERY_FAILURE_LIMIT).fill("failed"),
      null,
      DELIVERY_PROBE_INTERVAL_MS - 60_000,
    )

    await expect(stopAutoReplyForBrokenDelivery(
      { orgId: "org_1", conversationId: "conv_1", contactName: "nota_music0" },
      db as never,
    )).resolves.toBe(true)
  })

  it("fails open: a broken health lookup must not silence a working channel", async () => {
    const db = {
      channelMessage: { findMany: vi.fn(async () => { throw new Error("db down") }) },
      notification: { findFirst: vi.fn() },
      user: { findMany: vi.fn() },
    }

    await expect(stopAutoReplyForBrokenDelivery(
      { orgId: "org_1", conversationId: "conv_1", contactName: "nota_music0" },
      db as never,
    )).resolves.toBe(false)
  })
})
