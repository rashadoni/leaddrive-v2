import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { createHmac } from "crypto"

/**
 * Zeytun Pharma, 2026-10-23..25: every customer text in Instagram Direct was followed 6–24 s later by
 * an inbound "[media]" row with no mid and no attachment, counted as unread. Meta delivers seen
 * receipts, reactions and edits in the same `messaging` array, without a `message`; the webhook
 * recorded them as messages. Only events that carry a `message` may become a ChannelMessage.
 */
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(async () => null) },
    channelConfig: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => [{
        id: "ch-ig", organizationId: "org-zeytun", channelType: "instagram", isActive: true,
        pageId: "IG_ZEYTUN", apiKey: "ig-token", settings: { igLogin: true }, configName: "Zeytun",
        createdAt: new Date("2026-10-23"),
      }]),
    },
    channelMessage: {
      findFirst: vi.fn(async () => null),
      create: mocks.create,
    },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))
vi.mock("@/lib/facebook", () => ({ upsertSocialConversation: mocks.upsert }))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn(async () => {}) }))
vi.mock("@/lib/social/meta-sender-profile", () => ({ resolveMetaSenderName: vi.fn(async () => "@sev_mova") }))
vi.mock("@/lib/inbox/conversation-events", () => ({ emitConversationIngestEvents: vi.fn(async () => {}) }))
vi.mock("@/lib/chatbot-autoreply", () => ({
  maybeAutoReply: vi.fn(async () => ({ handled: false })),
  chatbotTookOwnership: () => false,
}))

import { POST } from "@/app/api/v1/webhooks/instagram/route"

const URL_ = "https://app.leaddrivecrm.org/api/v1/webhooks/instagram"
function signed(body: string): NextRequest {
  const sig = "sha256=" + createHmac("sha256", "ENV").update(body).digest("hex")
  return {
    url: URL_,
    nextUrl: new URL(URL_),
    text: async () => body,
    headers: { get: (k: string) => (k === "x-hub-signature-256" ? sig : null) },
  } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INSTAGRAM_APP_SECRET = "ENV"
  mocks.upsert.mockResolvedValue({ id: "sc-1", assignedTo: null, wasCreated: true })
  mocks.create.mockResolvedValue({ id: "msg-1" })
})
afterEach(() => {
  delete process.env.INSTAGRAM_APP_SECRET
})

describe("Instagram webhook — events without a message", () => {
  it("records the customer's text and ignores the seen receipt and reaction that follow it", async () => {
    const sender = { id: "4621512548170901" }
    const recipient = { id: "IG_ZEYTUN" }
    const body = JSON.stringify({
      object: "instagram",
      entry: [{
        id: "IG_ZEYTUN",
        messaging: [
          { sender, recipient, timestamp: 1, message: { mid: "mid-1", text: "Salam" } },
          { sender, recipient, timestamp: 2, read: { mid: "mid-1" } },
          { sender, recipient, timestamp: 3, reaction: { mid: "mid-1", action: "react", reaction: "love" } },
        ],
      }],
    })

    const res = await POST(signed(body))

    expect(res.status).toBe(200)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ body: "Salam", externalId: "mid-1", from: sender.id })
    expect(mocks.upsert).toHaveBeenCalledTimes(1)
  })

  it("still records a real message that has only an attachment", async () => {
    const body = JSON.stringify({
      object: "instagram",
      entry: [{
        id: "IG_ZEYTUN",
        messaging: [{
          sender: { id: "2981264768873200" }, recipient: { id: "IG_ZEYTUN" }, timestamp: 1,
          message: { mid: "mid-2", attachments: [{ type: "image", payload: { url: "https://cdn.example/x.jpg" } }] },
        }],
      }],
    })

    await POST(signed(body))

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ body: "[media]", messageType: "image", externalId: "mid-2" })
  })
})
