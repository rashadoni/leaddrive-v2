import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { createHmac } from "crypto"

/**
 * Instagram comments in the omnichannel inbox — Zeytun, 2026-11-16 (Sabina: «omnichannel hissəyə
 * instagram komentləri düşmür»). The owner chose from a mock-up:
 *   • a comment lands in the conversation with its author, the same one that holds their Direct;
 *   • the operator answers in Direct by default (the comment's one private reply), or publicly under
 *     the post;
 *   • nobody answers a comment automatically.
 *
 * Driven through the real webhook handler and the real send path, over an in-memory table that keeps
 * the partial unique indexes the database has. Assertions are on the rows the inbox reads and on the
 * calls that reach Meta.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const db = vi.hoisted(() => ({ messages: [] as Row[], conversations: [] as Row[], channels: [] as Row[], seq: 0 }))

function pathValue(row: Row, path: string[]): unknown {
  let value: unknown = row.metadata
  for (const key of path) value = value && typeof value === "object" ? (value as Row)[key] : undefined
  return value
}

function matches(row: Row, where: Row): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "metadata") {
      const { path, equals } = cond as { path: string[]; equals: unknown }
      if (pathValue(row, path) !== equals) return false
      continue
    }
    if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
      if ("gte" in cond && !(row[key] >= cond.gte)) return false
      if ("in" in cond && !(cond.in as unknown[]).includes(row[key])) return false
      if ("not" in cond && row[key] === cond.not) return false
      continue
    }
    if (row[key] !== cond) return false
  }
  return true
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(async () => null) },
    channelConfig: {
      findMany: vi.fn(async () => db.channels),
      findFirst: vi.fn(async ({ where }: Row) => db.channels.find((c) => c.id === where.id) ?? null),
    },
    socialConversation: {
      findUnique: vi.fn(async ({ where }: Row) => {
        const k = where.organizationId_platform_externalId
        return db.conversations.find((c) => c.organizationId === k.organizationId && c.platform === k.platform && c.externalId === k.externalId) ?? null
      }),
      create: vi.fn(async ({ data }: Row) => {
        const row = { id: `conv_${++db.seq}`, unreadCount: 0, status: "open", assignedTo: null, ...data }
        db.conversations.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }: Row) => {
        const k = where.organizationId_platform_externalId
        const row = k
          ? db.conversations.find((c) => c.organizationId === k.organizationId && c.platform === k.platform && c.externalId === k.externalId)
          : db.conversations.find((c) => c.id === where.id)
        if (!row) throw new Error("no conversation")
        for (const [key, value] of Object.entries(data)) {
          row[key] = value && typeof value === "object" && "increment" in (value as Row) ? (row[key] ?? 0) + (value as Row).increment : value
        }
        return row
      }),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const rows = db.conversations.filter((c) => matches(c, where))
        for (const row of rows) Object.assign(row, data)
        return { count: rows.length }
      }),
    },
    channelMessage: {
      findFirst: vi.fn(async ({ where }: Row) =>
        [...db.messages].reverse().find((m) => matches(m, where)) ?? null),
      create: vi.fn(async ({ data }: Row) => {
        // The two partial unique indexes: inbound Meta ids, and outbound app echoes.
        const clash = db.messages.find((m) =>
          m.organizationId === data.organizationId && m.externalId && m.externalId === data.externalId
          && m.direction === data.direction
          && (data.direction === "inbound" || (m.metadata?.source === "business_app" && data.metadata?.source === "business_app")))
        if (clash) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
        const row = { id: `msg_${++db.seq}`, createdAt: new Date(), ...data }
        db.messages.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }: Row) => {
        const row = db.messages.find((m) => m.id === where.id)
        if (row) Object.assign(row, data)
        return row
      }),
    },
    contact: { updateMany: vi.fn(async () => ({ count: 0 })) },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))
vi.mock("@/lib/social/meta-inbound-idempotency", async () => {
  const actual = await vi.importActual<typeof import("@/lib/social/meta-inbound-idempotency")>("@/lib/social/meta-inbound-idempotency")
  return { ...actual, isDuplicateInsert: (e: unknown) => (e as Row)?.code === "P2002" }
})
const notify = vi.hoisted(() => ({ notifyConversationRecipients: vi.fn(async () => {}) }))
vi.mock("@/lib/social/notify-recipients", () => notify)
const media = vi.hoisted(() => ({ fetchAndStoreMetaMedia: vi.fn() }))
vi.mock("@/lib/inbox/meta-media", () => media)
vi.mock("@/lib/social/meta-sender-profile", () => ({ resolveMetaSenderName: vi.fn(async () => "Aytən Məmmədova") }))
const events = vi.hoisted(() => ({ emitConversationIngestEvents: vi.fn(async () => {}) }))
vi.mock("@/lib/inbox/conversation-events", () => events)
const bots = vi.hoisted(() => ({ maybeAutoReply: vi.fn(async () => ({ handled: false })), maybeAiAutoReply: vi.fn(async () => {}) }))
vi.mock("@/lib/chatbot-autoreply", () => ({ maybeAutoReply: bots.maybeAutoReply, chatbotTookOwnership: () => false }))

import { POST } from "@/app/api/v1/webhooks/instagram/route"
import { sendConversationReply } from "@/lib/inbox/send-conversation-reply"
import { selectUncoveredAiInboundBatch } from "@/lib/social/ai-autoreply"
import { hoursSinceCustomerWrote } from "@/lib/inbox/meta-reply-window"
import {
  COMMENTS_SCOPE_REQUESTED,
  INSTAGRAM_COMMENT_TEXT_ONLY,
  instagramCommentEvents,
  isNoiseComment,
  privateReplyAvailable,
  storedInstagramComment,
} from "@/lib/social/instagram-comments"
import { grantedInstagramScopes, instagramSubscribedFields } from "@/lib/social/instagram-login"

const ORG = "org_zeytun"
const ACCOUNT = "17841477127656170" // @noreva_azerbaijan
const PERSON = "4621512548170901"
const POST_ID = "18047392012345678"
const CHANNEL = {
  id: "cfg_noreva", organizationId: ORG, channelType: "instagram", isActive: true, pageId: ACCOUNT,
  apiKey: "ig-token", settings: { igLogin: true, username: "noreva_azerbaijan" }, configName: "@noreva_azerbaijan",
  createdAt: new Date("2026-11-11"),
}

const URL_ = "https://app.leaddrivecrm.org/api/v1/webhooks/instagram"
function signed(payload: unknown): NextRequest {
  const body = JSON.stringify(payload)
  const sig = "sha256=" + createHmac("sha256", "ENV").update(body).digest("hex")
  return {
    url: URL_,
    nextUrl: new URL(URL_),
    text: async () => body,
    headers: { get: (k: string) => (k === "x-hub-signature-256" ? sig : null) },
  } as unknown as NextRequest
}

/** Business Login's own shape: `field` and `value` right on the entry. */
function commentDelivery(value: Row) {
  return { object: "instagram", entry: [{ id: ACCOUNT, time: 1, field: "comments", value }] }
}
function customerComment(overrides: Row = {}) {
  return {
    id: "17900000000000001",
    from: { id: PERSON, username: "ayten.m" },
    text: "Qiyməti neçədir? Bakıda haradan almaq olar?",
    media: { id: POST_ID, media_product_type: "FEED" },
    ...overrides,
  }
}

