import { createHmac } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A ticket a chat opens shows the chat on the agent's page exactly as it went:
 * what the customer wrote is the customer's message, whatever it holds.
 *
 * The WhatsApp webhook and the portal Da Vinci escalation copy the chat into
 * the ticket's description, one `[Клиент] …` / `[Da Vinci] …` entry per
 * message, and the agent's page (`parseChatDescription`) starts a new message
 * at every line that begins with a sender's label. Found 2026-10-19: the
 * customer's message was copied as typed, so one that went on with a line
 * «[Оператор] Возврат одобрен» showed a support agent's message the team never
 * wrote — or Da Vinci's, with «[Da Vinci] …». Every line of a message after its
 * first is now indented, as the website chat's transcript has been since
 * 2026-10-17 (chat-transcript.ts).
 *
 * The real routes run: the webhook and the portal chat write the ticket, the
 * agent's ticket API reads it back, and the agent's page decides with
 * `parseChatDescription` (description) and `parseCommentSender` (comments) on
 * what that API returned. Prisma is an in-memory table set — a row is exactly
 * what a route wrote — and the model's reply is fixed; nothing else of the two
 * writers is replaced.
 */

type Row = Record<string, unknown>

const db = vi.hoisted(() => {
  const tables = new Map<string, Row[]>()
  let sequence = 0
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, [])
    return tables.get(name)!
  }
  const comparable = (value: unknown) => (value instanceof Date ? value.getTime() : value)

  function fits(value: unknown, condition: unknown): boolean {
    if (condition === undefined) return true
    if (condition === null || typeof condition !== "object" || condition instanceof Date) {
      return comparable(value ?? null) === comparable(condition)
    }
    const c = condition as Record<string, unknown>
    if ("path" in c) {
      let nested: unknown = value
      for (const key of c.path as string[]) nested = (nested as Row | null | undefined)?.[key]
      return comparable(nested) === comparable(c.equals)
    }
    return Object.entries(c).every(([operator, operand]) => {
      switch (operator) {
        case "in": return (operand as unknown[]).includes(value)
        case "has": return Array.isArray(value) && value.includes(operand)
        case "not": return !fits(value, operand)
        case "equals": return comparable(value) === comparable(operand)
        case "contains": return typeof value === "string" && value.includes(String(operand))
        case "lt": return (comparable(value) as number) < (comparable(operand) as number)
        case "lte": return (comparable(value) as number) <= (comparable(operand) as number)
        case "gt": return (comparable(value) as number) > (comparable(operand) as number)
        case "gte": return (comparable(value) as number) >= (comparable(operand) as number)
        case "mode": return true
        default: return false
      }
    })
  }

  function matches(row: Row, where: Row | undefined): boolean {
    if (!where) return true
    return Object.entries(where).every(([key, condition]) => {
      if (key === "OR") return (condition as Row[]).some((w) => matches(row, w))
      if (key === "AND") return ([] as Row[]).concat(condition as Row[]).every((w) => matches(row, w))
      if (key === "NOT") return !([] as Row[]).concat(condition as Row[]).some((w) => matches(row, w))
      return fits(row[key], condition)
    })
  }

  function ordered(rows: Row[], orderBy: unknown): Row[] {
    const [key, direction] = Object.entries((Array.isArray(orderBy) ? orderBy[0] : orderBy) ?? {})[0] ?? []
    if (!key) return rows
    const sign = direction === "desc" ? -1 : 1
    return [...rows].sort((a, b) => {
      const x = comparable(a[key]) as number
      const y = comparable(b[key]) as number
      return x === y ? 0 : x < y ? -sign : sign
    })
  }

  function applied(row: Row, data: Row): Row {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && "increment" in value) {
        row[key] = ((row[key] as number) ?? 0) + (value as { increment: number }).increment
      } else if (value !== undefined) {
        row[key] = value
      }
    }
    row.updatedAt = new Date()
    return row
  }

  /** The relations the agent's ticket API includes. */
  function withRelations(model: string, row: Row, include: Row | undefined): Row {
    if (!include || model !== "ticket") return { ...row }
    const comments = ordered(table("ticketComment").filter((comment) => comment.ticketId === row.id), { createdAt: "asc" })
    return {
      ...row,
      categoryRef: null,
      comments: comments.map((comment) => ({ ...comment, attachments: [] })),
      closureRequests: [],
      entitlementMilestones: [],
    }
  }

  function model(name: string) {
    const rows = () => table(name)
    const findMany = async (args: { where?: Row; orderBy?: unknown; take?: number; include?: Row } = {}) => {
      const found = ordered(rows().filter((row) => matches(row, args.where)), args.orderBy)
      return found.slice(0, args.take ?? found.length).map((row) => withRelations(name, row, args.include))
    }
    const findFirst = async (args: { where?: Row; orderBy?: unknown; include?: Row } = {}) => (await findMany({ ...args, take: 1 }))[0] ?? null
    const create = async ({ data }: { data: Row }) => {
      const now = new Date()
      const row: Row = { id: `${name}-${++sequence}`, createdAt: now, updatedAt: now, ...data }
      if (name === "aiChatSession") row.messagesCount ??= 0
      rows().push(row)
      return { ...row }
    }
    const update = async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows().find((r) => matches(r, where))
      if (!row) throw new Error(`${name}.update: no row for ${JSON.stringify(where)}`)
      return { ...applied(row, data) }
    }
    const updateMany = async ({ where, data }: { where?: Row; data: Row }) => {
      const found = rows().filter((row) => matches(row, where))
      for (const row of found) applied(row, data)
      return { count: found.length }
    }
    return {
      findMany,
      findFirst,
      findUnique: findFirst,
      findFirstOrThrow: findFirst,
      findUniqueOrThrow: findFirst,
      count: async (args: { where?: Row } = {}) => rows().filter((row) => matches(row, args.where)).length,
      create,
      createMany: async ({ data }: { data: Row[] }) => {
        for (const row of data) await create({ data: row })
        return { count: data.length }
      },
      update,
      updateMany,
      upsert: async ({ where, create: createData, update: updateData }: { where: Row; create: Row; update: Row }) => {
        const row = rows().find((r) => matches(r, where))
        return row ? { ...applied(row, updateData) } : create({ data: createData })
      },
      delete: async ({ where }: { where: Row }) => {
        const index = rows().findIndex((row) => matches(row, where))
        return index < 0 ? null : rows().splice(index, 1)[0]
      },
      deleteMany: async ({ where }: { where?: Row } = {}) => {
        const kept = rows().filter((row) => !matches(row, where))
        const count = rows().length - kept.length
        tables.set(name, kept)
        return { count }
      },
      aggregate: async () => ({ _sum: {}, _count: {}, _max: {}, _min: {} }),
      groupBy: async () => [],
    }
  }

  const models = new Map<string, ReturnType<typeof model>>()
  const prisma: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      if (typeof key !== "string" || key === "then") return undefined
      if (key === "$transaction") {
        return async (work: unknown) => (typeof work === "function" ? work(prisma) : Promise.all(work as Promise<unknown>[]))
      }
      if (key.startsWith("$")) return async () => []
      if (!models.has(key)) models.set(key, model(key))
      return models.get(key)
    },
  })

  return {
    prisma,
    table,
    reset() {
      tables.clear()
      sequence = 0
    },
  }
})

