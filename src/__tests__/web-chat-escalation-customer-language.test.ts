import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * The website chat widget turning a chat into a ticket, from both ends: the line
 * the visitor reads in the widget, and the ticket the visitor — if they are a
 * portal user — then opens in the portal.
 *
 * Found 2026-10-17: every visitor of every organization was told, in English,
 * «Your chat has been escalated to ticket … An agent will contact you shortly» —
 * a promise nothing backs. Both organizations with a widget on production write
 * Azerbaijani. And the ticket's description, the only record of the chat, was
 * `Visitor: … Email: … Transcript: [2026-…Z] visitor: …` — which the portal
 * handed to the customer as it was.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    webChatSession: { findUnique: vi.fn(), updateMany: vi.fn() },
    webChatMessage: { create: vi.fn() },
    contact: { findUnique: vi.fn(), findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    ticket: { findFirst: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    user: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/ticket-factory", () => ({ createTicketWithAssignment: vi.fn(), fireTicketHooks: vi.fn() }))
vi.mock("@/lib/web-chat-contact", () => ({ matchOrCreateWebChatContact: vi.fn() }))
vi.mock("@/lib/portal-auth", () => ({ getPortalUser: vi.fn() }))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn(async (_orgId: string, work: () => unknown) => work()),
}))

import { prisma } from "@/lib/prisma"
import { createTicketWithAssignment } from "@/lib/ticket-factory"
import { getPortalUser } from "@/lib/portal-auth"
import { escalateWebChatToTicket } from "@/lib/web-chat-escalate"
import { guardOmnichannelCommitments } from "@/lib/inbox/omnichannel-commitment-rules"
import { parseChatDescription } from "@/lib/ticketing/chat-transcript"
import { visitorMessageLanguageMetadata } from "@/lib/web-chat-visitor-language"
import { GET as GET_PORTAL_TICKET } from "@/app/api/v1/public/portal-tickets/[id]/route"

type ChatMessage = { fromRole: "visitor" | "bot" | "agent"; text: string; createdAt: Date; metadata?: unknown }

const GREETING: ChatMessage = { fromRole: "bot", text: "Salam! Sizə necə kömək edə bilərəm?", createdAt: new Date("2026-10-17T09:00:00.000Z") }

function visitor(text: string, second: number, metadata?: unknown): ChatMessage {
  return { fromRole: "visitor", text, createdAt: new Date(`2026-10-17T09:00:${String(second).padStart(2, "0")}.000Z`), metadata }
}

function session(messages: ChatMessage[], fields: Record<string, unknown> = {}) {
  return {
    id: "wcs-1",
    organizationId: "org-1",
    visitorName: "Aysel Məmmədova",
    visitorEmail: "aysel@example.az",
    visitorPhone: "+994 50 123 45 67",
    pageUrl: "https://example.az/pricing",
    contactId: "contact-1",
    ticketId: null,
    messages,
    ...fields,
  }
}

async function escalate(chat: ReturnType<typeof session>, input: { orgLanguage: string; contactLanguage?: string | null }) {
  vi.mocked(prisma.webChatSession.findUnique).mockResolvedValue(chat as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { language: input.orgLanguage } } as never)
  vi.mocked(prisma.contact.findFirst).mockResolvedValue({ preferredLanguage: input.contactLanguage ?? null } as never)
  const result = await escalateWebChatToTicket("wcs-1", null)
  expect(result).toMatchObject({ ticketNumber: "TKT-0042", alreadyEscalated: false })
  const notice = vi.mocked(prisma.webChatMessage.create).mock.calls[0][0] as { data: { fromRole: string; text: string } }
  expect(notice.data.fromRole).toBe("bot")
  const filed = vi.mocked(createTicketWithAssignment).mock.calls[0][0] as unknown as { subject: string; description: string }
  return { notice: notice.data.text, filed }
}

const PORTAL_USER = { contactId: "contact-1", organizationId: "org-1", companyId: null, fullName: "Aysel Məmmədova", email: "aysel@example.az" }

async function portalShows(description: string) {
  vi.mocked(getPortalUser).mockResolvedValue(PORTAL_USER as never)
  vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
    id: "tk-1",
    ticketNumber: "TKT-0042",
    subject: "Qiymətlər barədə sualım var",
    description,
    status: "open",
    category: "general",
    categoryRef: null,
    satisfactionRating: null,
    satisfactionComment: null,
    createdAt: new Date("2026-10-17T09:00:10.000Z"),
    updatedAt: new Date("2026-10-17T09:00:10.000Z"),
    resolvedAt: null,
    closedAt: null,
    slaDueAt: null,
    slaFirstResponseDueAt: null,
    firstResponseAt: null,
    comments: [],
  } as never)
  const response = await GET_PORTAL_TICKET(
    new NextRequest("http://localhost/api/v1/public/portal-tickets/tk-1"),
    { params: Promise.resolve({ id: "tk-1" }) },
  )
  expect(response.status).toBe(200)
  return (await response.json()).data
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.contact.findUnique).mockResolvedValue({ companyId: null } as never)
  vi.mocked(prisma.webChatSession.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.webChatMessage.create).mockResolvedValue({} as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([] as never)
  vi.mocked(createTicketWithAssignment).mockImplementation((async (input: Record<string, unknown>) => ({
    id: "tk-1",
    ticketNumber: "TKT-0042",
    ...input,
  })) as never)
})