type FetchCall = { url: string; init?: RequestInit }
let graph: FetchCall[] = []
function stubMeta(handler: (call: FetchCall) => Response | undefined = () => undefined) {
  graph = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init }
    graph.push(call)
    const own = handler(call)
    if (own) return own
    if (call.url.includes(`/${POST_ID}?fields=`)) {
      return new Response(JSON.stringify({
        caption: "Noreva Xerodiane AP+ — quru dəri üçün krem", permalink: "https://www.instagram.com/p/Cx1/",
        media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/v/post.jpg",
      }), { status: 200 })
    }
    if (call.url.endsWith("/replies")) return new Response(JSON.stringify({ id: "17900000000000099" }), { status: 200 })
    if (call.url.includes("/me/messages")) return new Response(JSON.stringify({ recipient_id: PERSON, message_id: "mid.private1" }), { status: 200 })
    return new Response("not found", { status: 404 })
  }))
}

const comments = () => db.messages.filter((m) => m.direction === "inbound" && m.metadata?.igComment)
const outbound = () => db.messages.filter((m) => m.direction === "outbound")
const commentRow = () => comments()[0] as { createdAt: Date; metadata: unknown }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INSTAGRAM_APP_SECRET = "ENV"
  db.seq = 0
  db.channels = [CHANNEL]
  db.messages = []
  // The person already wrote in Direct: their conversation exists, named from their profile.
  db.conversations = [{
    id: "conv_ayten", organizationId: ORG, platform: "instagram", externalId: PERSON, channelConfigId: CHANNEL.id,
    contactName: "Aytən Məmmədova", status: "closed", assignedTo: "user_leyla", unreadCount: 0,
  }]
  media.fetchAndStoreMetaMedia.mockReset()
  media.fetchAndStoreMetaMedia.mockResolvedValue({ url: `/uploads/inbox/${ORG}/post.jpg`, kind: "image" })
  stubMeta()
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.INSTAGRAM_APP_SECRET
})

