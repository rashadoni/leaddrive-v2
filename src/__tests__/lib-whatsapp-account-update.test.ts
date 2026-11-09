import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A coexistence number can leave without anyone telling the workspace.
 *
 * Meta disconnects it when the owner's phone has been idle ~14 days, when they change device, when
 * they register the number in the consumer WhatsApp app, or because they tapped «Disconnect
 * Account» themselves — and the Deregister API does not work on such a number, so this webhook is
 * the only notice we get. What is asserted here is the DECISION for each event, because the two
 * situations behind them look alike and must not be treated alike:
 *   • offboarded = temporary (device change). Hold sends, keep the row active, or the webhook
 *     lookup — which requires isActive — would never see the reconnect.
 *   • partner removed = gone. Deactivate; every send would fail anyway.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const state = vi.hoisted(() => ({
  configs: [] as Row[],
  updates: [] as Row[],
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany: vi.fn(async ({ where }: Row) => {
        const ids: string[] = (where.OR ?? []).map((c: Row) => c.businessAccountId ?? c.webhookUrl)
        return state.configs.filter((c) => ids.includes(c.businessAccountId))
      }),
      update: vi.fn(async (args: Row) => {
        state.updates.push(args)
        const row = state.configs.find((c) => c.id === args.where.id)
        if (row) Object.assign(row, args.data)
        return row
      }),
    },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))

import { applyWhatsAppAccountUpdate, isCloudApiPaused } from "@/lib/whatsapp-account-update"

const WABA = "102290129340398"

function seedChannel(extra: Row = {}) {
  state.configs = [{
    id: "cfg_1",
    organizationId: "org_1",
    businessAccountId: WABA,
    isActive: true,
    settings: { embeddedSignup: true, coexistence: true },
    ...extra,
  }]
}

beforeEach(() => {
  state.updates = []
  seedChannel()
})

describe("applyWhatsAppAccountUpdate", () => {
  it("pauses sends on ACCOUNT_OFFBOARDED but leaves the channel active", async () => {
    const result = await applyWhatsAppAccountUpdate({ wabaId: WABA, value: { event: "ACCOUNT_OFFBOARDED" } })

    expect(result).toMatchObject({ action: "paused", channels: 1 })
    expect(isCloudApiPaused(state.configs[0].settings)).toBe(true)
    // The row must stay findable: resolving this number's webhooks requires isActive, and the
    // ACCOUNT_RECONNECTED that ends the pause arrives on that same lookup.
    expect(state.configs[0].isActive).toBe(true)
    expect(state.updates[0].data).not.toHaveProperty("isActive")
  })

  it("lifts the pause on ACCOUNT_RECONNECTED", async () => {
    await applyWhatsAppAccountUpdate({ wabaId: WABA, value: { event: "ACCOUNT_OFFBOARDED" } })
    await applyWhatsAppAccountUpdate({ wabaId: WABA, value: { event: "ACCOUNT_RECONNECTED" } })

    expect(isCloudApiPaused(state.configs[0].settings)).toBe(false)
    expect(state.configs[0].settings).not.toHaveProperty("cloudApiPausedAt")
  })

  it("never switches a channel back on — only the workspace or a fresh signup may do that", async () => {
    // An administrator turned this channel off in Settings → Channels. A reconnect webhook arriving
    // afterwards must not silently revive it.
    seedChannel({ isActive: false })

    await applyWhatsAppAccountUpdate({ wabaId: WABA, value: { event: "ACCOUNT_RECONNECTED" } })

    expect(state.configs[0].isActive).toBe(false)
    expect(state.updates.every((u) => !("isActive" in u.data))).toBe(true)
  })

  it("deactivates the channel when the number leaves, and records why", async () => {
    const result = await applyWhatsAppAccountUpdate({
      wabaId: WABA,
      value: { event: "PARTNER_REMOVED", disconnection_info: { reason: "PRIMARY_INACTIVITY", initiated_by: "SYSTEM" } },
    })

    expect(result.action).toBe("disconnected")
    expect(state.configs[0].isActive).toBe(false)
    expect(state.configs[0].settings.disconnected).toMatchObject({
      event: "PARTNER_REMOVED",
      reason: "PRIMARY_INACTIVITY",
      initiatedBy: "SYSTEM",
    })
    // A number that left is not "paused": holding sends would hide a permanent failure.
    expect(isCloudApiPaused(state.configs[0].settings)).toBe(false)
  })

  it("ignores lifecycle events it has no answer for, and writes nothing", async () => {
    const result = await applyWhatsAppAccountUpdate({ wabaId: WABA, value: { event: "ACCOUNT_REVIEW_UPDATE" } })

    expect(result.action).toBe("ignored")
    expect(state.updates).toHaveLength(0)
    expect(state.configs[0].isActive).toBe(true)
  })

  it("does not guess when the Messaging account is unknown to us", async () => {
    const result = await applyWhatsAppAccountUpdate({ wabaId: "999", value: { event: "PARTNER_REMOVED" } })

    expect(result).toMatchObject({ action: "unknown_account", channels: 0 })
    expect(state.updates).toHaveLength(0)
  })

  it("falls back to the account id inside the payload when the entry carries none", async () => {
    const result = await applyWhatsAppAccountUpdate({
      wabaId: null,
      value: { event: "ACCOUNT_OFFBOARDED", waba_info: { waba_id: WABA } },
    })

    expect(result.action).toBe("paused")
  })
})
