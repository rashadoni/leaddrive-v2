import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

/**
 * What the customer receives when an agent resolves the ticket — in the
 * customer's language: the contact's own, else the organization's
 * (`settings.language`), else the application default.
 *
 * Found 2026-10-17 while building the Service Desk chapter of the demo: an
 * Azerbaijani organization's WhatsApp customer got «Ваш тикет … отмечен как
 * решён» plus «Your ticket #… has been resolved», and the confirmation page
 * behind the link opened in Russian.
 */

vi.mock("@/lib/prisma", () => {
  const prismaMock = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prismaMock)),
    ticket: { findFirst: vi.fn(), updateMany: vi.fn() },
    ticketCategory: { findFirst: vi.fn().mockResolvedValue(null) },
    ticketClosureRequest: { updateMany: vi.fn(), create: vi.fn() },
    organization: { findUnique: vi.fn() },
    contact: { findFirst: vi.fn() },
    channelConfig: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    channelMessage: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn() },
    survey: { findFirst: vi.fn().mockResolvedValue(null) },
    entitlementTicketMilestone: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    entitlementAuditEvent: { create: vi.fn() },
  }
  return { prisma: prismaMock, logAudit: vi.fn() }
})

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((result: unknown) => result instanceof NextResponse),
}))
vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn().mockResolvedValue([]),
  requireFieldPermissions: vi.fn().mockResolvedValue([]),
  filterEntityFields: vi.fn().mockImplementation((data: unknown) => data),
  filterWritableFields: vi.fn().mockImplementation((data: unknown) => data),
}))
vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/auto-assign", () => ({ autoAssignTicket: vi.fn() }))
vi.mock("@/lib/survey-triggers", () => ({ triggerSurveysOnTicketResolved: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }))

import { PUT } from "@/app/api/v1/tickets/[id]/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { sendWhatsAppMessage } from "@/lib/whatsapp"
import { sendEmail } from "@/lib/email"

const CYRILLIC = /[А-Яа-яЁё]/
const PHONE = "994501234567"

const WHATSAPP_TICKET = {
  id: "tk-wa",
  organizationId: "org-1",
  ticketNumber: "WA-0042",
  subject: "[WhatsApp müraciəti] Salam, sifarişim gəlmədi",
  description: `Создан из входящего WhatsApp сообщения.\nКлиент: Aysel (+${PHONE})\n\n--- СООБЩЕНИЕ ---\nSalam, sifarişim gəlmədi`,
  status: "open",
  priority: "medium",
  tags: ["whatsapp", "inbound_whatsapp", "auto_created"],
  source: "whatsapp",
  sourceMeta: { phone: PHONE },
  requesterEmail: null,
  requesterPhone: `+${PHONE}`,
  requesterExternalId: "contact-1",
  contactId: "contact-1",
}

const EMAIL_TICKET = {
  ...WHATSAPP_TICKET,
  id: "tk-mail",
  ticketNumber: "SUP-0007",
  subject: "Hesab-faktura açılmır",
  description: "Dünən göndərilən hesab-faktura açılmır.",
  tags: [],
  source: "email",
  sourceMeta: null,
  requesterEmail: "aysel@example.az",
  requesterPhone: null,
}

function resolve(ticket: typeof WHATSAPP_TICKET) {
  vi.mocked(prisma.ticket.findFirst)
    .mockResolvedValueOnce(ticket as never)
    .mockResolvedValueOnce({ ...ticket, status: "resolved", resolvedAt: new Date(), comments: [] } as never)
  return PUT(
    new Request(`http://localhost/api/v1/tickets/${ticket.id}`, { method: "PUT", body: JSON.stringify({ status: "resolved" }) }) as never,
    { params: Promise.resolve({ id: ticket.id }) },
  )
}

function organization(settings: Record<string, unknown>) {
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings } as never)
}

function contactLanguage(preferredLanguage: string | null) {
  vi.mocked(prisma.contact.findFirst).mockResolvedValue({ preferredLanguage, phone: null } as never)
}

async function whatsAppMessages(count: number): Promise<Array<{ to: string; message: string }>> {
  await vi.waitFor(() => expect(vi.mocked(sendWhatsAppMessage).mock.calls.length).toBe(count))
  for (const [input] of vi.mocked(sendWhatsAppMessage).mock.calls) {
    expect(input).toMatchObject({ organizationId: "org-1", channelConfigId: "wa-1" })
  }
  return vi.mocked(sendWhatsAppMessage).mock.calls.map(([input]) => ({ to: String(input.to), message: String(input.message) }))
}

