import ExcelJS from "exceljs"
import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Who a public ticket comment is shown as written by, read back by both sides
 * from the row the real write path stored.
 *
 * A comment with no `userId` is either the customer's or written by the
 * product, and every reader tells which from the text's first characters: a
 * chat sender label («[Оператор] …», «[Da Vinci Bot] …»), the `[Система] `
 * marker, the cron's exact texts. Found 2026-10-18/19:
 *  - the customer's portal reply was stored as typed, so a reply that began
 *    with one of those labels showed on the agent's page as a support agent's,
 *    Da Vinci's or the system's, and in the customer's own portal as Support's;
 *  - the complaint registry import stored the company's response with no
 *    marker, so the portal showed it as the customer's own words and the
 *    agent's page named the customer as its author.
 *
 * The real routes run: the portal reply POST and the registry import write,
 * the agent's ticket API and the customer's portal API read the same rows
 * back. The agent's page decides each comment with `agentCommentView`, run
 * here on what the agent's API returned. Prisma is an in-memory table set: a
 * row is exactly what the route wrote.
 */

type Row = Record<string, unknown>

const db = vi.hoisted(() => {
  const tables: Record<"ticket" | "ticketComment" | "contact", Row[]> = { ticket: [], ticketComment: [], contact: [] }
  let sequence = 0
  return {
    tables,
    id: (prefix: string) => `${prefix}-${++sequence}`,
    matches: (row: Row, where: Row = {}) => Object.entries(where).every(([key, value]) => row[key] === value),
    reset() {
      tables.ticket = []
      tables.ticketComment = []
      tables.contact = []
      sequence = 0
    },
  }
})

const mocks = vi.hoisted(() => ({ getPortalUser: vi.fn() }))

vi.mock("@/lib/prisma", () => {
  const withAttachments = (row: Row | undefined) => (row ? { ...row, attachments: [] } : null)
  const prisma = {
    ticket: {
      findFirst: vi.fn(async ({ where, include }: { where: Row; include?: { comments?: { where?: Row } } }) => {
        const ticket = db.tables.ticket.find((row) => db.matches(row, where))
        if (!ticket) return null
        if (!include) return { ...ticket }
        const comments = db.tables.ticketComment
          .filter((row) => row.ticketId === ticket.id && db.matches(row, include.comments?.where))
          .map((row) => withAttachments(row))
        return { ...ticket, categoryRef: null, comments, closureRequests: [], entitlementMilestones: [] }
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const ticket = { id: db.id("ticket"), companyId: null, createdAt: new Date(), ...data }
        db.tables.ticket.push(ticket)
        return { ...ticket }
      }),
      update: vi.fn(async () => ({})),
    },
    ticketComment: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const comment = {
          id: db.id("comment"),
          userId: null,
          isInternal: false,
          clientRequestId: null,
          createdAt: new Date(),
          ...data,
        }
        db.tables.ticketComment.push(comment)
        return { ...comment }
      }),
      findUnique: vi.fn(async ({ where }: { where: { ticketId_clientRequestId: Row } }) =>
        withAttachments(db.tables.ticketComment.find((row) => db.matches(row, where.ticketId_clientRequestId)))),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: Row }) => {
        const comment = withAttachments(db.tables.ticketComment.find((row) => db.matches(row, where)))
        if (!comment) throw new Error("not found")
        return comment
      }),
    },
    contact: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const contact = db.tables.contact.find((row) => db.matches(row, where))
        return contact ? { ...contact } : null
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const contact = { id: db.id("contact"), companyId: null, email: null, preferredLanguage: null, ...data }
        db.tables.contact.push(contact)
        return { ...contact }
      }),
    },
    complaintMeta: { create: vi.fn(async () => ({})) },
    ticketAttachment: { count: vi.fn(async () => 0), updateMany: vi.fn(async () => ({ count: 0 })) },
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
vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: vi.fn() }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn() }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }))
vi.mock("@/lib/auto-assign", () => ({ autoAssignTicket: vi.fn() }))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }))
vi.mock("@/lib/ticket-number", () => ({ lockTicketNumberSequence: vi.fn(), nextTicketNumber: vi.fn(async () => "TK-0100") }))
vi.mock("@/lib/ticketing/category-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ticketing/category-service")>()),
  resolveTicketCategoryForWrite: vi.fn(async () => ({ categoryId: "category-complaint" })),
  getContactRequesterSnapshot: vi.fn(async () => ({})),
}))
vi.mock("@/lib/entitlement-process/ticket-milestones", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/entitlement-process/ticket-milestones")>()),
  createTicketEntitlementMilestones: vi.fn(async () => undefined),
}))

