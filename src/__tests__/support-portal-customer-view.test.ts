import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * A ticket a chat opened, from both ends: what the WhatsApp webhook stores for
 * the team, and what the customer then reads in the portal.
 *
 * Found 2026-10-17: an Azerbaijani customer opened their WhatsApp ticket in the
 * portal and read «[WhatsApp Тикет] …», a description of Russian headers with
 * the team's routing details, their own messages as «[Клиент (WhatsApp)] …» —
 * and Da Vinci's replies under their own name, on their side of the thread.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    // The intake holds a per-phone advisory lock in a transaction of its own.
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({ $executeRaw: vi.fn() })),
    ticket: { findFirst: vi.fn(), findMany: vi.fn() },
    ticketComment: { create: vi.fn() },
    organization: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/ticket-factory", () => ({ createTicketWithAssignment: vi.fn() }))
vi.mock("@/lib/portal-auth", () => ({ getPortalUser: vi.fn() }))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn(async (_orgId: string, work: () => unknown) => work()),
}))

import { prisma } from "@/lib/prisma"
import { createTicketWithAssignment } from "@/lib/ticket-factory"
import { getPortalUser } from "@/lib/portal-auth"
import { ensureInboundWhatsAppTicket } from "@/lib/inbox/whatsapp-inbound-ticket"
import { parseChatDescription } from "@/lib/ticketing/chat-transcript"
import { GET as GET_TICKET } from "@/app/api/v1/public/portal-tickets/[id]/route"
import { GET as LIST_TICKETS } from "@/app/api/v1/public/portal-tickets/route"

const CYRILLIC = /[А-Яа-яЁё]/
const PORTAL_USER = {
  contactId: "contact-1",
  organizationId: "org-1",
  companyId: null,
  fullName: "Aysel Məmmədova",
  email: "aysel@example.az",
}

type StoredComment = { id: string; comment: string; userId: string | null; isInternal: boolean; createdAt: Date; attachments: [] }

function comment(id: string, text: string, userId: string | null = null): StoredComment {
  return { id, comment: text, userId, isInternal: false, createdAt: new Date("2026-10-17T09:00:00.000Z"), attachments: [] }
}

function storedTicket(fields: { subject: string; description: string | null }, comments: StoredComment[]) {
  return {
    id: "tk-1",
    ticketNumber: "WA-0042",
    status: "open",
    category: "general",
    categoryRef: null,
    satisfactionRating: null,
    satisfactionComment: null,
    createdAt: new Date("2026-10-17T09:00:00.000Z"),
    updatedAt: new Date("2026-10-17T09:00:00.000Z"),
    resolvedAt: null,
    closedAt: null,
    slaDueAt: null,
    slaFirstResponseDueAt: null,
    firstResponseAt: null,
    ...fields,
    comments,
  }
}

async function customerSees(ticket: ReturnType<typeof storedTicket>) {
  vi.mocked(prisma.ticket.findFirst).mockResolvedValue(ticket as never)
  const response = await GET_TICKET(
    new NextRequest("http://localhost/api/v1/public/portal-tickets/tk-1"),
    { params: Promise.resolve({ id: "tk-1" }) },
  )
  expect(response.status).toBe(200)
  return (await response.json()).data
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPortalUser).mockResolvedValue(PORTAL_USER as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "agent-1", name: "Leyla" }] as never)
  vi.mocked(prisma.ticketComment.create).mockResolvedValue({} as never)
  vi.mocked(createTicketWithAssignment).mockImplementation((async (input: Record<string, unknown>) => ({
    id: "tk-1",
    ticketNumber: "WA-0042",
    ...input,
  })) as never)
})

describe("a WhatsApp message to an Azerbaijani organization", () => {
  it("files a ticket the team reads in Azerbaijani, and the customer reads as their own conversation", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { language: "az" } } as never)
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null)

    const result = await ensureInboundWhatsAppTicket({
      organizationId: "org-1",
      waPhone: "994501234567",
      senderName: "Aysel Məmmədova",
      messageText: "Salam, sifarişim gəlmədi",
      contactId: "contact-1",
      leadId: null,
      companyId: null,
      channelMessageId: "cm-1",
    })
    expect(result).toMatchObject({ ticketId: "tk-1", created: true, commentAdded: true })

    // What the team gets: the subject in the organization's language…
    const filed = vi.mocked(createTicketWithAssignment).mock.calls[0][0] as unknown as { subject: string; description: string }
    expect(filed.subject).toBe("[WhatsApp müraciəti] Salam, sifarişim gəlmədi")
    // …and the stored format the agent page renders as a card in the agent's language.
    expect(parseChatDescription(filed.description)).toMatchObject({
      platform: "WhatsApp",
      client: "Aysel Məmmədova",
      phone: "994501234567",
      messages: [{ sender: "customer", text: "Salam, sifarişim gəlmədi" }],
    })
    const storedComment = vi.mocked(prisma.ticketComment.create).mock.calls[0][0] as { data: { comment: string } }
    expect(storedComment.data.comment).toBe("[Клиент (WhatsApp)] Salam, sifarişim gəlmədi")

    // The conversation goes on: Da Vinci answers (ticket-sync's format), then an agent.
    const data = await customerSees(storedTicket(filed, [
      comment("c1", storedComment.data.comment),
      comment("c2", "[Da Vinci Bot] Salam! Sifarişinizi yoxlayıram."),
      comment("c3", "Sifarişiniz sabah çatdırılacaq.", "agent-1"),
    ]))

    expect(data.subject).toBe("Salam, sifarişim gəlmədi")
    expect(data.description).toBeNull()
    expect(data.descriptionOrigin).toBe("whatsapp")
    expect(data.comments).toEqual([
      expect.objectContaining({ comment: "Salam, sifarişim gəlmədi", isAgent: false, author: "customer", channel: "WhatsApp", authorName: "Aysel Məmmədova" }),
      expect.objectContaining({ comment: "Salam! Sifarişinizi yoxlayıram.", isAgent: true, author: "assistant", authorName: "Da Vinci" }),
      expect.objectContaining({ comment: "Sifarişiniz sabah çatdırılacaq.", isAgent: true, author: "agent", authorName: "Leyla" }),
    ])
    expect(JSON.stringify(data)).not.toMatch(CYRILLIC)
  })
})

