/**
 * sendEarnNotification — looks up the member's registered devices and pushes an
 * "earned points" message. No-op when there are no tokens or 0 points.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/push/expo-push", () => ({ sendExpoPush: vi.fn() }))

import { sendEarnNotification } from "@/lib/loyalty/loyalty-push"
import { sendExpoPush } from "@/lib/push/expo-push"

function mkPrisma(tokens: string[] | null) {
  return {
    contact: { findFirst: vi.fn().mockResolvedValue(tokens === null ? null : { expoPushTokens: tokens }) },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sendExpoPush).mockResolvedValue(1)
})

describe("sendEarnNotification", () => {
  it("no-ops (no query, no send) when pointsEarned <= 0", async () => {
    const prisma = mkPrisma(["ExponentPushToken[a]"])
    const n = await sendEarnNotification(prisma, "org-1", "c-1", 0, null)
    expect(n).toBe(0)
    expect(sendExpoPush).not.toHaveBeenCalled()
  })

  it("no-ops when the member has no registered device", async () => {
    const n = await sendEarnNotification(mkPrisma([]), "org-1", "c-1", 100, null)
    expect(n).toBe(0)
    expect(sendExpoPush).not.toHaveBeenCalled()
  })

  it("no-ops when the contact is missing", async () => {
    const n = await sendEarnNotification(mkPrisma(null), "org-1", "c-1", 100, null)
    expect(n).toBe(0)
    expect(sendExpoPush).not.toHaveBeenCalled()
  })

  it("pushes one message per (deduped) device with the points in the body", async () => {
    await sendEarnNotification(
      mkPrisma(["ExponentPushToken[a]", "ExponentPushToken[b]", "ExponentPushToken[a]"]),
      "org-1",
      "c-1",
      150,
      null,
    )
    expect(sendExpoPush).toHaveBeenCalledTimes(1)
    const msgs = vi.mocked(sendExpoPush).mock.calls[0][0]
    expect(msgs).toHaveLength(2) // deduped a+b
    expect(msgs[0]).toMatchObject({ to: "ExponentPushToken[a]", data: { type: "loyalty_earn", points: 150 } })
    expect(msgs[0].body).toContain("150")
  })

  it("mentions the new tier in the body when a tier-up happened", async () => {
    await sendEarnNotification(mkPrisma(["ExponentPushToken[a]"]), "org-1", "c-1", 50, "Gold")
    const msgs = vi.mocked(sendExpoPush).mock.calls[0][0]
    expect(msgs[0].body).toContain("Gold")
  })
})
