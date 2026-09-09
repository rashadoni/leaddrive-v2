/**
 * C9 touchpoint-recorder unit tests (Phase 2).
 *
 * Verifies the idempotent write contract: coherence filtering (drop rows
 * missing contactId/campaignId), createMany({ skipDuplicates: true }) shape,
 * inserted-count passthrough, dealId passthrough, the never-throw safe
 * variant, and deterministic sourceKey builders.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { campaignTouchpoint: { createMany: vi.fn() } },
}))

import {
  recordTouchpoints,
  recordTouchpointsSafe,
  touchpointSourceKey,
  type TouchpointInput,
} from "@/lib/marketing-attribution/touchpoint-recorder"

type CreateManyArgs = { data: Array<Record<string, unknown>>; skipDuplicates?: boolean }

function mockClient(
  count = 0,
  impl?: (args: CreateManyArgs) => Promise<{ count: number }>,
) {
  return {
    campaignTouchpoint: {
      createMany: vi.fn(impl ?? (async (_args: CreateManyArgs) => ({ count }))),
    },
  }
}

const ROW = (over: Partial<TouchpointInput> = {}): TouchpointInput => ({
  contactId: "c1",
  campaignId: "cam1",
  channel: "email",
  touchpointType: "email_opened",
  occurredAt: new Date("2026-01-01"),
  sourceKey: "k1",
  ...over,
})

describe("recordTouchpoints", () => {
  it("drops rows missing contactId or campaignId (coherence)", async () => {
    const c = mockClient(1)
    await recordTouchpoints(
      "org1",
      [
        ROW({ sourceKey: "keep" }),
        ROW({ contactId: null, sourceKey: "drop1" }),
        ROW({ campaignId: undefined, sourceKey: "drop2" }),
      ],
      c,
    )
    const arg = c.campaignTouchpoint.createMany.mock.calls[0]![0]
    expect(arg.data).toHaveLength(1)
    expect(arg.skipDuplicates).toBe(true)
    expect(arg.data[0]).toMatchObject({
      organizationId: "org1",
      contactId: "c1",
      campaignId: "cam1",
      channel: "email",
      sourceKey: "keep",
      dealId: null,
    })
  })

  it("skips the DB entirely and returns 0 when every row is dropped", async () => {
    const c = mockClient(5)
    const n = await recordTouchpoints("org1", [ROW({ contactId: null, campaignId: null })], c)
    expect(n).toBe(0)
    expect(c.campaignTouchpoint.createMany).not.toHaveBeenCalled()
  })

  it("returns the inserted count reported by createMany", async () => {
    const c = mockClient(2)
    const n = await recordTouchpoints("org1", [ROW({ sourceKey: "a" }), ROW({ sourceKey: "b" })], c)
    expect(n).toBe(2)
  })

  it("passes an explicit dealId through", async () => {
    const c = mockClient(1)
    await recordTouchpoints(
      "org1",
      [ROW({ channel: "other", touchpointType: "deal_campaign_link", dealId: "d1", sourceKey: "deal:d1:campaign_link" })],
      c,
    )
    expect(c.campaignTouchpoint.createMany.mock.calls[0]![0].data[0]!.dealId).toBe("d1")
  })
})

describe("recordTouchpointsSafe", () => {
  it("swallows DB errors and returns 0 (never throws on a hot path)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const c = mockClient(0, async () => {
      throw new Error("DB down")
    })
    const n = await recordTouchpointsSafe("org1", [ROW()], c)
    expect(n).toBe(0)
    spy.mockRestore()
  })
})

describe("touchpointSourceKey", () => {
  it("builds deterministic keys per source", () => {
    expect(touchpointSourceKey.emailSent("L1")).toBe("email:L1:sent")
    expect(touchpointSourceKey.emailOpened("L1")).toBe("email:L1:opened")
    expect(touchpointSourceKey.emailClicked("L1")).toBe("email:L1:clicked")
    expect(touchpointSourceKey.eventRegistered("P1")).toBe("event:P1:registered")
    expect(touchpointSourceKey.eventAttended("P1")).toBe("event:P1:attended")
    expect(touchpointSourceKey.dealCampaignLink("D1")).toBe("deal:D1:campaign_link")
  })
})