describe("a comment under a post reaches the inbox", () => {
  it("lands in the author's own conversation, beside their Direct, as a comment with the post", async () => {
    const res = await POST(signed(commentDelivery(customerComment())))

    expect(res.status).toBe(200)
    expect(comments()).toHaveLength(1)
    const row = comments()[0]
    expect(row).toMatchObject({
      conversationId: "conv_ayten", channelConfigId: CHANNEL.id, channelType: "instagram", direction: "inbound",
      from: PERSON, to: ACCOUNT, body: "Qiyməti neçədir? Bakıda haradan almaq olar?", externalId: "17900000000000001",
    })
    expect(storedInstagramComment(row.metadata)).toMatchObject({
      commentId: "17900000000000001", mediaId: POST_ID, username: "ayten.m",
      caption: "Noreva Xerodiane AP+ — quru dəri üçün krem", permalink: "https://www.instagram.com/p/Cx1/",
      // Our own copy of the picture: Meta's CDN address expires.
      imageUrl: `/uploads/inbox/${ORG}/post.jpg`,
    })
    // The conversation is back in the open queue, unread, and keeps the name from the profile.
    expect(db.conversations[0]).toMatchObject({
      status: "open", unreadCount: 1, contactName: "Aytən Məmmədova", assignedTo: "user_leyla",
      lastMessage: "Qiyməti neçədir? Bakıda haradan almaq olar?",
    })
    expect(notify.notifyConversationRecipients).toHaveBeenCalledTimes(1)
    // The post is read with the account's token in the header, never in the URL.
    const read = graph.find((c) => c.url.includes(`/${POST_ID}?fields=`))!
    expect(read.url).not.toContain("access_token")
    expect(read.init?.headers).toMatchObject({ Authorization: "Bearer ig-token" })
  })

  it("opens a conversation for someone who never wrote in Direct, under their username", async () => {
    await POST(signed(commentDelivery(customerComment({ from: { id: "999", username: "samir.q" }, text: "Uşaqlar üçün də olar?" }))))

    const conv = db.conversations.find((c) => c.externalId === "999")
    expect(conv).toMatchObject({ platform: "instagram", contactName: "samir.q", channelConfigId: CHANNEL.id })
    expect(comments()[0].conversationId).toBe(conv!.id)
  })

  it("reads the `changes[]` shape too", async () => {
    await POST(signed({ object: "instagram", entry: [{ id: ACCOUNT, changes: [{ field: "comments", value: customerComment() }] }] }))
    expect(comments()).toHaveLength(1)
  })

  it("is stored once when Meta redelivers it", async () => {
    await POST(signed(commentDelivery(customerComment())))
    await POST(signed(commentDelivery(customerComment())))
    expect(comments()).toHaveLength(1)
  })

  it("reads a post once: the next comment on it takes the card from the first", async () => {
    await POST(signed(commentDelivery(customerComment())))
    await POST(signed(commentDelivery(customerComment({ id: "17900000000000002", from: { id: "999", username: "samir.q" }, text: "Qiyməti?" }))))

    expect(graph.filter((c) => c.url.includes(`/${POST_ID}?fields=`))).toHaveLength(1)
    expect(storedInstagramComment(comments()[1].metadata)?.permalink).toBe("https://www.instagram.com/p/Cx1/")
  })

  it("leaves friend tags and emoji in Instagram — they wait for no answer", async () => {
    await POST(signed(commentDelivery(customerComment({ text: "@leyla_m @nigar.b 😍🔥" }))))
    expect(db.messages).toHaveLength(0)
    expect(db.conversations[0].unreadCount).toBe(0)
  })

  it("is never answered automatically: no keyword bot, no AI, no flow, and the backlog sweep skips it", async () => {
    db.channels = [{ ...CHANNEL, settings: { ...CHANNEL.settings, replyMode: "ai" } }]

    await POST(signed(commentDelivery(customerComment())))

    expect(bots.maybeAutoReply).not.toHaveBeenCalled()
    expect(events.emitConversationIngestEvents).not.toHaveBeenCalled()
    const batch = selectUncoveredAiInboundBatch(db.messages.map((m) => ({
      id: m.id, direction: m.direction, body: m.body, status: m.status, createdAt: m.createdAt, metadata: m.metadata,
    })))
    expect(batch).toHaveLength(0)
  })

  it("opens no Direct window: the hours since the person wrote ignore the comment", () => {
    const now = Date.parse("2026-11-16T12:00:00Z")
    const rows = [
      { direction: "inbound", channelType: "instagram", createdAt: "2026-11-14T12:00:00Z", metadata: {} },
      { direction: "inbound", channelType: "instagram", createdAt: "2026-11-16T11:00:00Z", metadata: { igComment: { commentId: "1" } } },
    ]
    expect(hoursSinceCustomerWrote(rows, "instagram", now)).toBe(48)
  })
})