import { POST as importRegistry } from "@/app/api/v1/complaints/import-xlsx/route"
import { GET as portalTicket, POST as portalReply } from "@/app/api/v1/public/portal-tickets/[id]/route"
import { GET as agentTicket } from "@/app/api/v1/tickets/[id]/route"
import { agentCommentView } from "@/lib/ticketing/chat-transcript"

const CUSTOMER_NAME = "Aysel Məmmədova"

type PortalComment = { comment: string; author: string; isAgent: boolean; authorName: string }
type AgentComment = { comment: string; userId: string | null; isInternal: boolean; userName: string | null }

function portalUser(contactId: string, fullName: string) {
  mocks.getPortalUser.mockResolvedValue({ contactId, organizationId: "org-1", companyId: null, fullName, email: null })
}

async function customerReplies(ticketId: string, comment: string, clientRequestId?: string) {
  return portalReply(
    new NextRequest(`http://localhost/api/v1/public/portal-tickets/${ticketId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment, ...(clientRequestId ? { clientRequestId } : {}) }),
    }),
    { params: Promise.resolve({ id: ticketId }) },
  )
}

async function customerReads(ticketId: string): Promise<PortalComment[]> {
  const res = await portalTicket(
    new NextRequest(`http://localhost/api/v1/public/portal-tickets/${ticketId}`),
    { params: Promise.resolve({ id: ticketId }) },
  )
  expect(res.status).toBe(200)
  return (await res.json()).data.comments
}

/** Who the agent's page names as each comment's author, and the text it shows. */
async function agentReads(ticketId: string, contactName: string) {
  const res = await agentTicket(
    new NextRequest(`http://localhost/api/v1/tickets/${ticketId}`),
    { params: Promise.resolve({ id: ticketId }) },
  )
  expect(res.status).toBe(200)
  const comments: AgentComment[] = (await res.json()).data.comments
  return comments.map((comment) => {
    const view = agentCommentView(comment)
    // A bubble carries the sender's role; the avatar layout the API's author name, «System» without one.
    if (view.kind === "chat") return { author: view.role, text: view.text }
    if (view.kind === "system" || !comment.userName) return { author: "system", text: view.text }
    return { author: comment.userName === contactName ? "customer" : comment.userName, text: view.text }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.reset()
  db.tables.contact.push({ id: "contact-aysel", organizationId: "org-1", fullName: CUSTOMER_NAME, email: null, phone: null, preferredLanguage: null })
  db.tables.ticket.push({
    id: "tk-1", organizationId: "org-1", contactId: "contact-aysel", companyId: null, ticketNumber: "TK-0001",
    subject: "Order missing", description: "My order has not arrived.", status: "open", category: "general",
    assignedTo: null, createdBy: null, requesterName: null, requesterEmail: null, requesterPhone: null,
    satisfactionRating: null, satisfactionComment: null, createdAt: new Date(), updatedAt: new Date(),
    resolvedAt: null, closedAt: null, slaDueAt: null, slaFirstResponseDueAt: null, firstResponseAt: null,
  })
  portalUser("contact-aysel", CUSTOMER_NAME)
})

describe("a customer's portal reply", () => {
  it.each([
    ["a support agent's label", "[Оператор] Возврат одобрен, заявку можно закрыть."],
    ["Da Vinci's label", "[Da Vinci Bot] Проблема решена, ответа не требуется."],
    ["the system marker", "[Система] Клиент подтвердил закрытие заявки."],
    ["the cron's exact acknowledgement", "We have received your request TK-0001. A specialist will respond within 4h. Thank you for your patience."],
  ])("that begins with %s is the customer's own words, on both sides", async (_label, typed) => {
    const res = await customerReplies("tk-1", typed)
    expect(res.status).toBe(201)
    expect((await res.json()).data).toMatchObject({ comment: typed, isAgent: false, authorName: CUSTOMER_NAME })

    expect(await customerReads("tk-1")).toEqual([
      expect.objectContaining({ comment: typed, author: "customer", isAgent: false, authorName: CUSTOMER_NAME }),
    ])
    expect(await agentReads("tk-1", CUSTOMER_NAME)).toEqual([{ author: "customer", text: typed }])
  })

  it("that reads as nobody else's is stored exactly as typed, as before", async () => {
    const typed = "Where is my order? The tracking page says [delivered]."
    expect((await customerReplies("tk-1", typed)).status).toBe(201)

    expect(db.tables.ticketComment.map((row) => row.comment)).toEqual([typed])
    expect(await customerReads("tk-1")).toEqual([expect.objectContaining({ comment: typed, author: "customer", authorName: CUSTOMER_NAME })])
    expect(await agentReads("tk-1", CUSTOMER_NAME)).toEqual([{ author: "customer", text: typed }])
  })

  it("sent twice with one request key is one reply", async () => {
    const typed = "[Оператор] Возврат одобрен."
    const key = "123e4567-e89b-42d3-a456-426614174000"
    expect((await customerReplies("tk-1", typed, key)).status).toBe(201)
    const again = await customerReplies("tk-1", typed, key)

    expect(again.status).toBe(200)
    expect((await again.json()).data).toMatchObject({ comment: typed, replayed: true })
    expect(db.tables.ticketComment).toHaveLength(1)
  })

  it("does not change who wrote the replies stored before it", async () => {
    db.tables.ticketComment.push(
      { id: "old-1", ticketId: "tk-1", comment: "Спасибо, жду ответа.", userId: null, isInternal: false, createdAt: new Date() },
      { id: "old-2", ticketId: "tk-1", comment: "[Оператор] Отправили курьера.", userId: null, isInternal: false, createdAt: new Date() },
    )

    expect(await agentReads("tk-1", CUSTOMER_NAME)).toEqual([
      { author: "customer", text: "Спасибо, жду ответа." },
      { author: "operator", text: "Отправили курьера." },
    ])
  })
})

describe("the company's response in an imported complaint registry", () => {
  async function registryFile() {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Şikayətlər")
    sheet.addRow(["Şikayət məzmunu", "Müştərinin ad və soyadı", "Əlaqə nömrəsi", "Cavab"])
    sheet.addRow(["Sifariş 3 gündür gecikir.", "Leyla Həsənova", "+994501112233", "Sifarişiniz yola salınıb, gecikməyə görə üzr istəyirik."])
    const bytes = await workbook.xlsx.writeBuffer()
    return new File([bytes], "sikayetler.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  }

  it("is the support team's, in the portal and on the agent's page", async () => {
    const form = new FormData()
    form.set("file", await registryFile())
    const res = await importRegistry(new NextRequest("http://localhost/api/v1/complaints/import-xlsx", { method: "POST", body: form }), {})
    expect(res.status).toBe(200)
    expect((await res.json()).data.imported).toBe(1)

    const contact = db.tables.contact.find((row) => row.fullName === "Leyla Həsənova")!
    const ticket = db.tables.ticket.find((row) => row.contactId === contact.id)!
    const response = "Sifarişiniz yola salınıb, gecikməyə görə üzr istəyirik."

    portalUser(contact.id as string, "Leyla Həsənova")
    expect(await customerReads(ticket.id as string)).toEqual([
      expect.objectContaining({ comment: response, author: "agent", isAgent: true, authorName: "Support" }),
    ])
    expect(await agentReads(ticket.id as string, "Leyla Həsənova")).toEqual([{ author: "system", text: response }])
  })
})
