import { describe, expect, it } from "vitest"
import { normalizeInboxConversations } from "@/lib/inbox-channels"

describe("normalizeInboxConversations", () => {
  it("makes legacy attachment messages safe to render", () => {
    const conversations = normalizeInboxConversations([{
      contactName: "Legacy TikTok user",
      channels: ["tiktok", null],
      messages: [{
        id: "message-1",
        direction: "inbound",
        channelType: "tiktok",
        from: "legacy-user",
        to: "inbox",
        body: { type: "attachment" },
        mediaUrl: "https://example.test/photo.jpg",
        status: "received",
        createdAt: "2026-07-29T18:00:00.000Z",
      }],
    }])

    expect(conversations).toHaveLength(1)
    expect(conversations[0].channels).toEqual(["tiktok"])
    expect(conversations[0].messages[0].body).toBe("[attachment]")
    expect(conversations[0].messages[0].mediaUrl).toBe("https://example.test/photo.jpg")
  })

  it("drops invalid records instead of passing them to React", () => {
    expect(normalizeInboxConversations([null, "broken", { messages: [null] }])).toEqual([
      expect.objectContaining({
        contactName: "Unknown contact 3",
        messages: [],
      }),
    ])
  })
})
