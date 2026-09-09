import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => {
  const tx = {
    $executeRaw: vi.fn(),
    socialConversation: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    lead: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    pipeline: { findMany: vi.fn() },
    channelMessage: { updateMany: vi.fn() },
  }
  return {
    prisma: {
      socialConversation: { findFirst: vi.fn() },
      contact: { findFirst: vi.fn() },
      user: { findFirst: vi.fn() },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      __tx: tx,
    },
    logAudit: vi.fn(),
  }
})

vi.mock("@/lib/api-auth", () => {
  const getSession = vi.fn()
  const getOrgId = vi.fn()
  return {
    getSession,
    getOrgId,
    requireAuth: vi.fn(async (req: NextRequest) => {
      const session = await getSession(req)
      if (session) return session
      const orgId = await getOrgId(req)
      return orgId
        ? { orgId, userId: "marketing-1", role: "manager", email: "marketing@example.com", name: "Marketing" }
        : new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    requireSessionAuth: vi.fn(async (req: NextRequest) => {
      const session = await getSession(req)
      return session ?? new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    isAuthError: vi.fn((value: unknown) => value instanceof Response),
  }
})

vi.mock("@/lib/inbox/sales-assignment", () => ({
  getSalesAssignmentCandidates: vi.fn().mockResolvedValue([
    { id: "seller-1", name: "Kenan", activeLeadCount: 1, recommended: true },
    { id: "seller-2", name: "Aysel", activeLeadCount: 3, recommended: false },
  ]),
}))

import {
  GET,
  POST,
} from "@/app/api/v1/inbox/conversations/[id]/convert-to-lead/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession } from "@/lib/api-auth"

const db = prisma as typeof prisma & {
  __tx: {
    $executeRaw: ReturnType<typeof vi.fn>
    socialConversation: {
      findFirst: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
    }
    lead: {
      findFirst: ReturnType<typeof vi.fn>
      create: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
    }
    channelMessage: { updateMany: ReturnType<typeof vi.fn> }
    pipeline: { findMany: ReturnType<typeof vi.fn> }
  }
}

const conversation = {
  id: "conversation-1",
  platform: "tiktok",
  externalId: "raw-user-id",
  contactId: "contact-1",
  contactName: "Kanan Mammadov",
  lastMessage: "55 düym televizorun qiyməti nədir? +994501234567",
  metadata: {},
  aiCustomerStageReason: "Müştəri 55 düym televizorun qiymətini soruşur",
  messages: [{
    from: "raw-user-id",
    body: "55 düym televizorun qiyməti nədir? +994501234567",
    metadata: { senderUsername: "kanan_tv" },
  }],
}

function request(method = "GET", body?: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/v1/inbox/conversations/conversation-1/convert-to-lead", {
    method,
    ...(body ? {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    } : {}),
  })
}

const context = { params: Promise.resolve({ id: "conversation-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue({
    orgId: "org-1",
    userId: "marketing-1",
    role: "manager",
    email: "marketing@example.com",
    name: "Marketing",
  })
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  db.__tx.lead.findFirst.mockResolvedValue(null)
  db.__tx.pipeline.findMany.mockResolvedValue([
    { id: "pipe-smm", name: "SMM" },
  ])
})

describe("Inbox conversation → lead handoff", () => {
  it("prefills the full lead card and recommends the least-loaded seller", async () => {
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue(conversation as never)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({
      fullName: "Kanan Mammadov",
      email: "kanan@example.com",
      phone: "+994501234567",
      phones: [],
      company: { name: "Kanan LLC" },
    } as never)

    const response = await GET(request(), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.recommendedAssigneeId).toBe("seller-1")
    expect(body.data.draft).toMatchObject({
      contactName: "Kanan Mammadov",
      companyName: "Kanan LLC",
      source: "tiktok",
      sourceProfileUrl: "https://www.tiktok.com/@kanan_tv",
      // Lead qualification canonicalizes every spelling to digits-only so
      // local and international variants participate in the same duplicate
      // checks and outbound routing.
      phone: "994501234567",
    })
  })

  it("builds a TikTok profile URL from the inbound sender when metadata has no username", async () => {
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({
      ...conversation,
      externalId: "908",
      messages: [{
        from: "nuqay.manafov",
        body: "Qiyməti nədir? +994501234567",
        metadata: {},
      }],
    } as never)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null)

    const response = await GET(request(), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.draft).toMatchObject({
      source: "tiktok",
      sourceProfileUrl: "https://www.tiktok.com/@nuqay.manafov",
    })
  })

  it("creates and links the edited lead atomically with the confirmed seller", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "seller-2",
      name: "Aysel",
      email: "aysel@example.com",
    } as never)
    db.__tx.socialConversation.findFirst.mockResolvedValue({
      ...conversation,
      contactId: undefined,
      contactName: undefined,
      lastMessage: undefined,
      aiCustomerStageReason: undefined,
    })
    db.__tx.lead.create.mockResolvedValue({
      id: "lead-1",
      contactName: "Edited customer",
      sourceProfileUrl: "https://www.tiktok.com/@edited_customer",
    })

    const response = await POST(request("POST", {
      assignedTo: "seller-2",
      contactName: "Edited customer",
      companyName: "Edited company",
      email: "customer@example.com",
      phone: "+994501234567",
      phoneWhatsApp: "",
      telegramHandle: "",
      sourceDetail: "TikTok organic",
      sourceProfileUrl: "https://www.tiktok.com/@edited_customer",
      interest: "55-inch TV",
      brand: "Example",
      category: "prospect",
      priority: "high",
      estimatedValue: 2500,
      notes: "Call after 18:00",
    }), context)

    expect(response.status).toBe(201)
    expect(db.__tx.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        assignedTo: "seller-2",
        pipelineId: "pipe-smm",
        source: "tiktok",
        sourceDetail: "TikTok organic",
        sourceProfileUrl: "https://www.tiktok.com/@edited_customer",
        contactName: "Edited customer",
      }),
    })
    expect(db.__tx.channelMessage.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        conversationId: "conversation-1",
      },
      data: { leadId: "lead-1" },
    })
    expect(db.__tx.socialConversation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "resolved",
        metadata: expect.objectContaining({
          qualificationLeadId: "lead-1",
          salesAssigneeId: "seller-2",
        }),
      }),
    }))
  })

  it("updates an existing AI-qualified lead instead of creating a duplicate", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "seller-1",
      name: "Kenan",
      email: "kenan@example.com",
    } as never)
    db.__tx.socialConversation.findFirst.mockResolvedValue({
      ...conversation,
      contactId: undefined,
      contactName: undefined,
      lastMessage: undefined,
      aiCustomerStageReason: undefined,
      metadata: { qualificationLeadId: "lead-existing" },
    })
    db.__tx.lead.findFirst.mockResolvedValue({ id: "lead-existing" })
    db.__tx.lead.update.mockResolvedValue({
      id: "lead-existing",
      contactName: "Confirmed customer",
      sourceProfileUrl: "https://www.tiktok.com/@kanan_tv",
    })

    const response = await POST(request("POST", {
      assignedTo: "seller-1",
      contactName: "Confirmed customer",
      companyName: "",
      email: "",
      phone: "+994501234567",
      phoneWhatsApp: "",
      telegramHandle: "",
      sourceDetail: "TikTok",
      sourceProfileUrl: "https://www.tiktok.com/@kanan_tv",
      interest: "55-inch TV",
      brand: "",
      category: "prospect",
      priority: "medium",
      estimatedValue: null,
      notes: "",
    }), context)

    expect(response.status).toBe(200)
    expect(db.__tx.lead.create).not.toHaveBeenCalled()
    expect(db.__tx.lead.update).toHaveBeenCalledWith({
      where: { id: "lead-existing" },
      data: expect.objectContaining({
        assignedTo: "seller-1",
        contactName: "Confirmed customer",
      }),
    })
  })
})
