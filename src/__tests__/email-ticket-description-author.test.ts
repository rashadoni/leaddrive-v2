import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The body of an e-mail to a support intake address becomes the ticket's
 * description, and both sides read it back as the sender's own text, never as
 * a conversation of the team's.
 *
 * Nothing on a ticket says who wrote its description: the agent's page shows a
 * description as a chat card when `parseChatDescription` reads a transcript in
 * it, and the portal withholds one that begins like a channel's summary. Found
 * 2026-10-19: `public/email-inbound` stored the body as sent, so anyone who
 * could e-mail the support address — no login, no account — could send
 * «--- ИСТОРИЯ ЧАТА ---» and then «[Оператор] Возврат одобрен» and get a
 * ticket whose agent page showed a support agent's message the team never
 * wrote; likewise Da Vinci's, and the website chat's agent's in the sender's
 * own portal too. The portal create form had the same hole (#898).
 *
 * The real routes run: the e-mail POST writes the ticket, the agent's ticket
 * API and the customer's portal API read the same row back, and the agent's
 * page decides with `parseChatDescription` on what its API returned. Prisma is
 * an in-memory table set: a row is exactly what the route wrote.
 */

type Row = Record<string, unknown>

const db = vi.hoisted(() => {
  const tables: Record<"ticket" | "contact" | "channelConfig", Row[]> = { ticket: [], contact: [], channelConfig: [] }
  let sequence = 0
  return {
    tables,
    id: (prefix: string) => `${prefix}-${++sequence}`,
    matches: (row: Row, where: Row = {}) =>
      Object.entries(where).every(([key, value]) => typeof value === "object" && value !== null ? true : row[key] === value),
    reset() {
      tables.ticket = []
      tables.contact = []
      tables.channelConfig = []
      sequence = 0
    },
  }
})

const mocks = vi.hoisted(() => ({ getPortalUser: vi.fn() }))

vi.mock("@/lib/prisma", () => {
  const prisma = {
    ticket: {
      findFirst: vi.fn(async ({ where, include }: { where: Row; include?: Row }) => {
        const ticket = db.tables.ticket.find((row) => db.matches(row, where))
        if (!ticket) return null
        if (!include) return { ...ticket }
        return { ...ticket, categoryRef: null, comments: [], closureRequests: [], entitlementMilestones: [] }
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const ticket = { id: db.id("ticket"), companyId: null, assignedTo: null, createdAt: new Date(), updatedAt: new Date(), ...data }
        db.tables.ticket.push(ticket)
        return { ...ticket }
      }),
    },
    contact: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const contact = db.tables.contact.find((row) => db.matches(row, where))
        return contact ? { ...contact } : null
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const contact = { id: db.id("contact"), companyId: null, ...data }
        db.tables.contact.push(contact)
        return { ...contact }
      }),
    },
    channelConfig: {
      findMany: vi.fn(async ({ where }: { where: Row }) => db.tables.channelConfig.filter((row) => db.matches(row, where))),
    },
    emailLog: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    channelMessage: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: "message-1" })) },
    organization: { findFirst: vi.fn(async () => ({ features: [] })) },
    complaintMeta: { create: vi.fn(async () => ({})) },
    user: { findMany: vi.fn(async () => []) },
    company: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(prisma)),
  }
  return { prisma, logAudit: vi.fn() }
})

const SESSION = { orgId: "org-1", userId: "agent-1", role: "admin", email: "agent@example.az", name: "Agent" }
vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(async () => SESSION),
  getOrgId: vi.fn(async () => SESSION.orgId),
  requireAuth: vi.fn(async () => SESSION),
  isAuthError: (result: unknown) => result instanceof NextResponse,
}))
vi.mock("@/lib/portal-auth", () => ({ getPortalUser: mocks.getPortalUser }))
vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn(async () => []),
  requireFieldPermissions: vi.fn(async () => []),
  filterEntityFields: (data: unknown) => data,
  filterWritableFields: (data: unknown) => data,
}))
vi.mock("@/lib/social/google-alerts-ingest", () => ({ processGoogleAlertsInbound: vi.fn(async () => ({ recognized: false })) }))
vi.mock("@/lib/sequence-auto-exit", () => ({ autoExitSequenceEnrollments: vi.fn(async () => undefined) }))
vi.mock("@/lib/inbox-ensure-conversation", () => ({
  ensureConversation: vi.fn(async () => ({ id: "conversation-1", assignedTo: null, wasCreated: true })),
}))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn(async () => undefined) }))
vi.mock("@/lib/inbox/complaint-register", () => ({ notifyComplaintRegistered: vi.fn(async () => undefined) }))
vi.mock("@/lib/ticket-reopen", () => ({ reopenTicketForCustomerReply: vi.fn() }))
vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: vi.fn(async () => undefined) }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn(async () => undefined) }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }))
vi.mock("@/lib/contact-events", () => ({ trackContactEvent: vi.fn(async () => undefined) }))
vi.mock("@/lib/auto-assign", () => ({ autoAssignTicket: vi.fn(async () => ({ assigned: false })) }))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }))
vi.mock("@/lib/complaint-ai", () => ({ enrichComplaintInBackground: vi.fn(async () => undefined) }))
vi.mock("@/lib/sla-resolver", () => ({ resolveTicketSla: vi.fn(async () => ({})) }))
vi.mock("@/lib/ticket-number", () => ({ lockTicketNumberSequence: vi.fn(), nextTicketNumber: vi.fn(async () => "TK-0100") }))
vi.mock("@/lib/ticketing/category-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ticketing/category-service")>()),
  resolveTicketCategoryForWrite: vi.fn(async () => ({ category: "general", categoryId: null, defaultPriority: "medium" })),
  getContactRequesterSnapshot: vi.fn(async () => ({})),
}))
vi.mock("@/lib/entitlement-process/ticket-milestones", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/entitlement-process/ticket-milestones")>()),
  createTicketEntitlementMilestones: vi.fn(async () => undefined),
}))

