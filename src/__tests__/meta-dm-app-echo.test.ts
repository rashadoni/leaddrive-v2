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

const db = vi.hoisted(() => ({ messages: [] as Row[], conversations: [] as Row[], channels: [] as Row[], seq: 0 }))

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
      if ("lte" in cond && !(row[key] <= cond.lte)) return false
      continue
    }
    if (row[key] !== cond) return false
  }
  return true
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: { findMany: vi.fn(async () => db.channels) },
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

vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => fn(),
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
}))

import { ingestMetaDmEcho } from "@/lib/inbox/meta-dm-app-echo"
import { backfillInstagramAppReplies } from "@/lib/inbox/instagram-app-replies-backfill"
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

/**
 * The replies typed in the app before the webhook kept them: read from Instagram's own history.
 * What matters is the thread afterwards — the reply is there once, a reply the CRM sent that day
 * (and kept no id for) is not doubled, and a customer who wrote again later is still unread.
 */
describe("replies brought in from the account's Instagram history", () => {
  const HOUR = 3_600_000
  const t = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR)
  const iso = (d: Date) => d.toISOString()

  function history(messages: Row[], updated = t(1)) {
    const page = {
      data: [{
        updated_time: iso(updated),
        participants: { data: [{ id: ACCOUNT }, { id: CUSTOMER }] },
        // Graph returns newest first.
        messages: { data: messages.slice().reverse() },
      }],
    }
    return vi.fn(async () => new Response(JSON.stringify(page), { status: 200 })) as unknown as typeof fetch
  }
  const fromAccount = (id: string, at: Date, message: string, extra: Row = {}) =>
    ({ id, created_time: iso(at), from: { id: ACCOUNT }, to: { data: [{ id: CUSTOMER }] }, message, ...extra })
  const fromCustomer = (id: string, at: Date, message: string) =>
    ({ id, created_time: iso(at), from: { id: CUSTOMER }, to: { data: [{ id: ACCOUNT }] }, message })

  const run = (fetchImpl: typeof fetch, dryRun = false) =>
    backfillInstagramAppReplies({ organizationId: ORG, since: t(72), dryRun, fetchImpl })

  beforeEach(() => {
    db.channels = [{ ...CHANNEL }]
    db.conversations[0].lastMessageAt = t(50)
  })

  it("puts yesterday's phone reply into the thread at the time it was sent", async () => {
    const sentAt = t(49)
    const report = await run(history([
      fromCustomer("mid.q", t(50), "Xırdalanda var?"),
      fromAccount("mid.a", sentAt, "Bəli, var"),
    ]))

    expect(report).toMatchObject({ channels: 1, accountMessages: 1, stored: 1, alreadyKnown: 0, errors: [] })
    const row = outboundRows()[0]
    expect(row).toMatchObject({ body: "Bəli, var", status: "sent", conversationId: "conv_customer", externalId: "mid.a" })
    expect(row.createdAt).toEqual(sentAt)
    expect(db.conversations[0]).toMatchObject({ unreadCount: 0, lastMessage: "Bəli, var" })
  })

  it("does not double a reply the CRM sent that day without keeping Meta's id", async () => {
    crmReply("Əlaqə nömrənizi qeyd edin", { createdAt: new Date(t(30).getTime() + 2_000) })

    const report = await run(history([fromAccount("mid.crm", t(30), "Əlaqə nömrənizi qeyd edin")]))

    expect(report).toMatchObject({ stored: 0, alreadyKnown: 1 })
    expect(outboundRows()).toHaveLength(1)
  })

  it("changes nothing when it is run a second time", async () => {
    const pages = [fromAccount("mid.a", t(49), "Bəli, var"), fromAccount("mid.b", t(48), "Buyurun")]
    await run(history(pages))

    const again = await run(history(pages))

    expect(again).toMatchObject({ stored: 0, alreadyKnown: 2 })
    expect(outboundRows()).toHaveLength(2)
  })

  it("leaves the unread badge when the customer wrote again after that reply", async () => {
    db.conversations[0].lastMessageAt = t(2) // the customer's newer message, already in the CRM
    db.conversations[0].lastMessage = "Bəs qiyməti?"

    await run(history([fromAccount("mid.a", t(49), "Bəli, var")]))

    expect(db.conversations[0]).toMatchObject({ unreadCount: 3, lastMessage: "Bəs qiyməti?" })
    expect(outboundRows()).toHaveLength(1)
  })

  it("writes nothing in a dry run and says what it would write", async () => {
    crmReply("Salam", { createdAt: new Date(t(30).getTime() + 2_000) })

    const report = await run(history([
      fromAccount("mid.crm", t(30), "Salam"),
      fromAccount("mid.a", t(29), "Bəli, var"),
    ]), true)

    expect(report).toMatchObject({ dryRun: true, stored: 1, alreadyKnown: 1 })
    expect(outboundRows()).toHaveLength(1)
    expect(outboundRows()[0].metadata.echoMid).toBeUndefined()
    expect(db.conversations[0].unreadCount).toBe(3)
  })

  it("takes only what the account sent inside the period, and never the customer's messages", async () => {
    const report = await run(history([
      fromAccount("mid.old", t(200), "köhnə cavab"),
      fromCustomer("mid.q", t(50), "Xırdalanda var?"),
      fromAccount("mid.a", t(49), "Bəli, var"),
    ]))

    expect(report).toMatchObject({ accountMessages: 1, stored: 1 })
    expect(db.messages.map((m) => m.externalId)).toEqual(["mid.a"])
  })

  it("keeps a photo sent from the phone and skips a message Instagram cannot show", async () => {
    media.fetchAndStoreMetaMedia.mockResolvedValue({ url: `/uploads/inbox/${ORG}/cc33dd44.jpg`, kind: "image" })

    const report = await run(history([
      fromAccount("mid.photo", t(49), "", { attachments: { data: [{ image_data: { url: "https://lookaside.fbsbx.com/x" } }] } }),
      fromAccount("mid.none", t(48), "", { is_unsupported: true }),
    ]))

    expect(report).toMatchObject({ stored: 1, skipped: 1 })
    expect(outboundRows()[0]).toMatchObject({ mediaUrl: `/uploads/inbox/${ORG}/cc33dd44.jpg`, messageType: "image" })
  })

  it("reports Instagram's refusal instead of writing anything", async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), { status: 400 })) as unknown as typeof fetch

    const report = await run(refused)

    expect(report.errors).toHaveLength(1)
    expect(outboundRows()).toHaveLength(0)
  })
})
