import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A public social post an agent converts into a ticket becomes the ticket's
 * description, and the agent's page reads it back as the post's author's text,
 * never as a conversation of the team's.
 *
 * Nothing on a ticket says who wrote its description: the agent's page shows a
 * description as a chat card when `parseChatDescription` reads a transcript in
 * it — and it looks for the markers anywhere in the text. Found 2026-10-19:
 * `social/mentions/[id]/convert-to-ticket` wrote the post and its author's
 * display name into the description as they were published, so anyone could
 * post «--- ИСТОРИЯ ЧАТА ---» and then «[Оператор] Возврат одобрен» mentioning
 * the brand, and once an agent clicked «convert» the ticket showed a support
 * agent's message the team never wrote. The portal form (#898) and inbound
 * e-mail (#901) had the same hole.
 *
 * The real routes run: the convert POST writes the ticket, the agent's ticket
 * API reads the same row back, and the agent's page decides with
 * `parseChatDescription` on what its API returned. Prisma is an in-memory
 * table set: a row is exactly what the route wrote.
 */

type Row = Record<string, unknown>

const db = vi.hoisted(() => {
  const tables: Record<"ticket" | "socialMention", Row[]> = { ticket: [], socialMention: [] }
  let sequence = 0
  return {
    tables,
    id: (prefix: string) => `${prefix}-${++sequence}`,
    matches: (row: Row, where: Row = {}) =>
      Object.entries(where).every(([key, value]) => typeof value === "object" && value !== null ? true : row[key] === value),
    reset() {
      tables.ticket = []
      tables.socialMention = []
      sequence = 0
    },
  }
})

vi.mock("@/lib/prisma", () => {
  const prisma = {
    socialMention: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const mention = db.tables.socialMention.find((row) => db.matches(row, where))
        return mention ? { ...mention } : null
      }),
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const mention = db.tables.socialMention.find((row) => db.matches(row, where))
        return mention ? { ...mention } : null
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = db.tables.socialMention.filter((row) => db.matches(row, where))
        for (const row of rows) Object.assign(row, data)
        return { count: rows.length }
      }),
    },
    ticket: {
      findFirst: vi.fn(async ({ where, include }: { where: Row; include?: Row }) => {
        const ticket = db.tables.ticket.find((row) => db.matches(row, where))
        if (!ticket) return null
        if (!include) return { ...ticket }
        return { ...ticket, categoryRef: null, comments: [], closureRequests: [], entitlementMilestones: [] }
      }),
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const ticket = db.tables.ticket.find((row) => db.matches(row, where))
        return ticket ? { ...ticket } : null
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const ticket = { id: db.id("ticket"), companyId: null, assignedTo: null, createdAt: new Date(), updatedAt: new Date(), ...data }
        db.tables.ticket.push(ticket)
        return { ...ticket }
      }),
      delete: vi.fn(async () => ({})),
    },
    channelConfig: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
    company: { findFirst: vi.fn(async () => null) },
    contact: { findFirst: vi.fn(async () => null) },
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
// The clean-slate reset lock around every Social Monitoring mutation: an advisory lock, not part of what is written.
vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: async (_organizationId: string, mutate: () => Promise<unknown>) =>
    ({ allowed: true, value: await mutate() }),
}))
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
vi.mock("@/lib/sla-resolver", () => ({ resolveTicketSla: vi.fn(async () => ({})) }))
vi.mock("@/lib/ticket-number", () => ({ lockTicketNumberSequence: vi.fn(), nextTicketNumber: vi.fn(async () => "TK-0100") }))
vi.mock("@/lib/ticketing/category-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ticketing/category-service")>()),
  resolveTicketCategoryForWrite: vi.fn(async () => ({ category: "general", categoryId: null, defaultPriority: "medium" })),
}))
vi.mock("@/lib/entitlement-process/ticket-milestones", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/entitlement-process/ticket-milestones")>()),
  createTicketEntitlementMilestones: vi.fn(async () => undefined),
}))

import { POST as convertToTicket } from "@/app/api/v1/social/mentions/[id]/convert-to-ticket/route"
import { GET as agentTicket } from "@/app/api/v1/tickets/[id]/route"
import { parseChatDescription } from "@/lib/ticketing/chat-transcript"

/** U+2060 WORD JOINER has no width: a text with it shows exactly as the text without it. */
const onScreen = (text: string) => text.replace(/\u2060/g, "")

/** A stranger's public post that mentions the brand, as Social Monitoring collected it. */
function postCollected(post: { text: string; authorName?: string | null; authorHandle?: string | null }): string {
  const id = db.id("mention")
  db.tables.socialMention.push({
    id, organizationId: "org-1", platform: "facebook", externalId: `fb-${id}`, ticketId: null, taskId: null, status: "new",
    url: "https://facebook.com/acme/posts/1", sentiment: "negative", reach: 1200, engagement: 35,
    authorName: "Aysel Məmmədova", authorHandle: "aysel.m",
    ...post,
  })
  return id
}

