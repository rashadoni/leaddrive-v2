import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createNotificationRow: vi.fn(),
  findUser: vi.fn(),
  findPreference: vi.fn(),
  getOrgModuleContext: vi.fn(),
  sendPushToUser: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: { create: mocks.createNotificationRow },
    user: { findUnique: mocks.findUser },
    userPreference: { findUnique: mocks.findPreference },
  },
}))

vi.mock("@/lib/push-send", () => ({
  sendPushToUser: mocks.sendPushToUser,
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgModuleContext: mocks.getOrgModuleContext,
}))

vi.mock("@/lib/notifications/taxonomy", () => ({
  deriveSection: vi.fn(() => "omnichannel"),
}))

vi.mock("@/lib/notifications/access", () => ({
  canNotifyEntityType: vi.fn(() => true),
}))

vi.mock("@/lib/notifications/prefs", () => ({
  shouldPush: vi.fn(() => true),
}))

import { createNotification } from "@/lib/notifications"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createNotificationRow.mockResolvedValue({ id: "notification-1" })
  mocks.findUser.mockResolvedValue({ role: "admin" })
  mocks.findPreference.mockResolvedValue(null)
  mocks.getOrgModuleContext.mockResolvedValue({})
  mocks.sendPushToUser.mockResolvedValue(undefined)
})

describe("createNotification awaited push delivery", () => {
  it("does not resolve until an opted-in push attempt completes", async () => {
    let releasePush!: () => void
    const pushPending = new Promise<void>((resolve) => {
      releasePush = resolve
    })
    mocks.sendPushToUser.mockReturnValue(pushPending)

    let settled = false
    const notification = createNotification({
      organizationId: "org-1",
      userId: "admin-1",
      type: "warning",
      title: "Coverage warning",
      message: "Collection failed",
      entityType: "social_mention",
      entityId: "coverage",
      push: true,
      kind: "social.coverage",
      awaitPush: true,
    }).finally(() => {
      settled = true
    })

    await vi.waitFor(() => expect(mocks.sendPushToUser).toHaveBeenCalledTimes(1))
    expect(settled).toBe(false)

    releasePush()
    await expect(notification).resolves.toEqual({ id: "notification-1" })
    expect(settled).toBe(true)
  })
})
