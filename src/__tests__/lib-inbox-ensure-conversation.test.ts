import { describe, it, expect, vi, beforeEach } from "vitest"

// [P3] — ensure-create a SocialConversation for a non-social thread (email/sms/web-chat) so it can
// carry collaborators, then link the thread's messages by id.

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    channelMessage: { updateMany: vi.fn() },
  },
}))

import { ensureConversation } from "@/lib/inbox-ensure-conversation"
import { prisma } from "@/lib/prisma"

// externalId / platform of the most recent upsert call
const lastWhere = () => {
  const calls = vi.mocked(prisma.socialConversation.findUnique).mock.calls
  const arg = calls[calls.length - 1][0] as { where: { organizationId_platform_externalId: { platform: string; externalId: string } } }
  return arg.where.organizationId_platform_externalId
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.socialConversation.findUnique).mockResolvedValue(null as never)
  vi.mocked(prisma.socialConversation.create).mockResolvedValue({ id: "sc1", assignedTo: "u7" } as never)
  vi.mocked(prisma.socialConversation.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.channelMessage.updateMany).mockResolvedValue({ count: 2 } as never)
})

describe("ensureConversation ([P3] non-social ensure-create)", () => {
  it("keys externalId on the stable contactId, platform=inbox", async () => {
    const r = await ensureConversation("org1", { channel: "email", contactId: "ct1", contactEmail: "a@b.com", messageIds: ["m1"] })
    expect(r).toEqual({ id: "sc1", assignedTo: "u7", wasCreated: true }) // assignedTo now passed through so callers can notify the assignee
    expect(lastWhere()).toEqual({ organizationId: "org1", platform: "inbox", externalId: "c:ct1" })
    expect(prisma.socialConversation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: { channel: "email", ensured: true, contactEmail: "a@b.com" },
      }),
    }))
  })

  it("returns wasCreated=false when the inbox conversation already exists", async () => {
    vi.mocked(prisma.socialConversation.findUnique).mockResolvedValue({ id: "sc_existing", assignedTo: null } as never)
    const r = await ensureConversation("org1", { channel: "sms", contactPhone: "+994501234567", messageIds: ["m1"] })
    expect(r).toEqual({ id: "sc_existing", assignedTo: null, wasCreated: false })
    expect(prisma.socialConversation.create).not.toHaveBeenCalled()
  })

  it("reopens an existing closed conversation only for a real inbound message", async () => {
    vi.mocked(prisma.socialConversation.findUnique).mockResolvedValue({ id: "sc_existing", assignedTo: "u7" } as never)

    await ensureConversation("org1", {
      channel: "email",
      contactId: "ct1",
      messageIds: ["m1"],
      reopenOnInbound: true,
    })

    expect(prisma.socialConversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "sc_existing",
        organizationId: "org1",
        // Soft-deleted threads reopen too (08b-era change). The expectation
        // below is the guard for that: a deleted conversation is invisible in
        // the inbox AND in the trash, so without this branch a customer's reply
        // lands nowhere. The update stays org-scoped and id-pinned either way.
        OR: [{ status: { in: ["resolved", "archived"] } }, { deletedAt: { not: null } }],
      },
      data: {
        status: "open",
        closedAt: null,
        snoozedUntil: null,
        deletedAt: null,
        deletedBy: null,
      },
    })
  })

  it("the reopen targets deleted threads, not just resolved ones", async () => {
    // Stated separately so the intent survives a refactor of the object above:
    // whatever else changes, a customer reply must be able to resurrect a
    // thread someone deleted, which is invisible in the inbox AND the trash.
    vi.mocked(prisma.socialConversation.findUnique).mockResolvedValue({ id: "sc_deleted", assignedTo: null } as never)

    await ensureConversation("org1", {
      channel: "email",
      contactId: "ct1",
      messageIds: ["m1"],
      reopenOnInbound: true,
    })

    const call = vi.mocked(prisma.socialConversation.updateMany).mock.calls.at(-1)?.[0] as
      | { where: { OR?: Array<Record<string, unknown>> }; data: Record<string, unknown> }
      | undefined
    expect(call?.where.OR).toContainEqual({ deletedAt: { not: null } })
    expect(call?.data).toMatchObject({ deletedAt: null, deletedBy: null })
  })

  it("does not reopen a conversation for an operator-side ensure action", async () => {
    vi.mocked(prisma.socialConversation.findUnique).mockResolvedValue({ id: "sc_existing", assignedTo: "u7" } as never)

    await ensureConversation("org1", { channel: "email", contactId: "ct1" })

    expect(prisma.socialConversation.updateMany).not.toHaveBeenCalled()
  })

  it("falls back session → email (lowercased) → phone (normalized)", async () => {
    await ensureConversation("org1", { webChatSessionId: "sess9" })
    expect(lastWhere().externalId).toBe("w:sess9")
    await ensureConversation("org1", { contactEmail: "Foo@Bar.COM" })
    expect(lastWhere().externalId).toBe("e:foo@bar.com")
    await ensureConversation("org1", { contactPhone: "+1 (555) 123-4567" })
    expect(lastWhere().externalId).toBe("p:+15551234567")
  })

  it("links ONLY the supplied messages, org-scoped + only-if-null", async () => {
    await ensureConversation("org1", { contactId: "ct1", messageIds: ["m1", "m2", ""] })
    expect(prisma.channelMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1", "m2"] }, organizationId: "org1", conversationId: null },
      data: { conversationId: "sc1" },
    })
  })

  it("skips the link step when no messageIds", async () => {
    await ensureConversation("org1", { contactId: "ct1" })
    expect(prisma.channelMessage.updateMany).not.toHaveBeenCalled()
  })

  it("treats a first-message create race loser as an existing conversation", async () => {
    vi.mocked(prisma.socialConversation.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: "sc_winner", assignedTo: "u7" } as never)
    vi.mocked(prisma.socialConversation.create).mockRejectedValueOnce({ code: "P2002" } as never)

    const r = await ensureConversation("org1", { contactId: "ct1", messageIds: ["m1"] })

    expect(r).toEqual({ id: "sc_winner", assignedTo: "u7", wasCreated: false })
    expect(prisma.channelMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1"] }, organizationId: "org1", conversationId: null },
      data: { conversationId: "sc_winner" },
    })
  })

  it("throws (no upsert) when there is no stable identity", async () => {
    await expect(ensureConversation("org1", { channel: "email" })).rejects.toThrow(/identity/)
    expect(prisma.socialConversation.findUnique).not.toHaveBeenCalled()
    expect(prisma.socialConversation.create).not.toHaveBeenCalled()
  })
})
