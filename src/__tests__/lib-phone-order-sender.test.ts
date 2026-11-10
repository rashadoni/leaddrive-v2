import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Which number a phone order's messages go out from.
 *
 * The managers' notice and both messages the pharmacy gets used to ask for "the organization's
 * WhatsApp channel" without naming one, and that question has no single answer once a second number
 * is connected: the lookup is an unordered `findFirst`. The pharmacy would then get its receipt from
 * a number it does not know, in a WABA where the template is not approved — so, in practice, not at
 * all. This file pins the answer down.
 */
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

const resolveWhatsAppConfig = vi.fn(async (organizationId: string, opts?: { channelConfigId?: string | null }) => ({
  id: opts?.channelConfigId ?? "unnamed", organizationId, accessToken: "token",
  phoneNumberId: `pn-${opts?.channelConfigId ?? "unnamed"}`, businessAccountId: null,
  verifyToken: null, appSecret: null, displayName: null,
}))
vi.mock("@/lib/whatsapp", () => ({ resolveWhatsAppConfig: (...args: unknown[]) => resolveWhatsAppConfig(...(args as [string, { channelConfigId?: string | null }])) }))

const { pickPhoneOrderSenderRow, phoneOrderSender } = await import("@/lib/pharmacy-orders/manager-notice")

const at = (iso: string) => new Date(iso)

describe("pickPhoneOrderSenderRow", () => {
  it("takes the oldest live channel, whatever order the rows arrive in", () => {
    const older = { id: "line", createdAt: at("2026-10-24T09:00:00Z") }
    const newer = { id: "test-number", createdAt: at("2026-11-10T09:00:00Z") }

    expect(pickPhoneOrderSenderRow([newer, older])?.id).toBe("line")
    expect(pickPhoneOrderSenderRow([older, newer])?.id).toBe("line")
  })

  it("answers the same on every call when two rows share a timestamp", () => {
    // Without the id tiebreak this is the coin toss again, just one level up.
    const a = { id: "aaa", createdAt: at("2026-10-24T09:00:00Z") }
    const b = { id: "bbb", createdAt: at("2026-10-24T09:00:00Z") }

    expect(pickPhoneOrderSenderRow([a, b])?.id).toBe("aaa")
    expect(pickPhoneOrderSenderRow([b, a])?.id).toBe("aaa")
  })

  it("has no answer when the organization has no live channel", () => {
    expect(pickPhoneOrderSenderRow([])).toBeNull()
  })

  it("does not reorder the caller's array", () => {
    const rows = [
      { id: "new", createdAt: at("2026-11-10T09:00:00Z") },
      { id: "old", createdAt: at("2026-10-24T09:00:00Z") },
    ]
    pickPhoneOrderSenderRow(rows)
    expect(rows.map(row => row.id)).toEqual(["new", "old"])
  })
})

describe("phoneOrderSender", () => {
  const rows: Array<{ id: string; createdAt: Date }> = []
  const seen: Array<Record<string, unknown>> = []
  const db = {
    channelConfig: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        seen.push(args.where)
        return rows
      },
    },
  } as unknown as Parameters<typeof phoneOrderSender>[1]

  beforeEach(() => {
    rows.length = 0
    seen.length = 0
    resolveWhatsAppConfig.mockClear()
  })

  it("sends as the line's own number after a second one is connected", async () => {
    rows.push({ id: "test-number", createdAt: at("2026-11-10T09:00:00Z") })
    rows.push({ id: "line", createdAt: at("2026-10-24T09:00:00Z") })

    expect(await phoneOrderSender("org-zeytun", db)).toMatchObject({ id: "line", phoneNumberId: "pn-line" })
    // The named channel is what carries the paused-by-Meta check and the legacy columns, so the
    // answer must come back through there rather than be assembled here.
    expect(resolveWhatsAppConfig).toHaveBeenCalledWith("org-zeytun", { channelConfigId: "line" })
  })

  it("asks only for this organization's live WhatsApp channels", async () => {
    rows.push({ id: "line", createdAt: at("2026-10-24T09:00:00Z") })
    await phoneOrderSender("org-zeytun", db)

    // A disconnected row must not win the choice by being the oldest.
    expect(seen[0]).toEqual({ organizationId: "org-zeytun", channelType: "whatsapp", isActive: true })
  })

  it("is not connected when there is no live channel, and asks Meta nothing", async () => {
    expect(await phoneOrderSender("org-zeytun", db)).toBeNull()
    expect(resolveWhatsAppConfig).not.toHaveBeenCalled()
  })
})
