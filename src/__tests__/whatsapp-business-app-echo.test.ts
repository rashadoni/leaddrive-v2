import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The team answered from the phone — and the robot must not answer again.
 *
 * This is the whole point of storing `smb_message_echoes`, so the assertion is not «a row was
 * written» but «the real decision functions now stand down». The rows this writer produces are fed
 * to `selectUncoveredAiInboundBatch` — the actual reader the autonomous inbox agent uses — because
 * what prevents a second reply is not the row's existence but the row being shaped the way that
 * reader counts as coverage: outbound, status sent/delivered/read, no exact `inReplyToInboundId`.
 * A test asserting the shape of a prisma call would pass with any of those three wrong.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const db = vi.hoisted(() => ({
  messages: [] as Row[],
  conversations: [] as Row[],
  contacts: [] as Row[],
  seq: 0,
}))

function matches(row: Row, where: Row): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as Row[]).some((c) => matches(row, c))) return false
      continue
    }
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if ("in" in cond && !(cond.in as unknown[]).includes(row[key])) return false
      if ("contains" in cond && !String(row[key] ?? "").includes(String(cond.contains))) return false
      continue
    }
    if (row[key] !== cond) return false
  }
  return true
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findFirst: vi.fn(async ({ where }: Row) => db.contacts.find((c) => matches(c, where)) ?? null),
    },
    socialConversation: {
      findMany: vi.fn(async ({ where }: Row) => db.conversations.filter((c) => matches(c, where))),
      findFirst: vi.fn(async ({ where }: Row) => db.conversations.find((c) => matches(c, where)) ?? null),
      create: vi.fn(async ({ data }: Row) => {
        const clash = db.conversations.find((c) =>
          c.organizationId === data.organizationId && c.platform === data.platform && c.externalId === data.externalId)
        if (clash) {
          const error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
          throw error
        }
        const row = { id: `conv_${++db.seq}`, unreadCount: 0, status: "open", assignedTo: null, ...data }
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
      create: vi.fn(async ({ data }: Row) => {
        // The partial unique index of migration 20261109120000, in memory.
        const clash = db.messages.find((m) =>
          m.organizationId === data.organizationId && m.externalId === data.externalId
          && m.direction === "outbound" && m.channelType === "whatsapp"
          && (m.metadata?.source) === "business_app" && (data.metadata?.source) === "business_app")
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

// Prisma's own error class is what isDuplicateInsert narrows on; in this fake a plain object with
// the same code stands in for it, so the duplicate branch is exercised rather than mocked away.
vi.mock("@/lib/social/meta-inbound-idempotency", async () => {
  const actual = await vi.importActual<typeof import("@/lib/social/meta-inbound-idempotency")>("@/lib/social/meta-inbound-idempotency")
  return { ...actual, isDuplicateInsert: (e: unknown) => (e as Row)?.code === "P2002" }
})
vi.mock("@/lib/sanitize", () => ({ sanitizeLog: (s: string) => s, sanitizeForPrompt: (s: string) => s }))

import { ingestWhatsAppAppEcho } from "@/lib/inbox/whatsapp-app-echo"
import { selectUncoveredAiInboundBatch } from "@/lib/social/ai-autoreply"

const ORG = "org_1"
const CHANNEL = { id: "cfg_1", organizationId: ORG }
const CUSTOMER = "994501234567"
/** The customer wrote at 07:00; the salon answered from the phone ten minutes later. */
const INBOUND_AT = new Date("2026-11-09T07:00:00Z")
const ECHO_AT_UNIX = 1794208200 // 2026-11-09T07:10:00Z

/** The customer's message, exactly as the inbound webhook stores it. */
function inbound(body: string, at: Date, conversationId = "conv_customer") {
  const row = {
    id: `in_${++db.seq}`,
    organizationId: ORG,
    channelConfigId: CHANNEL.id,
    conversationId,
    direction: "inbound",
    channelType: "whatsapp",
    from: "Leyla",
    to: "system",
    body,
    status: "delivered",
    externalId: `wamid.in_${db.seq}`,
    createdAt: at,
    metadata: { waPhone: CUSTOMER, waMessageId: `wamid.in_${db.seq}` },
  }
  db.messages.push(row)
  return row
}

function echoPayload(overrides: Row = {}) {
  return {
    metadata: { display_phone_number: "994103180049", phone_number_id: "984538588084578" },
    contacts: [{ wa_id: CUSTOMER, user_id: "US.134912086553027" }],
    message_echoes: [{
      from: "994103180049",
      to: CUSTOMER,
      to_user_id: "US.134912086553027",
      id: "wamid.echo1",
      timestamp: String(ECHO_AT_UNIX),
      type: "text",
      text: { body: "Bəli, sabah 11:30 sizi gözləyirik" },
      ...overrides,
    }],
  }
}

/** What the backlog agent would do with this conversation right now. */
function uncovered(conversationId = "conv_customer") {
  const rows = db.messages
    .filter((m) => m.conversationId === conversationId)
    .map((m) => ({ id: m.id, direction: m.direction, body: m.body, status: m.status, createdAt: m.createdAt, metadata: m.metadata }))
  return selectUncoveredAiInboundBatch(rows)
}

beforeEach(() => {
  db.messages = []
  db.conversations = [{
    id: "conv_customer",
    organizationId: ORG,
    platform: "whatsapp",
    externalId: CUSTOMER,
    status: "open",
    assignedTo: null,
    unreadCount: 3,
    lastMessage: "Sabah 11:30 olar?",
    contactName: "Leyla",
  }]
  db.contacts = [{ id: "contact_1", organizationId: ORG, phone: `+${CUSTOMER}` }]
  db.seq = 0
})

describe("a reply typed in the WhatsApp Business app", () => {
  it("covers the customer's waiting message, so the backlog agent stops", async () => {
    inbound("Sabah 11:30 olar?", INBOUND_AT)
    expect(uncovered()).toHaveLength(1) // nobody has answered yet

    await ingestWhatsAppAppEcho({ channel: CHANNEL, value: echoPayload() })

    expect(uncovered()).toHaveLength(0)
  })

  it("is stored as an ordinary outbound message of this conversation", async () => {
    inbound("Sabah 11:30 olar?", INBOUND_AT)

    await ingestWhatsAppAppEcho({ channel: CHANNEL, value: echoPayload() })

    const row = db.messages.find((m) => m.externalId === "wamid.echo1")
    expect(row).toMatchObject({
      direction: "outbound",
      channelType: "whatsapp",
      // `sent` is what the coverage reader counts; `pending` would leave the turn open.
      status: "sent",
      conversationId: "conv_customer",
      contactId: "contact_1",
      body: "Bəli, sabah 11:30 sizi gözləyirik",
      to: CUSTOMER,
    })
    expect(row?.metadata).toMatchObject({ source: "business_app", sentFromBusinessApp: true, waPhone: CUSTOMER })
    // No exact inbound ids: this is a broad acknowledgement of everything said before it, which is
    // the only honest reading — we cannot know which message the human was answering.
    expect(row?.metadata).not.toHaveProperty("inReplyToInboundId")
    // The time it was actually sent, not the time we happened to receive the webhook. A row stamped
    // "now" would also make our 24-hour window readers and the agents' history lie.
    expect(row?.createdAt).toEqual(new Date("2026-11-09T07:10:00Z"))
  })

  it("does not touch the customer's side of the conversation", async () => {
    inbound("Sabah 11:30 olar?", INBOUND_AT)
    db.conversations[0].status = "resolved"

    await ingestWhatsAppAppEcho({ channel: CHANNEL, value: echoPayload() })

    const conv = db.conversations[0]
    // An echo is not a customer message: it must not reopen a closed thread, must not add an unread
    // badge and must not take ownership away from whoever has it.
    expect(conv.status).toBe("resolved")
    expect(conv.unreadCount).toBe(3)
    expect(conv.assignedTo).toBeNull()
    expect(conv.lastMessage).toBe("Bəli, sabah 11:30 sizi gözləyirik")
  })

  it("survives Meta redelivering the same echo", async () => {
    inbound("Sabah 11:30 olar?", INBOUND_AT)

    const first = await ingestWhatsAppAppEcho({ channel: CHANNEL, value: echoPayload() })
    const second = await ingestWhatsAppAppEcho({ channel: CHANNEL, value: echoPayload() })

    expect(first.stored).toBe(1)
    expect(second).toMatchObject({ stored: 0, duplicates: 1 })
    expect(db.messages.filter((m) => m.externalId === "wamid.echo1")).toHaveLength(1)
  })

  it("opens a thread when the team writes first to somebody who never wrote to us", async () => {
    db.conversations = []

    await ingestWhatsAppAppEcho({ channel: CHANNEL, value: echoPayload() })

    const conv = db.conversations[0]
    expect(conv).toMatchObject({ platform: "whatsapp", externalId: CUSTOMER, unreadCount: 0 })
    expect(db.messages.find((m) => m.externalId === "wamid.echo1")?.conversationId).toBe(conv.id)
  })

  it("finds a thread stored under the older «+» spelling instead of opening a second one", async () => {
    db.conversations = [{
      id: "conv_plus", organizationId: ORG, platform: "whatsapp", externalId: `+${CUSTOMER}`,
      status: "open", assignedTo: null, unreadCount: 0, lastMessage: "", contactName: "Leyla",
    }]

    await ingestWhatsAppAppEcho({ channel: CHANNEL, value: echoPayload() })

    expect(db.conversations).toHaveLength(1)
    expect(db.messages.find((m) => m.externalId === "wamid.echo1")?.conversationId).toBe("conv_plus")
  })

  it("keeps the thread when the user has a username and no phone number", async () => {
    db.conversations = []
    const value = echoPayload({ to: undefined, id: "wamid.echo_bsuid" })

    const result = await ingestWhatsAppAppEcho({ channel: CHANNEL, value })

    expect(result.stored).toBe(1)
    // The business-scoped user id is the only key Meta guarantees, so it becomes the thread key —
    // and the row carries no `waPhone`, because we do not have one to invent.
    expect(db.conversations[0].externalId).toBe("US.134912086553027")
    expect(db.messages.find((m) => m.externalId === "wamid.echo_bsuid")?.metadata.waPhone).toBeUndefined()
  })

  it("describes a photo sent from the phone the same way an incoming photo is described", async () => {
    await ingestWhatsAppAppEcho({ channel: CHANNEL, value: echoPayload({ type: "image", text: undefined, image: {}, id: "wamid.img" }) })

    expect(db.messages.find((m) => m.externalId === "wamid.img")).toMatchObject({
      body: "[Изображение]",
      messageType: "image",
    })
  })
})

describe("the team editing or deleting their own message on the phone", () => {
  it("rewrites the stored reply when it is edited", async () => {
    inbound("Sabah 11:30 olar?", INBOUND_AT)
    await ingestWhatsAppAppEcho({ channel: CHANNEL, value: echoPayload() })

    await ingestWhatsAppAppEcho({
      channel: CHANNEL,
      value: echoPayload({
        id: "wamid.echo_edit",
        type: "edit",
        text: undefined,
        edit: { original_message_id: "wamid.echo1", message: { type: "text", text: { body: "Bəli, sabah 12:00" } } },
      }),
    })

    const row = db.messages.find((m) => m.externalId === "wamid.echo1")
    expect(row?.body).toBe("Bəli, sabah 12:00")
    expect(row?.metadata).toMatchObject({ editedFromBusinessApp: true, bodyBeforeEdit: "Bəli, sabah 11:30 sizi gözləyirik" })
    // An edit is one message, not two: no second row appears in the thread.
    expect(db.messages.filter((m) => m.direction === "outbound")).toHaveLength(1)
  })

  it("records a deletion without handing the turn back to the robot", async () => {
    inbound("Sabah 11:30 olar?", INBOUND_AT)
    await ingestWhatsAppAppEcho({ channel: CHANNEL, value: echoPayload() })

    await ingestWhatsAppAppEcho({
      channel: CHANNEL,
      value: echoPayload({
        id: "wamid.echo_revoke",
        type: "revoke",
        text: undefined,
        revoke: { original_message_id: "wamid.echo1" },
      }),
    })

    const row = db.messages.find((m) => m.externalId === "wamid.echo1")
    expect(row?.metadata).toMatchObject({ revokedFromBusinessApp: true })
    expect(row?.status).toBe("sent")
    // Deliberate: a deletion is the team changing what the customer sees, not a request for an
    // automatic reply. Giving coverage back here would send a real message, and that is not undoable.
    expect(uncovered()).toHaveLength(0)
  })

  it("skips an edit or deletion of a message it has never seen", async () => {
    const result = await ingestWhatsAppAppEcho({
      channel: CHANNEL,
      value: echoPayload({ id: "wamid.x", type: "revoke", text: undefined, revoke: { original_message_id: "wamid.unknown" } }),
    })

    expect(result).toMatchObject({ skipped: 1, stored: 0, revoked: 0 })
    expect(db.messages).toHaveLength(0)
  })
})
