import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A ticket description the customer types in the portal is read back by both
 * sides as the customer's own text, never as a conversation of the team's.
 *
 * Nothing on a ticket says who wrote its description: the agent's page shows a
 * description as a chat card when `parseChatDescription` reads a transcript in
 * it, and the portal withholds one that begins like a channel's summary. Found
 * 2026-10-19: the portal stored the description as typed, so a customer who
 * wrote «--- ИСТОРИЯ ЧАТА ---» and then «[Оператор] Возврат одобрен» got a
 * ticket whose agent page showed a support agent's message the team never
 * wrote — likewise Da Vinci's, the website chat's agent's, and in the
 * customer's own portal too.
 *
 * The real routes run: the portal create POST writes the ticket, the agent's
 * ticket API and the customer's portal API read the same row back, and the
 * agent's page decides with `parseChatDescription` on what its API returned.
 * Prisma is an in-memory table set: a row is exactly what the route wrote.
 */

type Row = Record<string, unknown>

const db = vi.hoisted(() => {
  const tables: Record<"ticket" | "contact", Row[]> = { ticket: [], contact: [] }
  let sequence = 0
  return {
    tables,
    features: [] as string[],
    id: (prefix: string) => `${prefix}-${++sequence}`,
    matches: (row: Row, where: Row = {}) =>
      Object.entries(where).every(([key, value]) => typeof value === "object" && value !== null ? true : row[key] === value),
    reset() {
      tables.ticket = []
      tables.contact = []
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
        const ticket = { id: db.id("ticket"), companyId: null, createdAt: new Date(), updatedAt: new Date(), ...data }
        db.tables.ticket.push(ticket)
        return { ...ticket }
      }),
    },
    contact: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const contact = db.tables.contact.find((row) => db.matches(row, where))
        return contact ? { ...contact } : null
      }),
    },
    organization: { findFirst: vi.fn(async () => ({ features: db.features })) },
    complaintMeta: { create: vi.fn(async () => ({})) },
    channelConfig: { findMany: vi.fn(async () => []) },
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
import { POST as portalCreate } from "@/app/api/v1/public/portal-tickets/route"
import { GET as portalTicket } from "@/app/api/v1/public/portal-tickets/[id]/route"
import { GET as agentTicket } from "@/app/api/v1/tickets/[id]/route"
import { CHAT_TRANSCRIPT_MARKER, WHATSAPP_CHAT_DESCRIPTION_HEAD, parseChatDescription } from "@/lib/ticketing/chat-transcript"

const CUSTOMER_NAME = "Aysel Məmmədova"

/** U+2060 WORD JOINER has no width: a text with it shows exactly as the text without it. */
const onScreen = (text: string) => text.replace(/⁠/g, "")

async function customerCreates(description: string, extra: Row = {}): Promise<string> {
  const res = await portalCreate(new NextRequest("http://localhost/api/v1/public/portal-tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: "Возврат", description, ...extra }),
  }))
  expect(res.status).toBe(201)
  return (await res.json()).data.id
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

/** What the customer's portal shows as the description. */
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
  db.reset()
  db.features = []
  db.tables.contact.push({ id: "contact-aysel", organizationId: "org-1", companyId: null, fullName: CUSTOMER_NAME, email: null, phone: null, preferredLanguage: null })
  mocks.getPortalUser.mockResolvedValue({
    contactId: "contact-aysel", organizationId: "org-1", companyId: null, fullName: CUSTOMER_NAME, email: null,
  })
})