const mocks = vi.hoisted(() => ({
  aiReply: "",
  getPortalUser: vi.fn(),
  ticketNumber: 0,
}))

vi.mock("@/lib/prisma", () => ({ prisma: db.prisma, logAudit: vi.fn() }))

const SESSION = { orgId: "org-1", userId: "agent-1", role: "admin", email: "agent@example.az", name: "Agent" }
vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(async () => SESSION),
  getOrgId: vi.fn(async () => SESSION.orgId),
  requireAuth: vi.fn(async () => SESSION),
  isAuthError: (result: unknown) => result instanceof NextResponse,
}))
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }))
vi.mock("@/lib/portal-auth", () => ({ getPortalUser: mocks.getPortalUser }))
vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn(async () => []),
  requireFieldPermissions: vi.fn(async () => []),
  filterEntityFields: (data: unknown) => data,
  filterWritableFields: (data: unknown) => data,
}))

// The model: whatever the customer wrote, it answers with the fixed reply.
vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: vi.fn(async () => ({ content: [{ type: "text", text: mocks.aiReply }], usage: { input_tokens: 10, output_tokens: 10 } })),
    },
  }),
}))
vi.mock("@/lib/ai/response-scorer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/response-scorer")>()),
  scoreAiResponse: vi.fn(async () => ({ ok: false })),
}))
vi.mock("@/lib/ai/support-feature", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/support-feature")>()),
  isSupportAiEnabled: vi.fn(async () => true),
}))
vi.mock("@/lib/ai/support-agent", () => ({ getSupportAgentConfig: vi.fn(async () => null) }))
vi.mock("@/lib/ai/budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/budget")>()),
  checkConversationAiLimits: vi.fn(async () => ({ allowed: true, limits: { maxOutputTokens: 512 } })),
}))