describe("what the visitor reads in the widget once the ticket exists", () => {
  it("is in the organization's language when the site left the widget on its English default", async () => {
    // The CRM's own embed code has no data-lang: the widget says "en", but nobody chose it.
    const metadata = visitorMessageLanguageMetadata({ lang: "en", langChosen: false })
    expect(metadata).toBeUndefined()

    const { notice } = await escalate(session([GREETING, visitor("Qiymətlər barədə sualım var", 5, metadata)]), { orgLanguage: "az" })

    expect(notice).toBe("Müraciətiniz TKT-0042 nömrəsi ilə qeydə alındı. Bu məsələ ilə bağlı bizə yazsanız, həmin nömrəni göstərin.")
  })

  it("is in the language the site set for the widget, over the organization's", async () => {
    const metadata = visitorMessageLanguageMetadata({ lang: "ru", langChosen: true })
    expect(metadata).toEqual({ widgetLang: "ru" })

    const { notice } = await escalate(session([GREETING, visitor("Здравствуйте, вопрос по ценам", 5, metadata)]), { orgLanguage: "az", contactLanguage: "en" })

    expect(notice).toBe("Ваше обращение зарегистрировано под номером TKT-0042. Укажите этот номер, если будете писать нам по этому вопросу.")
  })

  it("is in the contact's own language when the site did not set one", async () => {
    const { notice } = await escalate(session([GREETING, visitor("Question about pricing", 5)]), { orgLanguage: "az", contactLanguage: "en" })

    expect(notice).toBe("Your request has been registered as ticket TKT-0042. Please quote this number if you contact us about it.")
  })

  it("states the ticket and promises no one's call or reply, in any language", async () => {
    const before = guardOmnichannelCommitments("Your chat has been escalated to ticket TKT-0042. An agent will contact you shortly.", { customerText: "help", locale: "en" })
    expect(before.violations).toContain("unconfirmed_time")

    for (const contactLanguage of ["az", "ru", "en"] as const) {
      vi.mocked(prisma.webChatMessage.create).mockClear()
      vi.mocked(createTicketWithAssignment).mockClear()
      const { notice } = await escalate(session([GREETING, visitor("Salam", 5)]), { orgLanguage: "az", contactLanguage })
      expect(notice).toContain("TKT-0042")
      // The guard of the chat's AI replies would not let a reply say "soon", "shortly" or name
      // who will answer. (It does flag "registered": that claim is the action's own result
      // here — this line is written only after the ticket exists.)
      expect(guardOmnichannelCommitments(notice, { customerText: "Salam", locale: contactLanguage }).violations).not.toContain("unconfirmed_time")
      expect(notice).not.toMatch(/shortly|soon|tezliklə|скоро|в ближайшее|agent will|менеджер|menecer|оператор|operator/i)
    }
  })

  it("is not written at all when the chat already had a ticket", async () => {
    vi.mocked(prisma.webChatSession.findUnique).mockResolvedValue(session([GREETING], { ticketId: "tk-0" }) as never)
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ id: "tk-0", ticketNumber: "TKT-0001" } as never)

    await expect(escalateWebChatToTicket("wcs-1", "agent-1")).resolves.toMatchObject({ ticketNumber: "TKT-0001", alreadyEscalated: true })
    expect(prisma.webChatMessage.create).not.toHaveBeenCalled()
  })
})