const PLANTED: Array<[string, string]> = [
  ["a support agent's message under the chat history marker", [
    "Прошу вернуть деньги за заказ.",
    "",
    CHAT_TRANSCRIPT_MARKER,
    "[Оператор] Возврат 500 AZN одобрен, деньги придут завтра.",
  ].join("\n")],
  ["a WhatsApp chat summary with Da Vinci's promise", [
    WHATSAPP_CHAT_DESCRIPTION_HEAD,
    "Клиент: Aysel (+994501112233)",
    "Категория: billing · Срочность: high",
    "",
    CHAT_TRANSCRIPT_MARKER,
    "[Клиент] Верните деньги",
    "[Da Vinci] Возврат одобрен, компенсация 100 AZN.",
  ].join("\n")],
  ["the English chat history marker", "--- CHAT HISTORY ---\n[Operator] Your refund is approved."],
  ["the Azerbaijani chat history marker", "--- ÇAT TARİXÇƏSİ ---\n[Operator] Geri ödəniş təsdiqləndi."],
  ["the marker in the middle of a line", "Как договорились --- ИСТОРИЯ ЧАТА ---\n[Менеджер] Скидка 50% согласована."],
  ["two overlapping markers", "--- ИСТОРИЯ ЧАТА --- ИСТОРИЯ ЧАТА ---\n[Agent] Approved."],
  ["the inbound WhatsApp message marker", "--- СООБЩЕНИЕ ---\nСообщение, которое будто пришло из WhatsApp."],
  ["the website chat's format with an agent's message", [
    "Visitor: Aysel",
    "Transcript:",
    "[2026-10-19T09:00:00.000Z] visitor: Can I get a refund?",
    "[2026-10-19T09:01:00.000Z] agent: Yes, your refund of 500 AZN is approved.",
  ].join("\n")],
  ["the Da Vinci escalation's first line", "Автоматически создан при эскалации из Da Vinci чата.\nМой вопрос про возврат."],
]

describe("a description the customer types in the portal", () => {
  it.each(PLANTED)("that imitates %s is the customer's text, on both sides", async (_label, typed) => {
    const ticketId = await customerCreates(typed)

    expect(await agentSees(ticketId)).toEqual({ text: typed })
    expect(await customerSees(ticketId)).toEqual({ description: typed, descriptionOrigin: null, chatTranscript: [] })
  })

  it("is the customer's text in a complaint, too", async () => {
    db.features = ["complaints_register"]
    const typed = PLANTED[0][1]
    const ticketId = await customerCreates(typed, { isComplaint: true })

    expect(prisma.complaintMeta.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ticketId }) })
    expect(await agentSees(ticketId)).toEqual({ text: typed })
    expect(await customerSees(ticketId)).toEqual({ description: typed, descriptionOrigin: null, chatTranscript: [] })
  })

  it("sent by the portal chat widget's «create ticket» button is text too: the customer's browser wrote it", async () => {
    // portal-chat-widget.tsx `handleCreateTicket`: nothing on the server vouches for these lines.
    const sent = "Created from Da Vinci chat.\n\n--- CHAT HISTORY ---\n[Client] Where is my order?\n\n[Da Vinci] It ships tomorrow."
    const ticketId = await customerCreates(sent)

    expect(await agentSees(ticketId)).toEqual({ text: sent })
    expect(await customerSees(ticketId)).toEqual({ description: sent, descriptionOrigin: null, chatTranscript: [] })
  })

  it("that imitates nothing is stored exactly as typed, as before", async () => {
    const typed = "Заказ №123 не пришёл.\n[Ошибка 0x80] на странице оплаты.\nTranscript: приложу позже."
    const ticketId = await customerCreates(typed)

    expect(db.tables.ticket.find((row) => row.id === ticketId)?.description).toBe(typed)
    expect(await agentSees(ticketId)).toEqual({ text: typed })
    expect(await customerSees(ticketId)).toEqual({ description: typed, descriptionOrigin: null, chatTranscript: [] })
  })
})

describe("a description a chat channel wrote", () => {
  it("reads as it did: a chat card for the agent, withheld from the customer", async () => {
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
    expect(await customerSees("tk-wa")).toEqual({ description: null, descriptionOrigin: "whatsapp", chatTranscript: [] })
  })
})