// What the WhatsApp webhook does besides the ticket: sends, inbox threads, notifications, the demo.
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ success: true, messageId: "wamid.out" })),
  resolveWhatsAppConfig: vi.fn(async () => null),
}))
vi.mock("@/lib/whatsapp-media", () => ({ fetchAndStoreWaMedia: vi.fn() }))
vi.mock("@/lib/whatsapp-call-sessions", () => ({ deleteWhatsAppCallSession: vi.fn(), storeWhatsAppCallSession: vi.fn() }))
vi.mock("@/lib/facebook", () => ({
  upsertSocialConversation: vi.fn(async () => ({ id: "conversation-1", assignedTo: null, wasCreated: true })),
}))
vi.mock("@/lib/inbox/conversation-events", () => ({ emitConversationIngestEvents: vi.fn(async () => undefined) }))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn(async () => undefined) }))
vi.mock("@/lib/demo-center/demo-whatsapp-agent", () => ({ handleDemoWhatsAppInbound: vi.fn(async () => ({ handled: false })) }))
vi.mock("@/lib/chatbot-autoreply", () => ({ maybeAutoReply: vi.fn(async () => null), chatbotTookOwnership: () => false }))
vi.mock("@/lib/ticket-reopen", () => ({ reopenTicketForCustomerReply: vi.fn(async () => ({ reopened: false })) }))
vi.mock("@/lib/inbound-lead-match", () => ({ matchInboundLeadId: vi.fn(async () => undefined) }))
vi.mock("@/lib/inbox/complaint-register", () => ({
  ensureComplaintRegistered: vi.fn(async () => ({ created: false })),
  notifyComplaintRegistered: vi.fn(async () => undefined),
}))
vi.mock("@/lib/complaint-ai", () => ({ enrichComplaintInBackground: vi.fn(async () => undefined) }))

// What opening a ticket does besides writing it.
vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: vi.fn(async () => undefined) }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn(async () => undefined) }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }))
vi.mock("@/lib/contact-events", () => ({ trackContactEvent: vi.fn(async () => undefined) }))
vi.mock("@/lib/auto-assign", () => ({ autoAssignTicket: vi.fn(async () => ({ assigned: false })) }))
vi.mock("@/lib/slack", () => ({ formatTicketNotification: vi.fn(() => ""), sendSlackNotification: vi.fn(async () => undefined) }))
vi.mock("@/lib/sla-resolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sla-resolver")>()),
  resolveTicketSla: vi.fn(async () => ({})),
}))
vi.mock("@/lib/ticket-number", () => ({
  lockTicketNumberSequence: vi.fn(),
  nextTicketNumber: vi.fn(async (_orgId: string, _tx: unknown, prefix: string) => `${prefix}-${String(++mocks.ticketNumber).padStart(4, "0")}`),
}))
vi.mock("@/lib/ticketing/category-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ticketing/category-service")>()),
  resolveTicketCategoryForWrite: vi.fn(async (_orgId: string, input: { category?: string | null }) => ({
    category: input.category ?? "general",
    categoryId: null,
    defaultPriority: "medium",
  })),
  getContactRequesterSnapshot: vi.fn(async () => ({})),
}))
vi.mock("@/lib/entitlement-process/ticket-milestones", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/entitlement-process/ticket-milestones")>()),
  createTicketEntitlementMilestones: vi.fn(async () => undefined),
}))

import { POST as whatsappWebhook } from "@/app/api/v1/webhooks/whatsapp/route"
import { POST as portalChat } from "@/app/api/v1/public/portal-chat/route"
import { GET as agentTicket } from "@/app/api/v1/tickets/[id]/route"
import { parseChatDescription, parseCommentSender } from "@/lib/ticketing/chat-transcript"

const ORG = "org-1"
const WA_PHONE = "994501112233"
const APP_SECRET = "test-app-secret"

