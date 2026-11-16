import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import type { NextRequest } from "next/server"
import { createHmac } from "crypto"

/**
 * 2026-11-16 the shape log (lib/social/meta-message-shape) showed what the bare «[media]» rows of
 * Instagram Direct were:
 *   - `attachments=template{generic}` — a card with buttons: another business's auto-reply
 *     (@avtorental: «write on WhatsApp»), and the card Instagram adds a second after a customer types
 *     a phone number (Zeytun: «0503348812», then «[media]»);
 *   - `keys=is_deleted,mid` — the customer deleted a message. Not a new message at all.
 * The card's words become the body; the deletion marks the message it names.
 */
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  upsert: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  updateConversations: vi.fn(),
  autoReply: vi.fn(),
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
    channelMessage: { findFirst: mocks.findFirst, create: mocks.create, update: mocks.update },
    socialConversation: { updateMany: mocks.updateConversations },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))
vi.mock("@/lib/facebook", () => ({ upsertSocialConversation: mocks.upsert }))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn(async () => {}) }))
vi.mock("@/lib/social/meta-sender-profile", () => ({ resolveMetaSenderName: vi.fn(async () => "@sbhnbyrmv") }))
vi.mock("@/lib/inbox/conversation-events", () => ({ emitConversationIngestEvents: vi.fn(async () => {}) }))
vi.mock("@/lib/chatbot-autoreply", () => ({
  maybeAutoReply: mocks.autoReply,
  chatbotTookOwnership: () => false,
}))

import { POST } from "@/app/api/v1/webhooks/instagram/route"
import { metaCardsText, metaInboundText, readMetaTemplateCards } from "@/lib/social/meta-dm-inbound-content"
import { describeMetaMessageShape } from "@/lib/social/meta-message-shape"
import { placeholderPreview, placeholderView } from "@/lib/inbox/media-placeholder"

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

function delivery(...messages: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    object: "instagram",
    entry: [{
      id: "IG_ZEYTUN",
      messaging: messages.map((message, i) => ({ sender: { id: "4621512548170901" }, recipient: { id: "IG_ZEYTUN" }, timestamp: i + 1, message })),
    }],
  })
}

/** The rows the inbox already holds, by Meta message id. */
let stored: Record<string, { id: string; metadata: unknown; conversationId: string; createdAt: Date }> = {}
/** Whether a message newer than the deleted one exists in its conversation. */
let newerExists = false

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INSTAGRAM_APP_SECRET = "ENV"
  stored = {}
  newerExists = false
  mocks.upsert.mockResolvedValue({ id: "sc-1", assignedTo: null, wasCreated: false })
  mocks.create.mockResolvedValue({ id: "msg-new" })
  mocks.update.mockResolvedValue({})
  mocks.updateConversations.mockResolvedValue({ count: 1 })
  mocks.autoReply.mockResolvedValue({ handled: false })
  mocks.findFirst.mockImplementation(async ({ where }: { where: { externalId?: string; createdAt?: unknown } }) => {
    if (where.createdAt) return newerExists ? { id: "msg-later" } : null
    return where.externalId ? stored[where.externalId] ?? null : null
  })
})
afterEach(() => {
  delete process.env.INSTAGRAM_APP_SECRET
})

const CARD = {
  type: "template",
  payload: {
    generic: {
      elements: [{
        title: "Rent a car — 50 AZN / gün",
        subtitle: "Bakı, 24/7",
        image_url: "https://lookaside.fbsbx.com/x.jpg",
        buttons: [{ type: "web_url", url: "https://wa.me/994500000000", title: "WhatsApp-a yaz" }, { type: "phone_number", title: "Zəng et" }],
      }],
    },
  },
}

