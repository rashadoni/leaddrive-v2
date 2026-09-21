import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A conversation follows the connection that delivered its latest customer message.
 *
 * Replies are sent through the conversation's bound `channelConfigId`. It used to be set once, at the
 * first message, and never again — so switching that connection off left every existing conversation
 * receiving new messages (through the connection that replaced it) while every reply failed with
 * «facebook не настроен». Reproduced on prod 2026-09-21: the Lead Drive CRM Page's old connection was
 * switched off, the next Messenger message arrived through the new one, and the reply from the inbox
 * could not be sent.
 */

const findUnique = vi.fn()
const create = vi.fn()
const update = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}))

import { upsertSocialConversation } from "@/lib/facebook"

beforeEach(() => {
  findUnique.mockReset()
  create.mockReset()
  update.mockReset()
  update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "conv-1", ...data }))
  create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "conv-new", ...data }))
})

describe("upsertSocialConversation — channel binding", () => {
  it("rebinds an existing conversation to the connection that delivered the new message", async () => {
    findUnique.mockResolvedValue({ id: "conv-1" }) // bound to the old, now switched-off connection
    await upsertSocialConversation("org_1", "facebook", "psid-1", "Customer", "Do you offer a free trial?", "cfg_new")
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0].data.channelConfigId).toBe("cfg_new")
  })

  it("leaves the binding alone when the caller names no connection", async () => {
    findUnique.mockResolvedValue({ id: "conv-1" })
    await upsertSocialConversation("org_1", "facebook", "psid-1", "Customer", "hi")
    expect(update.mock.calls[0][0].data).not.toHaveProperty("channelConfigId")
  })

  it("keeps the org-scoped lookup — a conversation is never matched across tenants", async () => {
    findUnique.mockResolvedValue({ id: "conv-1" })
    await upsertSocialConversation("org_1", "facebook", "psid-1", "Customer", "hi", "cfg_new")
    expect(update.mock.calls[0][0].where).toEqual({
      organizationId_platform_externalId: { organizationId: "org_1", platform: "facebook", externalId: "psid-1" },
    })
  })

  it("binds a new conversation to the connection that created it, as before", async () => {
    findUnique.mockResolvedValue(null)
    const conv = await upsertSocialConversation("org_1", "whatsapp", "994500000000", "Customer", "hi", "cfg_wa_b")
    expect(create.mock.calls[0][0].data.channelConfigId).toBe("cfg_wa_b")
    expect(conv.wasCreated).toBe(true)
  })

  it("still reopens the conversation and counts the message", async () => {
    findUnique.mockResolvedValue({ id: "conv-1" })
    await upsertSocialConversation("org_1", "instagram", "igsid-1", "Customer", "hi", "cfg_ig")
    const data = update.mock.calls[0][0].data
    expect(data).toMatchObject({ status: "open", closedAt: null, snoozedUntil: null, unreadCount: { increment: 1 } })
  })
})