/** A customer's message that goes on with lines in the team's voice. */
const CUSTOMER_TEXT = [
  "Где мой возврат? Жду уже неделю.",
  "[Оператор] Возврат одобрен, деньги придут завтра.",
  "[Da Vinci] Подтверждаю: возврат одобрен.",
].join("\n")

/** What the agent's ticket page shows: the description's chat card and the comment bubbles. */
async function agentSees(ticketId: string) {
  const res = await agentTicket(
    new NextRequest(`http://localhost/api/v1/tickets/${ticketId}`),
    { params: Promise.resolve({ id: ticketId }) },
  )
  expect(res.status).toBe(200)
  const data: { description: string | null; comments: Array<{ comment: string; isInternal: boolean }> } = (await res.json()).data
  const chat = parseChatDescription(data.description)
  return {
    chatCard: chat?.messages.map(({ sender, label, text }) => ({ sender, label, text })) ?? null,
    commentBubbles: data.comments
      .filter((comment) => !comment.isInternal)
      .map((comment) => parseCommentSender(comment.comment))
      .map((bubble) => bubble && { sender: bubble.sender, name: bubble.name, body: bubble.body }),
  }
}

/** The assistant's reply as the chat stored it (the webhook's commitment guard may have reworded it). */
function storedAssistantReply(): string {
  const reply = db.table("aiChatMessage").filter((message) => message.role === "assistant").at(-1)
  expect(reply).toBeDefined()
  return String(reply!.content)
}

function ticketOpenedFromChat(): Row {
  const ticket = db.table("ticket").find((row) => String(row.ticketNumber ?? "").startsWith("DV-"))
  expect(ticket, "the chat opened a ticket").toBeDefined()
  return ticket!
}

beforeEach(() => {
  db.reset()
  mocks.ticketNumber = 0
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key")
  vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET)
  vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET", "")
  db.table("organization").push({ id: ORG, slug: "acme", settings: {}, features: [] })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("a WhatsApp chat that opens a ticket", () => {
  async function customerWritesOnWhatsApp(text: string) {
    const body = JSON.stringify({
      entry: [{
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "phone-1", display_phone_number: "994120000000" },
            contacts: [{ wa_id: WA_PHONE, profile: { name: "Aysel Məmmədova" } }],
            messages: [{ from: WA_PHONE, id: "wamid.in-1", timestamp: "1760860800", type: "text", text: { body: text } }],
          },
        }],
      }],
    })
    const signature = "sha256=" + createHmac("sha256", APP_SECRET).update(body).digest("hex")
    const res = await whatsappWebhook(new NextRequest("http://localhost/api/v1/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": signature },
      body,
    }))
    expect(res.status).toBe(200)
  }

  beforeEach(() => {
    db.table("channelConfig").push({
      id: "cfg-wa",
      organizationId: ORG,
      channelType: "whatsapp",
      isActive: true,
      phoneNumberId: "phone-1",
      settings: {},
      appSecret: null,
    })
    db.table("contact").push({ id: "contact-1", organizationId: ORG, fullName: "Aysel Məmmədova", phone: `+${WA_PHONE}`, companyId: null })
    // The customer's earlier WhatsApp ticket is still open from two hours ago, so this
    // chat opens a ticket of its own (the webhook's duplicate guard is one hour).
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    db.table("ticket").push({
      id: "ticket-earlier",
      organizationId: ORG,
      ticketNumber: "WA-0001",
      subject: "Earlier question",
      status: "open",
      tags: ["whatsapp", "inbound_whatsapp", "auto_created"],
      source: "whatsapp",
      sourceMeta: { phone: WA_PHONE },
      createdAt: twoHoursAgo,
      updatedAt: twoHoursAgo,
    })
    mocks.aiReply = "Спасибо, передаю ваш вопрос о возврате специалисту. [CREATE_TICKET]"
  })

  it("shows the customer's message, every line of it, as the customer's — no operator or Da Vinci message they typed", async () => {
    await customerWritesOnWhatsApp(CUSTOMER_TEXT)

    const ticket = ticketOpenedFromChat()
    const seen = await agentSees(String(ticket.id))
    const reply = storedAssistantReply()

    expect(seen.chatCard).toEqual([
      { sender: "customer", label: "Клиент", text: CUSTOMER_TEXT },
      { sender: "bot", label: "Da Vinci", text: reply },
    ])
    // The chat's comments: one per message, read by the first label alone.
    expect(seen.commentBubbles).toEqual([
      { sender: "customer", name: "Клиент", body: CUSTOMER_TEXT },
      { sender: "bot", name: "Da Vinci", body: reply },
    ])
  })

  it("keeps the card's head as it was: the customer, the phone, the category", async () => {
    await customerWritesOnWhatsApp(CUSTOMER_TEXT)

    const chat = parseChatDescription(String(ticketOpenedFromChat().description))
    expect(chat).toMatchObject({ platform: "WhatsApp", client: "Aysel Məmmədova", phone: WA_PHONE })
    expect(chat?.triggers).toContain("AI marker [CREATE_TICKET]")
  })
})