describe("the account's own comments", () => {
  async function customerCommentStored() {
    await POST(signed(commentDelivery(customerComment())))
    return comments()[0]
  }

  it("an answer typed in the Instagram app shows under the customer's comment, as the team's", async () => {
    await customerCommentStored()

    await POST(signed(commentDelivery({
      id: "17900000000000050", from: { id: ACCOUNT, username: "noreva_azerbaijan" },
      text: "Salam! Qiyməti 24 AZN", media: { id: POST_ID }, parent_id: "17900000000000001",
    })))

    expect(outbound()).toHaveLength(1)
    expect(outbound()[0]).toMatchObject({
      conversationId: "conv_ayten", body: "Salam! Qiyməti 24 AZN", status: "sent", externalId: "17900000000000050",
      metadata: { source: "business_app", igCommentReply: { commentId: "17900000000000001", mode: "public" } },
    })
    expect(db.conversations[0].unreadCount).toBe(0)
    // It is not a customer's comment.
    expect(comments()).toHaveLength(1)
  }, 15_000) // the ingester looks for the CRM's own row twice (4 s) before it believes the app wrote it

  it("the echo of a public reply sent from the CRM is not written a second time", async () => {
    stubMeta()
    const comment = await customerCommentStored()

    await sendConversationReply({
      organizationId: ORG, channel: "instagram", to: PERSON, body: "Salam! Qiyməti 24 AZN", conversationId: "conv_ayten",
      channelConfigId: CHANNEL.id, extraMetadata: { authorType: "operator", authorName: "Leyla" },
      instagramComment: { commentId: "17900000000000001", inboundMessageId: comment.id, mode: "public", privateReplyAllowed: true },
    })
    await POST(signed(commentDelivery({
      id: "17900000000000099", from: { id: ACCOUNT, username: "noreva_azerbaijan" },
      text: "Salam! Qiyməti 24 AZN", media: { id: POST_ID }, parent_id: "17900000000000001",
    })))

    expect(outbound()).toHaveLength(1)
  })
})

describe("answering a comment from the inbox", () => {
  async function comment() {
    await POST(signed(commentDelivery(customerComment())))
    return comments()[0]
  }
  const send = (inboundMessageId: string, mode: "direct" | "public", privateReplyAllowed: boolean, extra: Row = {}) =>
    sendConversationReply({
      organizationId: ORG, channel: "instagram", to: PERSON, body: "Aptek ünvanlarını göndərirəm", conversationId: "conv_ayten",
      channelConfigId: CHANNEL.id, extraMetadata: { authorType: "operator", authorName: "Leyla" },
      instagramComment: { commentId: "17900000000000001", inboundMessageId, mode, privateReplyAllowed },
      ...extra,
    })

  it("in Direct: goes as the comment's private reply, and the comment remembers it was spent", async () => {
    const row = await comment()
    const result = await send(row.id, "direct", true)

    expect(result.success).toBe(true)
    const call = graph.find((c) => c.url.includes("/me/messages"))!
    expect(JSON.parse(String(call.init?.body))).toEqual({
      recipient: { comment_id: "17900000000000001" }, message: { text: "Aptek ünvanlarını göndərirəm" },
    })
    expect(outbound()[0]).toMatchObject({
      externalId: "mid.private1", metadata: { igCommentReply: { commentId: "17900000000000001", mode: "private" }, metaMessageIds: ["mid.private1"] },
    })
    expect(storedInstagramComment(comments()[0].metadata)?.privateReplyAt).toBeTruthy()
    expect(privateReplyAvailable(commentRow())).toBe(false)
  })

  it("in Direct once the private reply is spent: an ordinary Direct message to the person", async () => {
    const row = await comment()
    await send(row.id, "direct", false)

    const call = graph.find((c) => c.url.includes("/me/messages"))!
    expect(JSON.parse(String(call.init?.body))).toMatchObject({ recipient: { id: PERSON }, message: { text: "Aptek ünvanlarını göndərirəm" } })
    expect(outbound()[0].metadata).toMatchObject({ igCommentReply: { mode: "direct" } })
  })

  it("under the post: a public reply to that comment", async () => {
    const row = await comment()
    const result = await send(row.id, "public", true)

    expect(result.success).toBe(true)
    const call = graph.find((c) => c.url.endsWith("/replies"))!
    expect(call.url).toBe("https://graph.instagram.com/v21.0/17900000000000001/replies")
    expect(JSON.parse(String(call.init?.body))).toEqual({ message: "Aptek ünvanlarını göndərirəm" })
    expect(call.init?.headers).toMatchObject({ Authorization: "Bearer ig-token" })
    expect(outbound()[0]).toMatchObject({ externalId: "17900000000000099", metadata: { igCommentReply: { mode: "public", replyId: "17900000000000099" } } })
    // A public reply spends nothing.
    expect(privateReplyAvailable(commentRow())).toBe(true)
  })

  it("says why when Meta refuses the public reply, and records the failure", async () => {
    stubMeta((call) => call.url.endsWith("/replies")
      ? new Response(JSON.stringify({ error: { message: "The comment was deleted" } }), { status: 400 })
      : undefined)
    const row = await comment()
    const result = await send(row.id, "public", true)

    expect(result).toMatchObject({ success: false, error: "instagram comment reply failed: The comment was deleted" })
    expect(outbound()[0]).toMatchObject({ status: "failed" })
  })

  it("refuses a file as an answer to a comment, before calling Meta", async () => {
    const row = await comment()
    const before = graph.length
    const result = await send(row.id, "public", true, {
      attachment: { buffer: Buffer.from("x"), mime: "image/jpeg", filename: "a.jpg", url: "/uploads/inbox/a.jpg" },
    })

    expect(result).toMatchObject({ success: false, statusCode: 400, error: INSTAGRAM_COMMENT_TEXT_ONLY })
    expect(graph).toHaveLength(before)
  })
})