describe("tickets stored before the customer view existed", () => {
  it("never show the customer the team's headers, routing details or sender markers", async () => {
    const data = await customerSees(storedTicket({
      subject: "[Жалоба WhatsApp] Məhsul xarab gəldi",
      description: [
        "Создан из WhatsApp чата.",
        "Клиент: Aysel Məmmədova (+994501234567)",
        "Категория: complaint · Срочность: critical",
        "Триггеры: AI marker [COMPLAINT], keyword:complaint",
        "",
        "--- ИСТОРИЯ ЧАТА ---",
        "[Клиент] Məhsul xarab gəldi",
        "",
        "[Da Vinci] Şikayətiniz qəbul edildi.",
      ].join("\n"),
    }, [
      comment("c1", "[Клиент (WhatsApp)] Məhsul xarab gəldi"),
      comment("c2", "[Da Vinci Bot] Şikayətiniz qəbul edildi və məsul şəxslərə ötürüldü. [ESCALATE]"),
      comment("c3", "📧 Şəkilləri e-poçtla göndərdim"),
      comment("c4", "[AI Bot] Thank you, we received the photos."),
    ]))

    expect(data.subject).toBe("Məhsul xarab gəldi")
    expect(data.description).toBeNull()
    expect(data.comments.map((c: { comment: string; author: string }) => [c.author, c.comment])).toEqual([
      ["customer", "Məhsul xarab gəldi"],
      ["assistant", "Şikayətiniz qəbul edildi və məsul şəxslərə ötürüldü."],
      ["customer", "Şəkilləri e-poçtla göndərdim"],
      ["assistant", "Thank you, we received the photos."],
    ])
    const seen = JSON.stringify(data)
    for (const leak of ["Жалоба", "Триггеры", "keyword:", "[ESCALATE]", "[COMPLAINT]", "📧", "[Клиент", "[Da Vinci Bot]", "[AI Bot]"]) {
      expect(seen, leak).not.toContain(leak)
    }
  })

  it("names the portal Da Vinci escalation as such, in the customer's own words", async () => {
    const data = await customerSees(storedTicket({
      subject: "[Da Vinci Эскалация] Hesabıma daxil ola bilmirəm",
      description: "Автоматически создан при эскалации из Da Vinci чата.\n\nСессия: sess_123\n\n--- ИСТОРИЯ ЧАТА ---\n[Клиент] Hesabıma daxil ola bilmirəm",
    }, [comment("c1", "[Клиент] Hesabıma daxil ola bilmirəm")]))

    expect(data.subject).toBe("Hesabıma daxil ola bilmirəm")
    expect(data.description).toBeNull()
    expect(data.descriptionOrigin).toBe("assistant_chat")
    expect(data.comments[0]).toMatchObject({ comment: "Hesabıma daxil ola bilmirəm", author: "customer", isAgent: false })
    expect(JSON.stringify(data)).not.toContain("sess_123")
  })
})

describe("what the customer or an agent wrote themselves", () => {
  it("is shown exactly as written — brackets included", async () => {
    const data = await customerSees(storedTicket({
      subject: "[URGENT] Printer does not print",
      description: "Since this morning the office printer prints blank pages.",
    }, [
      comment("c1", "It still prints blank pages."),
      comment("c2", "[Клиент] is what my colleague typed, literally", "agent-1"),
    ]))

    expect(data.subject).toBe("[URGENT] Printer does not print")
    expect(data.description).toBe("Since this morning the office printer prints blank pages.")
    expect(data.descriptionOrigin).toBeNull()
    expect(data.comments).toEqual([
      expect.objectContaining({ comment: "It still prints blank pages.", author: "customer", authorName: "Aysel Məmmədova" }),
      expect.objectContaining({ comment: "[Клиент] is what my colleague typed, literally", author: "agent", authorName: "Leyla" }),
    ])
  })
})

describe("the customer's ticket list", () => {
  it("shows subjects without the prefix a chat channel put there for the team", async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([
      { id: "tk-1", ticketNumber: "WA-0042", subject: "[WhatsApp Тикет] Salam, sifarişim gəlmədi", status: "open" },
      { id: "tk-2", ticketNumber: "DV-0007", subject: "[Da Vinci eskalasiyası] Hesabıma daxil ola bilmirəm", status: "open" },
      { id: "tk-3", ticketNumber: "SUP-0001", subject: "[URGENT] Printer", status: "open" },
    ] as never)

    const response = await LIST_TICKETS()
    const body = await response.json()

    expect(body.data.map((t: { subject: string }) => t.subject)).toEqual([
      "Salam, sifarişim gəlmədi",
      "Hesabıma daxil ola bilmirəm",
      "[URGENT] Printer",
    ])
  })
})
