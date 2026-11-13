import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The team answered in the Instagram app — and the CRM thread must show it, once.
 *
 * Zeytun Pharma, 11–12 Nov 2026: 76 customer messages in the inbox and not one answer under them,
 * though every one had been answered from the phone. Both Meta webhooks dropped the echo on their
 * first line. The assertions here are about what the inbox and the AI would then do: the reply is
 * in the thread, the unread badge is gone, the backlog agent stands down — and a reply sent from
 * the CRM itself, whose echo Meta also delivers, does not appear twice.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const db = vi.hoisted(() => ({ messages: [] as Row[], conversations: [] as Row[], seq: 0 }))

function matches(row: Row, where: Row): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as Row[]).some((c) => matches(row, c))) return false
      continue
    }
    if (key === "metadata") {
      const { path, array_contains } = cond as { path: string[]; array_contains: unknown }
      const value = row.metadata?.[path[0]]
      if (!Array.isArray(value) || !value.includes(array_contains)) return false
      continue
    }
    if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
      if ("gte" in cond && !(row[key] >= cond.gte)) return false
      continue
    }
    if (row[key] !== cond) return false
  }
  return true
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: {
      findUnique: vi.fn(async ({ where }: Row) => {
        const k = where.organizationId_platform_externalId
        return db.conversations.find((c) => c.organizationId === k.organizationId && c.platform === k.platform && c.externalId === k.externalId) ?? null
      }),
      create: vi.fn(async ({ data }: Row) => {
        const row = { id: `conv_${++db.seq}`, unreadCount: 0, status: "open", ...data }
        db.conversations.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }: Row) => {
        const row = db.conversations.find((c) => c.id === where.id)
        if (row) Object.assign(row, data)
        return row
      }),
    },
    channelMessage: {
      findFirst: vi.fn(async ({ where }: Row) => db.messages.find((m) => matches(m, where)) ?? null),
      findMany: vi.fn(async ({ where }: Row) =>
        db.messages.filter((m) => matches(m, where)).sort((a, b) => a.createdAt - b.createdAt)),
      create: vi.fn(async ({ data }: Row) => {
        // The partial unique index of migration 20261215100000, in memory.
        const clash = db.messages.find((m) =>
          m.organizationId === data.organizationId && m.externalId === data.externalId
          && m.direction === "outbound" && m.metadata?.source === "business_app" && data.metadata?.source === "business_app")
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
  },
}))
vi.mock("@/lib/social/meta-inbound-idempotency", async () => {
  const actual = await vi.importActual<typeof import("@/lib/social/meta-inbound-idempotency")>("@/lib/social/meta-inbound-idempotency")
  return { ...actual, isDuplicateInsert: (e: unknown) => (e as Row)?.code === "P2002" }
})
vi.mock("@/lib/sanitize", () => ({ sanitizeLog: (s: string) => s, sanitizeForPrompt: (s: string) => s }))
const media = vi.hoisted(() => ({ fetchAndStoreMetaMedia: vi.fn() }))
vi.mock("@/lib/inbox/meta-media", () => media)
vi.mock("@/lib/social/meta-sender-profile", () => ({ resolveMetaSenderName: vi.fn(async () => "aysel.m") }))

import { ingestMetaDmEcho } from "@/lib/inbox/meta-dm-app-echo"
import { selectUncoveredAiInboundBatch } from "@/lib/social/ai-autoreply"

const ORG = "org_zeytun"
const ACCOUNT = "17841415438663095"
const CUSTOMER = "1318586653085202"
const CHANNEL = { id: "cfg_ig", organizationId: ORG, apiKey: "ig-token", pageId: ACCOUNT, settings: { igLogin: true } }

function echo(overrides: Row = {}, message: Row = {}) {
  return {
    sender: { id: ACCOUNT },
    recipient: { id: CUSTOMER },
    timestamp: Date.now() - 60_000,
    message: { mid: "mid.app1", text: "Bəli, Xırdalan filialında var", is_echo: true, ...message },
    ...overrides,
  }
}

const ingest = (event: Row, retryDelaysMs: number[] = []) =>
  ingestMetaDmEcho({ channel: CHANNEL, platform: "instagram", accountId: ACCOUNT, event, retryDelaysMs })

/** The customer's question, as the inbound webhook stores it. */
function inbound(body: string) {
  db.messages.push({
    id: `in_${++db.seq}`, organizationId: ORG, channelConfigId: CHANNEL.id, conversationId: "conv_customer",
    direction: "inbound", channelType: "instagram", from: CUSTOMER, to: ACCOUNT, body, status: "delivered",
    externalId: `mid.in_${db.seq}`, createdAt: new Date(Date.now() - 3_600_000), metadata: { senderId: CUSTOMER },
  })
}

/** A reply the CRM itself sent, as send-conversation-reply records it. */
function crmReply(body: string, extra: Row = {}) {
  const row: Row = {
    id: `out_${++db.seq}`, organizationId: ORG, channelConfigId: CHANNEL.id, conversationId: "conv_customer",
    direction: "outbound", channelType: "instagram", from: "system", to: CUSTOMER, body, status: "delivered",
    externalId: null, createdAt: new Date(), metadata: { sentVia: "leaddrive_inbox" }, ...extra,
  }
  db.messages.push(row)
  return row
}

const outboundRows = () => db.messages.filter((m) => m.direction === "outbound")

function uncovered() {
  return selectUncoveredAiInboundBatch(db.messages
    .filter((m) => m.conversationId === "conv_customer")
    .map((m) => ({ id: m.id, direction: m.direction, body: m.body, status: m.status, createdAt: m.createdAt, metadata: m.metadata })))
}