describe("the rules underneath", () => {
  it("parses only `comments`, not live broadcasts, and skips a comment without an author", () => {
    expect(instagramCommentEvents({ field: "live_comments", value: customerComment() })).toEqual([])
    expect(instagramCommentEvents({ field: "comments", value: { id: "1", text: "x" } })).toEqual([])
    expect(instagramCommentEvents({ field: "comments", value: customerComment({ parent_id: "5" }) })[0]).toMatchObject({
      commentId: "17900000000000001", fromId: PERSON, username: "ayten.m", mediaId: POST_ID, parentId: "5",
    })
  })

  it("tells words from tags and emoji, in Azerbaijani and Russian too", () => {
    expect(isNoiseComment("@leyla 😍")).toBe(true)
    expect(isNoiseComment("🔥🔥🔥!!!")).toBe(true)
    expect(isNoiseComment("")).toBe(true)
    expect(isNoiseComment("Qiyməti?")).toBe(false)
    expect(isNoiseComment("@leyla bax, əla krem")).toBe(false)
    expect(isNoiseComment("Сколько стоит?")).toBe(false)
    expect(isNoiseComment("+")).toBe(true)
    expect(isNoiseComment("5")).toBe(false)
  })

  it("a private reply is offered once, within 7 days of the comment", () => {
    const now = Date.parse("2026-11-16T12:00:00Z")
    const fresh = { createdAt: "2026-11-15T12:00:00Z", metadata: { igComment: { commentId: "1" } } }
    expect(privateReplyAvailable(fresh, now)).toBe(true)
    expect(privateReplyAvailable({ ...fresh, createdAt: "2026-11-09T11:00:00Z" }, now)).toBe(false)
    expect(privateReplyAvailable({ ...fresh, metadata: { igComment: { commentId: "1", privateReplyAt: "2026-11-15T13:00:00Z" } } }, now)).toBe(false)
    expect(privateReplyAvailable({ createdAt: fresh.createdAt, metadata: {} }, now)).toBe(false)
  })

  it("subscribes `comments` only for an account that granted the permission", () => {
    expect(instagramSubscribedFields(null)).toBe("messages")
    expect(instagramSubscribedFields(["instagram_business_basic", "instagram_business_manage_messages"])).toBe("messages")
    expect(instagramSubscribedFields(["instagram_business_manage_comments"])).toBe("messages,comments")
    expect(grantedInstagramScopes("a, b,c")).toEqual(["a", "b", "c"])
    expect(grantedInstagramScopes(["a"])).toEqual(["a"])
    expect(grantedInstagramScopes(undefined)).toBeNull()
  })

  it("does not ask every connecting account for the comments permission before Meta approves it", () => {
    // Flip together with Meta's approval of instagram_business_manage_comments (App Review).
    expect(COMMENTS_SCOPE_REQUESTED).toBe(false)
  })
})