describe("a card with buttons", () => {
  it("is stored with its words, not as «[media]», and wakes no auto-reply", async () => {
    await POST(signed(delivery({ mid: "mid-card", attachments: [CARD] })))

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      body: "Rent a car — 50 AZN / gün\nBakı, 24/7\n▸ WhatsApp-a yaz\n▸ Zəng et",
      externalId: "mid-card",
      mediaUrl: null,
    })
    // The conversation preview quotes the card too.
    expect(mocks.upsert.mock.calls[0][4]).toBe("Rent a car — 50 AZN / gün\nBakı, 24/7\n▸ WhatsApp-a yaz\n▸ Zəng et")
    // Another business's bot is not answered by ours.
    expect(mocks.autoReply).not.toHaveBeenCalled()
  })

  it("stays «[media]» when Meta sends a card in a form with nothing to read", async () => {
    await POST(signed(delivery({ mid: "mid-odd", attachments: [{ type: "template", payload: { generic: { elements: [{ image_url: "https://x" }] } } }] })))

    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ body: "[media]" })
  })

  it("is read from the forms Messenger and the button template use", () => {
    const messenger = [{ type: "template", payload: { template_type: "generic", elements: [{ title: "Kampaniya", buttons: [{ title: "Ətraflı" }] }] } }]
    expect(metaCardsText(readMetaTemplateCards(messenger))).toBe("Kampaniya\n▸ Ətraflı")
    const button = [{ type: "template", payload: { template_type: "button", text: "Sifarişiniz qəbul olundu", buttons: [{ title: "Bəli" }, { title: "Xeyr" }] } }]
    expect(metaCardsText(readMetaTemplateCards(button))).toBe("Sifarişiniz qəbul olundu\n▸ Bəli\n▸ Xeyr")
    expect(readMetaTemplateCards([{ type: "image", payload: { url: "https://x", title: "not a card" } }])).toEqual([])
    expect(readMetaTemplateCards(undefined)).toEqual([])
  })

  it("never outranks the customer's own words", () => {
    expect(metaInboundText({ text: "Salam", attachments: [CARD] })).toBe("Salam")
    expect(metaInboundText({ text: "", attachments: [] })).toBeNull()
  })

  it("names its nested keys in the log, never a value", () => {
    const shape = describeMetaMessageShape({ mid: "x", attachments: [CARD] })
    expect(shape).toBe("keys=attachments,mid attachments=template{generic(elements[buttons+image_url+subtitle+title])}")
    expect(shape).not.toMatch(/Rent|wa\.me|lookaside/)
  })
})

describe("a message the customer deleted", () => {
  beforeEach(() => {
    stored["mid-salam"] = { id: "msg-salam", metadata: { senderId: "4621512548170901" }, conversationId: "sc-1", createdAt: new Date("2026-11-15T15:48:47Z") }
  })

  it("marks the message it names and writes no new row", async () => {
    await POST(signed(delivery({ mid: "mid-salam", is_deleted: true })))

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      where: { id: "msg-salam" },
      data: { metadata: { senderId: "4621512548170901", unsentByCustomer: true } },
    })
    // It was the latest: the conversation list stops quoting it.
    expect(mocks.updateConversations).toHaveBeenCalledWith({ where: { id: "sc-1", organizationId: "org-zeytun" }, data: { lastMessage: "[unsent]" } })
  })

  it("leaves the preview alone when the customer wrote after it", async () => {
    newerExists = true

    await POST(signed(delivery({ mid: "mid-salam", is_deleted: true })))

    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.updateConversations).not.toHaveBeenCalled()
  })

  it("does nothing for a message the inbox never had", async () => {
    await POST(signed(delivery({ mid: "mid-unknown", is_deleted: true })))

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("shows neither its words nor its file, in the thread and in the list", () => {
    expect(placeholderView({ body: "Salam", mediaUrl: "/uploads/inbox/o/x.jpg", channelType: "instagram", metadata: { unsentByCustomer: true } }))
      .toEqual({ kind: "unsent" })
    expect(placeholderView({ body: "Salam", channelType: "instagram", metadata: { senderId: "1" } })).toEqual({ kind: "body" })
    expect(placeholderPreview("[unsent]")).toEqual({ key: "messageUnsent" })
    for (const locale of ["en", "ru", "az"]) {
      const ns = JSON.parse(readFileSync(path.join(process.cwd(), `messages/${locale}.json`), "utf8")).inboxV2 as Record<string, string>
      expect(ns.messageUnsent, locale).toBeTruthy()
    }
    const page = readFileSync(path.join(process.cwd(), "src/app/(dashboard)/inbox/page.tsx"), "utf8")
    expect(page).toContain('m.mediaUrl && view.kind !== "unsent" &&')
  })
})