beforeEach(() => {
  db.messages = []
  db.conversations = [{
    id: "conv_customer", organizationId: ORG, platform: "instagram", externalId: CUSTOMER,
    status: "open", assignedTo: "user_narmin", unreadCount: 3, lastMessage: "Xırdalanda var?",
    lastMessageAt: new Date(Date.now() - 3_600_000), contactName: "aysel.m",
  }]
  db.seq = 0
  media.fetchAndStoreMetaMedia.mockReset()
  media.fetchAndStoreMetaMedia.mockResolvedValue(null)
})

describe("a reply typed in the Instagram app", () => {
  it("appears in the customer's thread as the team's answer", async () => {
    inbound("Xırdalanda var?")

    expect(await ingest(echo())).toBe("stored")

    const row = outboundRows()[0]
    expect(row).toMatchObject({
      direction: "outbound", channelType: "instagram", status: "sent", conversationId: "conv_customer",
      to: CUSTOMER, from: ACCOUNT, body: "Bəli, Xırdalan filialında var", externalId: "mid.app1",
    })
    expect(row.metadata).toMatchObject({ source: "business_app", sentFromBusinessApp: true })
  })

  it("clears the unread badge and shows as the last message, without reassigning or reopening", async () => {
    inbound("Xırdalanda var?")
    db.conversations[0].status = "closed"

    await ingest(echo())

    expect(db.conversations[0]).toMatchObject({
      unreadCount: 0, lastMessage: "Bəli, Xırdalan filialında var", assignedTo: "user_narmin", status: "closed",
    })
  })

  it("covers the waiting question, so the AI does not answer the customer a second time", async () => {
    inbound("Xırdalanda var?")
    expect(uncovered()).toHaveLength(1)

    await ingest(echo())

    expect(uncovered()).toHaveLength(0)
  })

  it("is stored once when Meta redelivers the webhook", async () => {
    await ingest(echo())
    expect(await ingest(echo())).toBe("duplicate")
    expect(outboundRows()).toHaveLength(1)
  })

  it("keeps a photo sent from the app, typed as a picture", async () => {
    media.fetchAndStoreMetaMedia.mockResolvedValue({ url: `/uploads/inbox/${ORG}/aa11bb22.jpg`, kind: "image" })

    await ingest(echo({}, { text: undefined, attachments: [{ type: "image", payload: { url: "https://lookaside.fbsbx.com/x" } }] }))

    expect(outboundRows()[0]).toMatchObject({ mediaUrl: `/uploads/inbox/${ORG}/aa11bb22.jpg`, messageType: "image" })
  })

  it("opens a thread when the team wrote first to somebody who never wrote to us", async () => {
    db.conversations = []

    await ingest(echo())

    expect(db.conversations).toHaveLength(1)
    expect(db.conversations[0]).toMatchObject({ platform: "instagram", externalId: CUSTOMER, contactName: "aysel.m", unreadCount: 0 })
    expect(outboundRows()[0].conversationId).toBe(db.conversations[0].id)
  })

  it("ignores a deleted message and an echo with nothing in it", async () => {
    expect(await ingest(echo({}, { is_deleted: true }))).toBe("skipped")
    expect(await ingest(echo({}, { text: undefined }))).toBe("skipped")
    expect(outboundRows()).toHaveLength(0)
  })
})

describe("the echo of a reply the CRM sent itself", () => {
  it("is recognised by Meta's message id and writes no second row", async () => {
    crmReply("Əlaqə nömrənizi qeyd edin", { externalId: "mid.crm1" })

    expect(await ingest(echo({}, { mid: "mid.crm1", text: "Əlaqə nömrənizi qeyd edin" }))).toBe("own_send")
    expect(outboundRows()).toHaveLength(1)
  })

  it("is recognised when the id is the caption's — one CRM message that went out as a file and its text", async () => {
    crmReply("Budur", { externalId: "mid.file", metadata: { metaMessageIds: ["mid.file", "mid.caption"] } })

    expect(await ingest(echo({}, { mid: "mid.caption", text: "Budur" }))).toBe("own_send")
    expect(outboundRows()).toHaveLength(1)
  })

  it("is recognised by its words when the sender kept no id (auto-reply, AI)", async () => {
    const row = crmReply("Salam! Necə kömək edə bilərik?")

    expect(await ingest(echo({}, { mid: "mid.ai1", text: "Salam! Necə kömək edə bilərik?" }))).toBe("own_send")
    expect(outboundRows()).toHaveLength(1)
    expect(row.metadata.echoMid).toBe("mid.ai1")
  })

  it("is recognised when the echo outruns the row our send is about to write", async () => {
    setTimeout(() => crmReply("Bu məhsul hazırda yoxdur"), 20)

    expect(await ingest(echo({}, { mid: "mid.fast", text: "Bu məhsul hazırda yoxdur" }), [60])).toBe("own_send")
    expect(outboundRows()).toHaveLength(1)
  })

  it("does not swallow the same words typed in the app after the CRM said them", async () => {
    crmReply("Bəli")
    expect(await ingest(echo({}, { mid: "mid.crm", text: "Bəli" }))).toBe("own_send")

    // The second "Bəli" has no row of ours left to claim: somebody typed it on the phone.
    expect(await ingest(echo({}, { mid: "mid.phone", text: "Bəli" }))).toBe("stored")
    expect(outboundRows()).toHaveLength(2)
  })

  it("does not mistake an old CRM message with the same words for this echo", async () => {
    crmReply("Bəli", { createdAt: new Date(Date.now() - 3 * 3_600_000) })

    expect(await ingest(echo({}, { mid: "mid.phone", text: "Bəli" }))).toBe("stored")
  })
})