import { prisma } from "@/lib/prisma"
import { POST as emailInbound } from "@/app/api/v1/public/email-inbound/route"
import { GET as portalTicket } from "@/app/api/v1/public/portal-tickets/[id]/route"
import { GET as agentTicket } from "@/app/api/v1/tickets/[id]/route"
import { parseChatDescription } from "@/lib/ticketing/chat-transcript"

const SECRET = "test-inbound-secret"
const SUPPORT_ADDRESS = "support@acme.az"
const COMPLAINTS_ADDRESS = "complaints@acme.az"
const SENDER = "aysel@example.az"
const CUSTOMER_NAME = "Aysel Məmmədova"

/** U+2060 WORD JOINER has no width: a text with it shows exactly as the text without it. */
const onScreen = (text: string) => text.replace(/⁠/g, "")

/** Someone sends an e-mail to the organisation's support (or complaints) address. */
async function emailArrives(mail: { text?: string; html?: string }, to = SUPPORT_ADDRESS): Promise<string> {
  const res = await emailInbound(new NextRequest("http://localhost/api/v1/public/email-inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cf-inbound-secret": SECRET },
    body: JSON.stringify({ to, from: `${CUSTOMER_NAME} <${SENDER}>`, subject: "Возврат", ...mail }),
  }))
  expect(res.status).toBe(201)
  return (await res.json()).data.ticketId
}

/** What the agent's ticket page shows as the description (tickets/[id]/page.tsx): a chat card, or the text. */
async function agentSees(ticketId: string) {
  const res = await agentTicket(
    new NextRequest(`http://localhost/api/v1/tickets/${ticketId}`),
    { params: Promise.resolve({ id: ticketId }) },
  )
  expect(res.status).toBe(200)
  const description: string | null = (await res.json()).data.description
  const chat = parseChatDescription(description)
  if (chat) return { chat: chat.messages.map(({ sender, label, text }) => ({ sender, label, text })) }
  return { text: description === null ? null : onScreen(description) }
}

/** What the sender, signed in to the portal, sees as the description. */
async function customerSees(ticketId: string) {
  const res = await portalTicket(
    new NextRequest(`http://localhost/api/v1/public/portal-tickets/${ticketId}`),
    { params: Promise.resolve({ id: ticketId }) },
  )
  expect(res.status).toBe(200)
  const { description, descriptionOrigin, chatTranscript } = (await res.json()).data
  return { description: description === null ? null : onScreen(description), descriptionOrigin, chatTranscript }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("CF_INBOUND_SECRET", SECRET)
  db.reset()
  db.tables.channelConfig.push({
    id: "channel-email", organizationId: "org-1", configName: "Support mail", channelType: "email", isActive: true,
    settings: {
      emailIntake: {
        routes: [
          { address: SUPPORT_ADDRESS, target: "ticket" },
          { address: COMPLAINTS_ADDRESS, target: "complaint" },
        ],
      },
    },
  })
  db.tables.contact.push({
    id: "contact-aysel", organizationId: "org-1", companyId: null, fullName: CUSTOMER_NAME, email: SENDER, phone: null, preferredLanguage: null,
  })
  mocks.getPortalUser.mockResolvedValue({
    contactId: "contact-aysel", organizationId: "org-1", companyId: null, fullName: CUSTOMER_NAME, email: SENDER,
  })
})