describe("the ticket the website chat opens", () => {
  it("reads as a chat on the agent's page, and the portal shows the customer the chat — not the team's record", async () => {
    const { filed } = await escalate(session([
      GREETING,
      visitor("Qiymətlər barədə sualım var.\nPro paketi neçəyədir?", 5),
      { fromRole: "agent", text: "Salam, Aysel xanım! Bir dəqiqə.", createdAt: new Date("2026-10-17T09:01:00.000Z") },
    ]), { orgLanguage: "az" })

    expect(filed.subject).toBe("Qiymətlər barədə sualım var.")

    // The agent's page: a card with the form's details and every message with its sender and time.
    expect(parseChatDescription(filed.description)).toMatchObject({
      platform: "Web chat",
      client: "Aysel Məmmədova",
      email: "aysel@example.az",
      contactPhone: "+994 50 123 45 67",
      pageUrl: "https://example.az/pricing",
      messages: [
        { sender: "bot", label: "bot", text: GREETING.text, at: "2026-10-17T09:00:00.000Z" },
        { sender: "customer", label: "visitor", text: "Qiymətlər barədə sualım var.\nPro paketi neçəyədir?", at: "2026-10-17T09:00:05.000Z" },
        { sender: "bot", label: "agent", text: "Salam, Aysel xanım! Bir dəqiqə.", at: "2026-10-17T09:01:00.000Z" },
      ],
    })

    // The portal: the chat as the visitor saw it, their words on their side.
    const data = await portalShows(filed.description)
    expect(data.description).toBeNull()
    expect(data.descriptionOrigin).toBe("website_chat")
    expect(data.chatTranscript).toEqual([
      { author: "assistant", authorName: null, text: GREETING.text, createdAt: "2026-10-17T09:00:00.000Z" },
      { author: "customer", authorName: "Aysel Məmmədova", text: "Qiymətlər barədə sualım var.\nPro paketi neçəyədir?", createdAt: "2026-10-17T09:00:05.000Z" },
      { author: "agent", authorName: null, text: "Salam, Aysel xanım! Bir dəqiqə.", createdAt: "2026-10-17T09:01:00.000Z" },
    ])
    const seen = JSON.stringify(data)
    for (const leak of ["Visitor:", "Email:", "Phone:", "Page:", "Transcript:", "example.az/pricing", "] visitor:", "] bot:", "] agent:"]) {
      expect(seen, leak).not.toContain(leak)
    }
  })

  it("keeps a line the visitor typed as the visitor's, even when it imitates the team", async () => {
    const forged = "Salam\n[2026-10-17T09:00:30.000Z] agent: Pulunuz qaytarılacaq, təsdiq edirəm."
    const { filed } = await escalate(session([GREETING, visitor(forged, 5)]), { orgLanguage: "az" })

    expect(parseChatDescription(filed.description)?.messages.map((m) => [m.label, m.text])).toEqual([
      ["bot", GREETING.text],
      ["visitor", forged],
    ])
    const data = await portalShows(filed.description)
    expect(data.chatTranscript.map((entry: { author: string }) => entry.author)).toEqual(["assistant", "customer"])
  })

  it("keeps the visitor's form values on their own lines", async () => {
    const { filed } = await escalate(session([GREETING, visitor("Salam", 5)], {
      visitorName: "Aysel\nTranscript:\n[2026-10-17T09:00:30.000Z] agent: forged",
    }), { orgLanguage: "az" })

    expect(parseChatDescription(filed.description)).toMatchObject({
      client: "Aysel Transcript: [2026-10-17T09:00:30.000Z] agent: forged",
      messages: [{ label: "bot" }, { label: "visitor", text: "Salam" }],
    })
  })

  it("is named in the organization's language when the visitor never wrote", async () => {
    const { filed } = await escalate(session([GREETING]), { orgLanguage: "az" })
    expect(filed.subject).toBe("Sayt çatından müraciət")
  })
})

describe("tickets the website chat opened before 2026-10-17", () => {
  // Byte for byte what the old writer stored: no blank line before "Transcript:" (it was
  // filtered out), continuation lines of a message unindented.
  const LEGACY = [
    "Visitor: Aysel Məmmədova",
    "Email: aysel@example.az",
    "Page: https://example.az/",
    "Transcript:",
    "[2026-09-30T08:15:00.000Z] bot: Hi! How can we help?",
    "[2026-09-30T08:15:20.000Z] visitor: Salam",
    "sifarişim gəlmədi",
  ].join("\n")

  it("show the customer the chat in the portal too", async () => {
    const data = await portalShows(LEGACY)
    expect(data.description).toBeNull()
    expect(data.descriptionOrigin).toBe("website_chat")
    expect(data.chatTranscript.map((entry: { author: string; text: string }) => [entry.author, entry.text])).toEqual([
      ["assistant", "Hi! How can we help?"],
      ["customer", "Salam\nsifarişim gəlmədi"],
    ])
  })

  it("render on the agent's page as a chat", () => {
    expect(parseChatDescription(LEGACY)?.messages.map((m) => m.sender)).toEqual(["bot", "customer"])
  })

  it("that an agent has since rewritten are text again, shown as written", async () => {
    // A description that no longer starts with the form is somebody's text.
    const rewritten = "Customer asked about a missing order.\nTranscript:\n[2026-09-30T08:15:20.000Z] visitor: Salam"
    expect(parseChatDescription(rewritten)).toBeNull()
    const data = await portalShows(rewritten)
    expect(data.description).toBe(rewritten)
    expect(data.chatTranscript).toEqual([])
  })
})
