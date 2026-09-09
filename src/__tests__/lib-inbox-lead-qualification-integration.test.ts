import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const prisma = {
    organization: { findUnique: vi.fn() },
    aiAgentConfig: { findFirst: vi.fn() },
    socialConversation: { findFirst: vi.fn(), update: vi.fn() },
    contact: { findFirst: vi.fn() },
    channelMessage: { findMany: vi.fn(), updateMany: vi.fn() },
    division: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    lead: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    pipeline: { findMany: vi.fn() },
    task: { aggregate: vi.fn(), create: vi.fn() },
    customField: { upsert: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  return {
    prisma,
    anthropicCreate: vi.fn(),
    logAudit: vi.fn(),
    createNotification: vi.fn(),
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
  logAudit: mocks.logAudit,
}))
vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: () => ({ messages: { create: mocks.anthropicCreate } }),
}))
vi.mock("@/lib/tasks/task-key", () => ({
  generateTaskKey: vi.fn().mockResolvedValue("MKT-1"),
}))
vi.mock("@/lib/notifications", () => ({
  createNotification: mocks.createNotification,
}))

import { maybeCreateQualifiedLeadTask } from "@/lib/inbox/lead-qualification"

describe("inbox AI lead qualification — persisted ownership and tailored pitch", () => {
  const priorApiKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks keeps queued mockResolvedValueOnce values. A phone-rejected
    // early return consumes only the first lookup, so reset this queue before
    // constructing the two-lookups sequence for the next test.
    mocks.prisma.socialConversation.findFirst.mockReset()
    process.env.ANTHROPIC_API_KEY = "test-key"

    mocks.prisma.organization.findUnique.mockResolvedValue({
      features: ["inboxLeadQualification", "inboxLeadQualificationBoard:board-1"],
      settings: { timezone: "Asia/Baku" },
    })
    mocks.prisma.aiAgentConfig.findFirst.mockResolvedValue({
      model: "claude-sonnet-4-6",
      autoAssignSales: true,
    })
    mocks.prisma.socialConversation.findFirst
      .mockResolvedValueOnce({
        id: "conv-1",
        platform: "whatsapp",
        externalId: "+994501112233",
        contactId: "contact-1",
        contactName: "Aysel",
        assignedTo: "agent-1",
        metadata: {},
      })
      .mockResolvedValueOnce({ metadata: {} })
    mocks.prisma.contact.findFirst.mockResolvedValue({
      fullName: "Aysel",
      phone: "+994 50 111 22 33",
      phones: [],
      email: "aysel@example.com",
      company: { name: "Acme" },
    })
    mocks.prisma.channelMessage.findMany.mockResolvedValue([
      {
        body: "Qiymət və 12 aylıq kredit maraqlıdır. Nömrəm +994 50 111 22 33",
        direction: "inbound",
        createdAt: new Date("2026-07-24T07:55:00.000Z"),
        metadata: {},
      },
    ])
    mocks.prisma.division.findFirst.mockResolvedValue({
      id: "board-1",
      key: "MKT",
      boardColumns: [{ key: "backlog", mapsToStatus: "backlog" }],
    })
    mocks.prisma.lead.findFirst.mockResolvedValue(null)
    mocks.prisma.lead.create.mockResolvedValue({ id: "lead-1" })
    mocks.prisma.user.findMany.mockResolvedValue([
      { id: "seller-1", name: "Seller One", email: "seller@example.com" },
    ])
    mocks.prisma.lead.groupBy.mockResolvedValue([])
    mocks.prisma.pipeline.findMany.mockResolvedValue([
      { id: "pipe-smm", name: "SMM" },
    ])
    mocks.prisma.task.aggregate.mockResolvedValue({ _max: { boardPosition: null } })
    mocks.prisma.customField.upsert.mockResolvedValue({ id: "field-1" })
    mocks.prisma.task.create.mockResolvedValue({ id: "task-1" })
    mocks.prisma.socialConversation.update.mockResolvedValue({ id: "conv-1" })
    mocks.prisma.channelMessage.updateMany.mockResolvedValue({ count: 1 })
    mocks.createNotification.mockResolvedValue(undefined)
    mocks.prisma.$executeRaw.mockResolvedValue(0)
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
    )
    mocks.anthropicCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          realCustomer: true,
          commercialIntent: true,
          category: "credit",
          confidence: 0.91,
          summary: "Müştəri 12 aylıq kreditlə 55 düymlük televizor axtarır.",
          suggestedPitch: "İlkin ödənişi dəqiqləşdirin və uyğun 55 düymlük modelləri müqayisə edin.",
        }),
      }],
    })
  })

  afterEach(() => {
    if (priorApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = priorApiKey
  })

  it("uses Sonnet, assigns the least-loaded salesperson and stores the AI pitch", async () => {
    const result = await maybeCreateQualifiedLeadTask({
      orgId: "org-1",
      conversationId: "conv-1",
      contactId: "contact-1",
      channelType: "whatsapp",
      inboundText: "Qiymət və 12 aylıq kredit maraqlıdır. Nömrəm +994 50 111 22 33",
      now: new Date("2026-07-24T08:00:00.000Z"),
    })

    expect(result).toEqual({ created: true, leadId: "lead-1", taskId: "task-1" })
    expect(mocks.prisma.lead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        assignedTo: "seller-1",
        pipelineId: "pipe-smm",
        category: "SMM",
        interest: "Müştəri 12 aylıq kreditlə 55 düymlük televizor axtarır.",
        notes: expect.stringContaining("Müştəri: Qiymət və 12 aylıq kredit maraqlıdır"),
      }),
    }))
    expect(mocks.prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        assignedTo: "seller-1",
        customFields: expect.objectContaining({
          inboxSuggestedPitch: "İlkin ödənişi dəqiqləşdirin və uyğun 55 düymlük modelləri müqayisə edin.",
        }),
        checklist: {
          create: expect.arrayContaining([
            expect.objectContaining({
              title: "Satıcı üçün təklif: İlkin ödənişi dəqiqləşdirin və uyğun 55 düymlük modelləri müqayisə edin.",
            }),
          ]),
        },
      }),
    }))
    expect(mocks.anthropicCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "claude-sonnet-4-6",
    }))
    expect(mocks.prisma.channelMessage.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", conversationId: "conv-1" },
      data: { leadId: "lead-1" },
    })
    expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: "seller-1",
      entityId: "lead-1",
    }))
  })

  it("qualifies after a later phone-only reply and preserves the TikTok source profile", async () => {
    mocks.prisma.socialConversation.findFirst.mockReset()
      .mockResolvedValueOnce({
        id: "conv-1",
        platform: "tiktok",
        externalId: "aysel_shop",
        contactId: "contact-1",
        contactName: "Aysel",
        assignedTo: "agent-1",
        metadata: {},
      })
      .mockResolvedValueOnce({ metadata: {} })
    mocks.prisma.contact.findFirst.mockResolvedValue({
      fullName: "Aysel",
      phone: null,
      phones: [],
      email: null,
      company: null,
    })
    // The database query returns newest first. The customer asked the product
    // question first, then supplied only a number after the agent requested it.
    // Reset, not just re-set: vi.clearAllMocks() in beforeEach clears call
    // history but keeps implementations, so without this the previous
    // scenario's transcript leaks into this one's assertion.
    mocks.prisma.channelMessage.findMany.mockReset()
    mocks.prisma.channelMessage.findMany.mockResolvedValue([
      { body: "050 111 22 33", direction: "inbound", createdAt: new Date("2026-07-24T07:59:00.000Z"), metadata: {} },
      { body: "Nömrənizi göndərin.", direction: "outbound", createdAt: new Date("2026-07-24T07:58:00.000Z"), metadata: {} },
      { body: "olchu ve qiymet necedir?", direction: "inbound", createdAt: new Date("2026-07-24T07:57:00.000Z"), metadata: {} },
    ])

    const result = await maybeCreateQualifiedLeadTask({
      orgId: "org-1",
      conversationId: "conv-1",
      contactId: "contact-1",
      channelType: "tiktok",
      inboundText: "050 111 22 33",
      now: new Date("2026-07-24T08:00:00.000Z"),
    })

    expect(result).toEqual({ created: true, leadId: "lead-1", taskId: "task-1" })
    expect(mocks.prisma.lead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: "994501112233",
        source: "tiktok",
        sourceProfileUrl: "https://www.tiktok.com/@aysel_shop",
        category: "SMM",
        notes: expect.stringContaining("AI / agent: Nömrənizi göndərin."),
      }),
    }))
  })

  it("uses the TikTok contact handle when the external id is only a numeric conversation id", async () => {
    mocks.prisma.socialConversation.findFirst.mockReset()
      .mockResolvedValueOnce({
        id: "conv-1",
        platform: "tiktok",
        externalId: "350",
        contactId: "contact-1",
        contactName: "editors_350",
        assignedTo: "agent-1",
        metadata: {},
      })
      .mockResolvedValueOnce({ metadata: {} })

    const result = await maybeCreateQualifiedLeadTask({
      orgId: "org-1",
      conversationId: "conv-1",
      contactId: "contact-1",
      channelType: "tiktok",
      inboundText: "Qiymət və 12 aylıq kredit maraqlıdır. Nömrəm +994 50 111 22 33",
      now: new Date("2026-07-24T08:00:00.000Z"),
    })

    expect(result).toEqual({ created: true, leadId: "lead-1", taskId: "task-1" })
    expect(mocks.prisma.lead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        source: "tiktok",
        sourceDetail: "tiktok",
        sourceProfileUrl: "https://www.tiktok.com/@editors_350",
        category: "SMM",
        contactName: "Aysel",
      }),
    }))
  })

  it("creates the SMM lead when a valid phone is present even if AI confidence is low", async () => {
    mocks.anthropicCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          realCustomer: false,
          commercialIntent: false,
          category: "special_question",
          confidence: 0.2,
          summary: "Qeyri-müəyyən yazışma.",
          suggestedPitch: "",
        }),
      }],
    })

    const result = await maybeCreateQualifiedLeadTask({
      orgId: "org-1",
      conversationId: "conv-1",
      contactId: "contact-1",
      channelType: "tiktok",
      inboundText: "Nömrəm +994 50 111 22 33",
      now: new Date("2026-07-24T08:00:00.000Z"),
    })

    expect(result).toEqual({ created: true, leadId: "lead-1", taskId: "task-1" })
    expect(mocks.prisma.lead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: "994501112233",
        category: "SMM",
        interest: "Müştəri TikTok yazışmasında əlaqə nömrəsi təqdim edib.",
      }),
    }))
  })

  it("does not save a phone the customer attributes to the company as their lead phone", async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue({
      fullName: "Aysel",
      phone: null,
      phones: [],
      email: null,
      company: null,
    })
    mocks.prisma.channelMessage.findMany.mockResolvedValue([
      {
        body: "Это ваш номер +994 50 209 09 99?",
        direction: "inbound",
        createdAt: new Date("2026-07-24T07:59:00.000Z"),
        metadata: {},
      },
    ])

    const result = await maybeCreateQualifiedLeadTask({
      orgId: "org-1",
      conversationId: "conv-1",
      contactId: "contact-1",
      channelType: "tiktok",
      inboundText: "Это ваш номер +994 50 209 09 99?",
      now: new Date("2026-07-24T08:00:00.000Z"),
    })

    expect(result).toEqual({ created: false, reason: "phone-required" })
    expect(mocks.prisma.lead.create).not.toHaveBeenCalled()
    expect(mocks.anthropicCreate).not.toHaveBeenCalled()
  })

  it("keeps the customer's phone when the same message also asks for the company number", async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue({
      fullName: "Aysel",
      phone: null,
      phones: [],
      email: null,
      company: null,
    })
    mocks.prisma.channelMessage.findMany.mockResolvedValue([
      {
        body: "Мой номер 050 111 22 33, а ваш?",
        direction: "inbound",
        createdAt: new Date("2026-07-24T07:59:00.000Z"),
        metadata: {},
      },
    ])

    const result = await maybeCreateQualifiedLeadTask({
      orgId: "org-1",
      conversationId: "conv-1",
      contactId: "contact-1",
      channelType: "tiktok",
      inboundText: "Мой номер 050 111 22 33, а ваш?",
      now: new Date("2026-07-24T08:00:00.000Z"),
    })

    expect(result).toEqual({ created: true, leadId: "lead-1", taskId: "task-1" })
    expect(mocks.prisma.lead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ phone: "994501112233" }),
    }))
  })
})
