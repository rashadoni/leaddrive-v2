import { describe, it, expect, vi, beforeEach } from "vitest"

// Collaborators [P2] — inbound notification fan-out to the assignee + every internal participant
// (deduped), fail-soft. Replaces the per-webhook assignee-only notify.

vi.mock("@/lib/prisma", () => ({
  prisma: { conversationParticipant: { findMany: vi.fn() } },
}))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(() => Promise.resolve()) }))

import { notifyConversationRecipients } from "@/lib/social/notify-recipients"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"

const NOTIF = {
  type: "info" as const,
  title: "New message",
  message: "x",
  entityType: "inbox_message",
  entityId: "c1",
  kind: "inbox.message",
}
const notifiedIds = () =>
  vi.mocked(createNotification).mock.calls.map((c) => (c[0] as { userId: string }).userId).sort()

beforeEach(() => vi.clearAllMocks())

describe("notifyConversationRecipients (collaborators fan-out)", () => {
  it("notifies the assignee AND all participants, deduped", async () => {
    vi.mocked(prisma.conversationParticipant.findMany).mockResolvedValue([{ userId: "u2" }, { userId: "u3" }] as never)
    await notifyConversationRecipients("org1", "c1", "u1", NOTIF)
    expect(notifiedIds()).toEqual(["u1", "u2", "u3"])
  })

  it("dedups an assignee who is also a participant (notified once)", async () => {
    vi.mocked(prisma.conversationParticipant.findMany).mockResolvedValue([{ userId: "u1" }, { userId: "u2" }] as never)
    await notifyConversationRecipients("org1", "c1", "u1", NOTIF)
    expect(notifiedIds()).toEqual(["u1", "u2"])
  })

  it("no socialConversationId → assignee only, skips the participant lookup", async () => {
    await notifyConversationRecipients("org1", null, "u1", NOTIF)
    expect(prisma.conversationParticipant.findMany).not.toHaveBeenCalled()
    expect(createNotification).toHaveBeenCalledTimes(1)
  })

  it("no assignee and no participants → no notifications", async () => {
    vi.mocked(prisma.conversationParticipant.findMany).mockResolvedValue([] as never)
    await notifyConversationRecipients("org1", "c1", null, NOTIF)
    expect(createNotification).not.toHaveBeenCalled()
  })

  it("fail-soft: a participant-lookup error still notifies the assignee", async () => {
    vi.mocked(prisma.conversationParticipant.findMany).mockRejectedValue(new Error("db down") as never)
    await notifyConversationRecipients("org1", "c1", "u1", NOTIF)
    expect(createNotification).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createNotification).mock.calls[0][0]).toMatchObject({ userId: "u1" })
  })

  it("excludes the actor (e.g. the note author) from the fan-out", async () => {
    vi.mocked(prisma.conversationParticipant.findMany).mockResolvedValue([{ userId: "u2" }, { userId: "u3" }] as never)
    await notifyConversationRecipients("org1", "c1", "u1", NOTIF, "u1") // u1 = assignee AND the author
    expect(notifiedIds()).toEqual(["u2", "u3"]) // u1 (author) dropped — no self-notify
  })

  it("pings @-mentioned colleagues (extraUserIds), even non-participants; author still excluded", async () => {
    vi.mocked(prisma.conversationParticipant.findMany).mockResolvedValue([{ userId: "u2" }] as never)
    await notifyConversationRecipients("org1", "c1", "u1", NOTIF, "u1", ["u5", "u6"])
    expect(notifiedIds()).toEqual(["u2", "u5", "u6"]) // assignee u1=author excluded; participant u2; mentions u5,u6
  })
})
