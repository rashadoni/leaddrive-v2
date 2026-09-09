import { beforeEach, describe, expect, it, vi } from "vitest"

interface AnthropicRequest {
  messages: Array<{ role: string; content: string }>
}

const h = vi.hoisted(() => ({
  lastRequest: null as AnthropicRequest | null,
  responseText: "{}",
}))

const db = vi.hoisted(() => ({
  aiInteractionLogCreate: vi.fn(async () => ({})),
  contactFindMany: vi.fn(),
  dealFindFirst: vi.fn(),
  kbArticleFindMany: vi.fn(),
}))

vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: AnthropicRequest) => {
        h.lastRequest = request
        return {
          content: [{ type: "text", text: h.responseText }],
          usage: { input_tokens: 20, output_tokens: 10 },
        }
      },
    },
  }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    // orgStageVocabulary resolves won/lost spellings before the route's own
    // query; both of these must answer for any deal-touching route.
    pipelineStage: { findMany: vi.fn().mockResolvedValue([]) },
    aiInteractionLog: { create: db.aiInteractionLogCreate },
    contact: { findMany: db.contactFindMany },
    deal: { groupBy: vi.fn().mockResolvedValue([]), findFirst: db.dealFindFirst },
    kbArticle: { findMany: db.kbArticleFindMany },
  },
}))

vi.mock("@/lib/ai/budget", () => ({
  calculateAiCost: () => 0.001,
}))

import { generateRenewalProposal } from "@/lib/ai/renewal"
import { processMeetingRecap } from "@/lib/ai/meeting-recap"
import { draftSocialReply } from "@/lib/ai/social-reply"
import { matchTicketToKb } from "@/lib/ai/kb-match"

beforeEach(() => {
  vi.clearAllMocks()
  h.lastRequest = null
  h.responseText = "{}"
})

describe("shadow-action AI helpers PII masking", () => {
  it("masks renewal contact and company PII before Anthropic and unmasks draft output", async () => {
    h.responseText = JSON.stringify({
      proposedValue: 1050,
      reasoning: "Standard uplift for [COMPANY_1].",
      emailSubject: "Renewal for [COMPANY_1]",
      emailBody: "<p>Hello [PERSON_1], we will use [EMAIL_1].</p>",
    })

    const result = await generateRenewalProposal({
      id: "contract-1",
      organizationId: "org-1",
      valueAmount: 1000,
      currency: "USD",
      endDate: new Date("2026-08-10T00:00:00.000Z"),
      type: "support agreement",
      company: { id: "company-1", name: "Acme Health LLC" },
      contact: { id: "contact-1", fullName: "Aysel Məmmədova", email: "aysel@example.com", preferredLanguage: "en" },
    } as never, "LeadDrive LLC", "en")

    const payload = h.lastRequest?.messages[0]?.content ?? ""
    expect(payload).toContain("[PERSON_")
    expect(payload).toContain("[EMAIL_")
    expect(payload).toContain("[COMPANY_")
    expect(payload).not.toContain("Aysel Məmmədova")
    expect(payload).not.toContain("aysel@example.com")
    expect(payload).not.toContain("Acme Health LLC")
    expect(result?.emailBody).toContain("Aysel Məmmədova")
    expect(result?.emailBody).toContain("aysel@example.com")
    expect(result?.emailSubject).toContain("Acme Health LLC")
  })

  it("masks meeting participant PII and transcript PII before Anthropic", async () => {
    db.contactFindMany.mockResolvedValue([
      { id: "contact-1", fullName: "Ivan Petrov", email: "ivan@example.com", companyId: "company-1" },
    ])
    db.dealFindFirst.mockResolvedValue({
      id: "deal-1",
      name: "Acme renewal",
      stage: "open",
      valueAmount: 3000,
      currency: "USD",
    })
    h.responseText = JSON.stringify({
      summary: "Call [PHONE_1] was mentioned.",
      nextSteps: ["Follow up with [PERSON_1]"],
      emailSubject: "Recap for [PERSON_1]",
      emailBody: "<p>Hi [PERSON_1], we noted [EMAIL_1] and [PHONE_1].</p>",
    })

    const result = await processMeetingRecap({
      orgId: "org-1",
      title: "Renewal call with Ivan Petrov",
      participants: ["ivan@example.com", "agent@leaddrivecrm.org"],
      transcript: "Ivan Petrov asked us to call +994 50 123 45 67 and email ivan@example.com.",
      meetingDate: new Date("2026-07-05T10:00:00.000Z"),
      providerId: "meeting-1",
    })

    const payload = h.lastRequest?.messages[0]?.content ?? ""
    expect(payload).toContain("[PERSON_")
    expect(payload).toContain("[EMAIL_")
    expect(payload).toContain("[PHONE_")
    expect(payload).not.toContain("Ivan Petrov")
    expect(payload).not.toContain("ivan@example.com")
    expect(payload).not.toContain("+994 50 123 45 67")
    expect(result?.emailBody).toContain("Ivan Petrov")
    expect(result?.emailBody).toContain("ivan@example.com")
    expect(result?.emailBody).toContain("+994 50 123 45 67")
  })

  it("masks public social mention PII and does not unmask it into the public reply draft", async () => {
    h.responseText = JSON.stringify({
      reply: "Hi [PERSON_1], please send [EMAIL_1] in DM.",
      tone: "supportive",
      reasoning: "Move private details to DM.",
    })

    const result = await draftSocialReply({
      id: "mention-1",
      organizationId: "org-1",
      platform: "instagram",
      text: "I need help, email me at public@example.com or call +994 50 123 45 67.",
      authorName: "Leyla Aliyeva",
      authorHandle: "leyla_public",
      sentiment: "negative",
    }, "LeadDrive", "en")

    const payload = h.lastRequest?.messages[0]?.content ?? ""
    expect(payload).toContain("[PERSON_")
    expect(payload).toContain("[EMAIL_")
    expect(payload).toContain("[PHONE_")
    expect(payload).not.toContain("Leyla Aliyeva")
    expect(payload).not.toContain("public@example.com")
    expect(payload).not.toContain("+994 50 123 45 67")
    expect(result?.reply).not.toContain("[EMAIL_")
    expect(result?.reply).not.toContain("public@example.com")
    expect(result?.reply).not.toContain("+994 50 123 45 67")
  })

  it("masks ticket and KB article PII before Anthropic during KB matching", async () => {
    db.kbArticleFindMany.mockResolvedValue([
      {
        id: "article-1",
        title: "Password reset",
        content: "Ask the user to email support@example.com or call +994 55 111 22 33.",
      },
    ])
    h.responseText = JSON.stringify({
      articleId: "article-1",
      articleTitle: "Password reset",
      confidence: 0.91,
      reasoning: "The article matches [EMAIL_1].",
    })

    const result = await matchTicketToKb({
      id: "ticket-1",
      organizationId: "org-1",
      subject: "Reset password for customer@example.com",
      description: "Please call +994 50 123 45 67 about reset instructions.",
    })

    const payload = h.lastRequest?.messages[0]?.content ?? ""
    expect(payload).toContain("[EMAIL_")
    expect(payload).toContain("[PHONE_")
    expect(payload).not.toContain("customer@example.com")
    expect(payload).not.toContain("support@example.com")
    expect(payload).not.toContain("+994 50 123 45 67")
    expect(payload).not.toContain("+994 55 111 22 33")
    expect(result).toMatchObject({ articleId: "article-1", articleTitle: "Password reset", confidence: 0.91 })
  })
})
