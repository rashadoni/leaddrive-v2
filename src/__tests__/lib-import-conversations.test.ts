import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * FB/IG conversation history backfill — importPageConversations. Parses the Graph Conversations API
 * response and writes SocialConversation + ChannelMessage rows: correct direction (outbound when the
 * sender is us), customer = the non-us participant, oldest-first ordering, dedup by Graph mid.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    channelMessage: { findMany: vi.fn(), create: vi.fn() },
  },
}))

import { importPageConversations } from "@/lib/social/import-conversations"
import { prisma } from "@/lib/prisma"

function mockGraph(body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.socialConversation.findUnique).mockResolvedValue(null as never)
  vi.mocked(prisma.socialConversation.create).mockResolvedValue({ id: "conv1", lastMessageAt: new Date(0) } as never)
  vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.channelMessage.create).mockResolvedValue({} as never)
  vi.mocked(prisma.socialConversation.update).mockResolvedValue({} as never)
})

describe("importPageConversations", () => {
  it("imports a thread oldest-first with correct direction + customer participant", async () => {
    mockGraph({
      data: [
        {
          participants: { data: [{ id: "PAGE", name: "Page" }, { id: "CUST", name: "Customer" }] },
          messages: {
            data: [
              { id: "m2", message: "reply", from: { id: "PAGE" }, created_time: "2024-01-02T00:00:00Z" },
              { id: "m1", message: "hello", from: { id: "CUST" }, created_time: "2024-01-01T00:00:00Z" },
            ],
          },
        },
      ],
    })
    const r = await importPageConversations("org1", "PAGE", "TOKEN", "facebook", "cfg1", "Nokaut", ["PAGE"])
    expect(r.error).toBeUndefined()
    expect(r.conversations).toBe(1)
    expect(r.messages).toBe(2)
    const [requestedUrl, requestedInit] = vi.mocked(global.fetch).mock.calls[0]
    expect(String(requestedUrl)).not.toContain("access_token=")
    expect((requestedInit as RequestInit).headers).toMatchObject({ Authorization: "Bearer TOKEN" })

    const calls = vi.mocked(prisma.channelMessage.create).mock.calls
    // Graph returns newest-first → we import oldest-first: m1 (inbound from CUST) then m2 (outbound from PAGE)
    expect((calls[0][0].data as { body: string }).body).toBe("hello")
    expect((calls[0][0].data as { direction: string }).direction).toBe("inbound")
    expect((calls[0][0].data as { metadata: { mid: string } }).metadata.mid).toBe("m1")
    expect((calls[1][0].data as { direction: string }).direction).toBe("outbound")
    // the customer (non-us participant) drives the conversation externalId
    expect((vi.mocked(prisma.socialConversation.create).mock.calls[0][0].data as { externalId: string }).externalId).toBe("CUST")
  })

  it("skips messages whose mid was already imported (re-run safe)", async () => {
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([{ metadata: { mid: "m1" } }] as never)
    mockGraph({
      data: [
        {
          participants: { data: [{ id: "PAGE" }, { id: "CUST", name: "C" }] },
          messages: { data: [{ id: "m1", message: "hi", from: { id: "CUST" }, created_time: "2024-01-01T00:00:00Z" }] },
        },
      ],
    })
    const r = await importPageConversations("org1", "PAGE", "TOKEN", "facebook", "cfg1", "N", ["PAGE"])
    expect(r.messages).toBe(0)
    expect(prisma.channelMessage.create).not.toHaveBeenCalled()
  })

  it("treats an image attachment as a media message", async () => {
    mockGraph({
      data: [
        {
          participants: { data: [{ id: "PAGE" }, { id: "CUST", name: "C" }] },
          messages: {
            data: [{ id: "m1", from: { id: "CUST" }, attachments: { data: [{ image_data: { url: "https://x/img.jpg" } }] } }],
          },
        },
      ],
    })
    await importPageConversations("org1", "PAGE", "TOKEN", "instagram", "cfg1", "IG", ["IGID"])
    const d = vi.mocked(prisma.channelMessage.create).mock.calls[0][0].data as { messageType: string; mediaUrl: string }
    expect(d.messageType).toBe("image")
    expect(d.mediaUrl).toBe("https://x/img.jpg")
  })

  it("returns the Graph error instead of throwing", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: "(#100) bad" } }) }) as unknown as typeof fetch
    const r = await importPageConversations("org1", "PAGE", "TOKEN", "instagram", "cfg1", "IG", ["IGID"])
    expect(r.error).toContain("#100")
    expect(r.messages).toBe(0)
  })

  it("keeps page tokens out of initial and paginated Graph URLs", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [],
          paging: {
            next: "https://graph.facebook.com/v21.0/PAGE/conversations?after=cursor&access_token=TOKEN&appsecret_proof=PROOF",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      }) as unknown as typeof fetch

    const r = await importPageConversations("org1", "PAGE", "TOKEN", "facebook", "cfg1", "N", ["PAGE"])

    expect(r.error).toBeUndefined()
    const calls = vi.mocked(global.fetch).mock.calls
    expect(calls).toHaveLength(2)
    for (const [url, init] of calls) {
      expect(String(url)).not.toContain("access_token=")
      expect(String(url)).not.toContain("appsecret_proof=")
      expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer TOKEN" })
    }
    expect(String(calls[1][0])).toContain("after=cursor")
  })

  it("no-ops without org/page/token", async () => {
    const r = await importPageConversations("", "PAGE", "TOKEN", "facebook", "cfg1", "N", ["PAGE"])
    expect(r.error).toBe("missing org/page/token")
  })
})