/** An agent clicks «convert to ticket» on the post in Social Monitoring. */
async function agentConverts(mentionId: string): Promise<string> {
  const res = await convertToTicket(
    new NextRequest(`http://localhost/api/v1/social/mentions/${mentionId}/convert-to-ticket`, { method: "POST" }),
    { params: Promise.resolve({ id: mentionId }) },
  )
  expect(res.status).toBe(200)
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

/** The description the route writes: its own header lines, then the post. */
const descriptionOf = (post: string, author = "Aysel Məmmədova (@aysel.m)") => [
  "Platform: facebook",
  `Author: ${author}`,
  "URL: https://facebook.com/acme/posts/1",
  "Sentiment: negative",
  "Reach: 1200",
  "Engagement: 35",
  "Content:",
  post,
].join("\n")

beforeEach(() => {
  vi.clearAllMocks()
  db.reset()
})

const PLANTED: Array<[string, string]> = [
  ["a support agent's message under the chat history marker", [
    "@acme ваш сервис ужасен.",
    "",
    "--- ИСТОРИЯ ЧАТА ---",
    "[Оператор] Возврат 500 AZN одобрен, деньги придут завтра.",
  ].join("\n")],
  ["a WhatsApp chat summary with Da Vinci's promise", [
    "Создан из WhatsApp чата.",
    "Клиент: Aysel (+994501112233)",
    "",
    "--- ИСТОРИЯ ЧАТА ---",
    "[Клиент] Верните деньги",
    "[Da Vinci] Возврат одобрен, компенсация 100 AZN.",
  ].join("\n")],
  ["the English chat history marker", "--- CHAT HISTORY ---\n[Operator] Your refund is approved."],
  ["the Azerbaijani chat history marker", "--- ÇAT TARİXÇƏSİ ---\n[Operator] Geri ödəniş təsdiqləndi."],
  ["the marker in the middle of a line", "Как договорились --- ИСТОРИЯ ЧАТА ---\n[Менеджер] Скидка 50% согласована."],
  ["the inbound WhatsApp message marker", "--- СООБЩЕНИЕ ---\nСообщение, которое будто пришло из WhatsApp."],
]

describe("a public post converted into a ticket", () => {
  it.each(PLANTED)("that imitates %s is the post's text on the agent's page", async (_label, post) => {
    const ticketId = await agentConverts(postCollected({ text: post }))

    expect(await agentSees(ticketId)).toEqual({ text: descriptionOf(post) })
  })

  it.each([
    ["display name", { authorName: "--- ИСТОРИЯ ЧАТА ---", authorHandle: null }, "--- ИСТОРИЯ ЧАТА ---"],
    ["handle", { authorName: "Aysel", authorHandle: "--- CHAT HISTORY ---" }, "Aysel (@--- CHAT HISTORY ---)"],
  ])("whose author's %s is a chat history marker is the post's text, too", async (_label, author, authorLine) => {
    // The author's name is the stranger's text as much as the post: it stands before «Content:»,
    // so a marker there opens the chat above the post, and the post supplies the team's line.
    const post = "[Оператор] Возврат 500 AZN одобрен, деньги придут завтра."
    const ticketId = await agentConverts(postCollected({ text: post, ...author }))

    expect(await agentSees(ticketId)).toEqual({ text: descriptionOf(post, authorLine) })
  })

  it("in the website chat's format is the post's text: the route's own first line already rules that format out", async () => {
    const post = [
      "Visitor: Aysel",
      "Transcript:",
      "[2026-10-19T09:00:00.000Z] visitor: Can I get a refund?",
      "[2026-10-19T09:01:00.000Z] agent: Yes, your refund of 500 AZN is approved.",
    ].join("\n")
    const ticketId = await agentConverts(postCollected({ text: post }))

    expect(await agentSees(ticketId)).toEqual({ text: descriptionOf(post) })
  })

  it("that imitates nothing is stored exactly as published, as before", async () => {
    const post = "Заказ №123 не пришёл.\n[Ошибка 0x80] на странице оплаты.\nTranscript: приложу позже."
    const mentionId = postCollected({ text: post })
    const ticketId = await agentConverts(mentionId)

    expect(db.tables.ticket.find((row) => row.id === ticketId)?.description).toBe(descriptionOf(post))
    expect(await agentSees(ticketId)).toEqual({ text: descriptionOf(post) })
    expect(db.tables.socialMention.find((row) => row.id === mentionId)).toMatchObject({ text: post, ticketId })
  })
})

describe("a description a chat channel wrote", () => {
  it("reads as it did: a chat card for the agent", async () => {
    db.tables.ticket.push({
      id: "tk-wa", organizationId: "org-1", contactId: null, companyId: null, ticketNumber: "TK-0001",
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