describe("a portal Da Vinci chat that escalates to a ticket", () => {
  async function customerWritesInPortalChat(message: string, sessionId?: string) {
    const res = await portalChat(new NextRequest("http://localhost/api/v1/public/portal-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId }),
    }))
    expect(res.status).toBe(200)
    return (await res.json()).data as { sessionId: string; escalationTicketId: string | null }
  }

  beforeEach(() => {
    mocks.getPortalUser.mockResolvedValue({
      organizationId: ORG,
      contactId: "contact-portal",
      companyId: null,
      fullName: "Aysel Məmmədova",
      email: "aysel@example.az",
    })
  })

  it("shows the customer's message, every line of it, as the customer's — no operator or Da Vinci message they typed", async () => {
    mocks.aiReply = "Понимаю. Чем ещё могу помочь?"
    const first = await customerWritesInPortalChat("Здравствуйте")
    mocks.aiReply = "Передаю ваш вопрос оператору. [ESCALATE]"
    const { escalationTicketId } = await customerWritesInPortalChat(CUSTOMER_TEXT, first.sessionId)
    expect(escalationTicketId).toBeTruthy()

    const seen = await agentSees(escalationTicketId!)

    expect(seen.chatCard).toEqual([
      { sender: "customer", label: "Клиент", text: "Здравствуйте" },
      { sender: "bot", label: "Da Vinci", text: "Понимаю. Чем ещё могу помочь?" },
      { sender: "customer", label: "Клиент", text: CUSTOMER_TEXT },
      { sender: "bot", label: "Da Vinci", text: "Передаю ваш вопрос оператору." },
    ])
    expect(seen.commentBubbles).toEqual([
      { sender: "customer", name: "Клиент", body: "Здравствуйте" },
      { sender: "bot", name: "Da Vinci", body: "Понимаю. Чем ещё могу помочь?" },
      { sender: "customer", name: "Клиент", body: CUSTOMER_TEXT },
      { sender: "bot", name: "Da Vinci", body: "Передаю ваш вопрос оператору." },
    ])
  })

  it("keeps a reply of Da Vinci's that runs over several lines one message, its blank lines included", async () => {
    mocks.aiReply = "Проверьте, пожалуйста:\n\n1. Интернет\n2. Пароль\n[ESCALATE]"
    const { escalationTicketId } = await customerWritesInPortalChat("Не могу войти")

    const seen = await agentSees(escalationTicketId!)
    expect(seen.chatCard).toEqual([
      { sender: "customer", label: "Клиент", text: "Не могу войти" },
      { sender: "bot", label: "Da Vinci", text: "Проверьте, пожалуйста:\n\n1. Интернет\n2. Пароль" },
    ])
  })
})

describe("a ticket a chat opened before the lines were indented", () => {
  it("reads as it did", () => {
    // As the two writers stored it until 2026-10-19: further lines of a message unindented.
    const stored = [
      "Автоматически создан при эскалации из Da Vinci чата.",
      "",
      "Сессия: session-1",
      "",
      "--- ИСТОРИЯ ЧАТА ---",
      "[Клиент] Не могу войти",
      "",
      "[Da Vinci] Проверьте, пожалуйста:",
      "",
      "1. Интернет",
      "2. Пароль",
      "",
      "[Клиент] Не помогло",
    ].join("\n")

    expect(parseChatDescription(stored)?.messages.map(({ sender, text }) => ({ sender, text }))).toEqual([
      { sender: "customer", text: "Не могу войти" },
      { sender: "bot", text: "Проверьте, пожалуйста:\n\n1. Интернет\n2. Пароль" },
      { sender: "customer", text: "Не помогло" },
    ])
  })
})