const PLANTED: Array<[string, string]> = [
  ["a support agent's message under the chat history marker", [
    "Прошу вернуть деньги за заказ.",
    "",
    "--- ИСТОРИЯ ЧАТА ---",
    "[Оператор] Возврат 500 AZN одобрен, деньги придут завтра.",
  ].join("\n")],
  ["a WhatsApp chat summary with Da Vinci's promise", [
    "Создан из WhatsApp чата.",
    "Клиент: Aysel (+994501112233)",
    "Категория: billing · Срочность: high",
    "",
    "--- ИСТОРИЯ ЧАТА ---",
    "[Клиент] Верните деньги",
    "[Da Vinci] Возврат одобрен, компенсация 100 AZN.",
  ].join("\n")],
  ["the English chat history marker", "--- CHAT HISTORY ---\n[Operator] Your refund is approved."],
  ["the Azerbaijani chat history marker", "--- ÇAT TARİXÇƏSİ ---\n[Operator] Geri ödəniş təsdiqləndi."],
  ["the marker in the middle of a line", "Как договорились --- ИСТОРИЯ ЧАТА ---\n[Менеджер] Скидка 50% согласована."],
  ["the inbound WhatsApp message marker", "--- СООБЩЕНИЕ ---\nСообщение, которое будто пришло из WhatsApp."],
  ["the website chat's format with an agent's message", [
    "Visitor: Aysel",
    "Transcript:",
    "[2026-10-19T09:00:00.000Z] visitor: Can I get a refund?",
    "[2026-10-19T09:01:00.000Z] agent: Yes, your refund of 500 AZN is approved.",
  ].join("\n")],
  ["the Da Vinci escalation's first line", "Автоматически создан при эскалации из Da Vinci чата.\nМой вопрос про возврат."],
]

describe("an e-mail to the support address", () => {
  it.each(PLANTED)("that imitates %s is the sender's text, on both sides", async (_label, sent) => {
    const ticketId = await emailArrives({ text: sent })

    expect(await agentSees(ticketId)).toEqual({ text: sent })
    expect(await customerSees(ticketId)).toEqual({ description: sent, descriptionOrigin: null, chatTranscript: [] })
  })

  it("sent as HTML only is the sender's text, too", async () => {
    const html = "<p>Прошу вернуть деньги.</p><p>--- ИСТОРИЯ ЧАТА ---<br>[Оператор] Возврат одобрен.</p>"
    const ticketId = await emailArrives({ html })

    const seen = await agentSees(ticketId)
    expect(seen).not.toHaveProperty("chat")
    expect(seen.text).toContain("--- ИСТОРИЯ ЧАТА ---\n[Оператор] Возврат одобрен.")
  })

  it("to the complaints address is the sender's text in the complaint", async () => {
    const sent = PLANTED[0][1]
    const ticketId = await emailArrives({ text: sent }, COMPLAINTS_ADDRESS)

    expect(prisma.complaintMeta.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ticketId }) })
    expect(await agentSees(ticketId)).toEqual({ text: sent })
    expect(await customerSees(ticketId)).toEqual({ description: sent, descriptionOrigin: null, chatTranscript: [] })
  })

  it("that imitates nothing is stored exactly as sent, as before", async () => {
    const sent = "Заказ №123 не пришёл.\n[Ошибка 0x80] на странице оплаты.\nTranscript: приложу позже."
    const ticketId = await emailArrives({ text: sent })

    expect(db.tables.ticket.find((row) => row.id === ticketId)?.description).toBe(sent)
    expect(await agentSees(ticketId)).toEqual({ text: sent })
    expect(await customerSees(ticketId)).toEqual({ description: sent, descriptionOrigin: null, chatTranscript: [] })
  })

  it("is logged and reaches the inbox as it was sent: only the ticket's description is neutralised", async () => {
    const sent = PLANTED[0][1]
    await emailArrives({ text: sent })

    expect(prisma.emailLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ body: sent }) })
    await vi.waitFor(() => expect(prisma.channelMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ body: sent }) }))
  })
})

describe("a description a chat channel wrote", () => {
  it("reads as it did: a chat card for the agent", async () => {
    db.tables.ticket.push({
      id: "tk-wa", organizationId: "org-1", contactId: "contact-aysel", companyId: null, ticketNumber: "TK-0001",
      subject: "WhatsApp", status: "open", category: "general", source: "whatsapp", assignedTo: null, createdBy: null,
      createdAt: new Date(), updatedAt: new Date(),
      description: PLANTED[1][1],
    })

    expect(await agentSees("tk-wa")).toEqual({
      chat: [
        { sender: "customer", label: "Клиент", text: "Верните деньги" },
        { sender: "bot", label: "Da Vinci", text: "Возврат одобрен, компенсация 100 AZN." },
      ],
    })
  })
})