/** The two messages a resolved WhatsApp ticket sends race each other; tell them apart by the link. */
async function resolvedMessages(): Promise<{ closure: { to: string; message: string }; status: { to: string; message: string } }> {
  const sent = await whatsAppMessages(2)
  const closure = sent.find((m) => m.message.includes("/ticket-closure/"))
  const status = sent.find((m) => !m.message.includes("/ticket-closure/"))
  if (!closure || !status) throw new Error(`expected a closure request and a status message, got ${JSON.stringify(sent)}`)
  return { closure, status }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test"
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "agent-1", role: "admin" } as never)
  vi.mocked(prisma.ticket.updateMany).mockResolvedValue({ count: 1 } as never)
  // These are existing session-text notifications on the number that received
  // the customer. No saved mapping means legacy fallback, not an explicit off.
  vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([{ channelConfigId: "wa-1" }] as never)
  vi.mocked(prisma.channelConfig.findFirst).mockImplementation(async (query: unknown) => {
    const where = (query as { where: { id?: string; organizationId?: string; isActive?: boolean } }).where
    return where.id === "wa-1" && where.organizationId === "org-1" && where.isActive
      ? { id: "wa-1", settings: {} } as never : null
  })
  vi.mocked(prisma.ticketClosureRequest.updateMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.ticketClosureRequest.create).mockImplementation((async (args: { data: { channel: string | null; recipient: string | null } }) => ({
    id: "closure-1",
    status: "pending",
    channel: args.data.channel,
    recipient: args.data.recipient,
    requestedAt: new Date("2026-10-17T08:00:00.000Z"),
    dueAt: new Date("2026-10-24T08:00:00.000Z"),
    confirmedAt: null,
    rejectedAt: null,
    expiredAt: null,
    canceledAt: null,
  })) as never)
})

describe("resolving a WhatsApp ticket", () => {
  it("writes to the customer of an Azerbaijani organization in Azerbaijani, link included", async () => {
    organization({ language: "az" })
    contactLanguage(null)

    const res = await resolve(WHATSAPP_TICKET)
    expect(res.status).toBe(200)

    const { closure, status } = await resolvedMessages()
    expect(closure.to).toBe(`+${PHONE}`)
    expect(closure.message).toMatch(
      /^Müraciətiniz WA-0042 həll olunmuş kimi qeyd edildi\. Bağlanmasını təsdiqləyin və ya dəstəyə qaytarın: https:\/\/app\.example\.test\/ticket-closure\/[\w-]+\?lang=az$/,
    )
    expect(status.to).toBe(PHONE)
    expect(status.message).toBe("Müraciətiniz WA-0042 həll olundu. Bizə müraciət etdiyiniz üçün təşəkkür edirik.")
    for (const { message } of [closure, status]) expect(message).not.toMatch(CYRILLIC)
  })

  it("follows the contact's own language over the organization's", async () => {
    organization({ language: "az" })
    contactLanguage("en")

    await resolve(WHATSAPP_TICKET)

    const { closure, status } = await resolvedMessages()
    expect(closure.message).toMatch(/^Your ticket WA-0042 has been marked as resolved\. .*\?lang=en$/)
    expect(status.message).toBe("Your ticket WA-0042 has been resolved. Thank you for contacting us.")
  })

  it("keeps an organization that chose no language on the application default, Russian", async () => {
    organization({})
    contactLanguage(null)

    await resolve(WHATSAPP_TICKET)

    const { closure, status } = await resolvedMessages()
    expect(closure.message).toMatch(/^Ваш тикет WA-0042 отмечен как решён\. Подтвердите закрытие или верните в работу: .*\?lang=ru$/)
    expect(status.message).toBe("Ваш тикет WA-0042 решён. Спасибо за обращение.")
  })

  it("tells the customer of a status change in their language when no Meta template is set", async () => {
    organization({ language: "az" })
    contactLanguage(null)
    vi.mocked(prisma.ticket.findFirst)
      .mockResolvedValueOnce(WHATSAPP_TICKET as never)
      .mockResolvedValueOnce({ ...WHATSAPP_TICKET, status: "waiting", comments: [] } as never)

    await PUT(
      new Request("http://localhost/api/v1/tickets/tk-wa", { method: "PUT", body: JSON.stringify({ status: "waiting" }) }) as never,
      { params: Promise.resolve({ id: "tk-wa" }) },
    )

    const [{ message }] = await whatsAppMessages(1)
    expect(message).toBe("WA-0042 müraciəti üzrə bizə əlavə məlumat lazımdır. Zəhmət olmasa, ətraflı cavab yazın.")
  })
})

describe("resolving an e-mail ticket", () => {
  it("sends the closure e-mail in Azerbaijani, with the deadline on the organization's clock", async () => {
    organization({ language: "az", timezone: "Asia/Baku" })
    contactLanguage(null)

    await resolve(EMAIL_TICKET as never)

    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledOnce())
    const email = vi.mocked(sendEmail).mock.calls[0][0] as { to: string; subject: string; html: string; text: string }
    expect(email.to).toBe("aysel@example.az")
    expect(email.subject).toBe("SUP-0007 müraciətinin bağlanmasını təsdiqləyin")
    expect(email.html).toContain("Təsdiqi aç")
    expect(email.html).toContain("Hesab-faktura açılmır")
    // 08:00 UTC is noon in Baku, and the reader is told which clock.
    expect(email.text).toContain("Cavab verməsəniz, müraciət avtomatik bağlanacaq: 24.10.2026, 12:00 (GMT+4).")
    expect(email.text).toMatch(/\/ticket-closure\/[\w-]+\?lang=az/)
    for (const part of [email.subject, email.html, email.text]) expect(part).not.toMatch(CYRILLIC)
  })

  it("shows the customer the subject without the prefix a chat channel put there for the team", async () => {
    organization({ language: "en" })
    contactLanguage(null)

    await resolve({ ...EMAIL_TICKET, subject: "[WhatsApp Тикет] Invoice will not open" } as never)

    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledOnce())
    const email = vi.mocked(sendEmail).mock.calls[0][0] as { html: string; text: string }
    expect(email.text).toContain("Subject: Invoice will not open")
    expect(email.html).not.toContain("WhatsApp Тикет")
  })
})
