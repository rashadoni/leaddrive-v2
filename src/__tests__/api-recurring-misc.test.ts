import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recurringInvoice: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    recurringInvoiceItem: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    campaign: {
      findMany: vi.fn(),
    },
    attributionModel: {
      findFirst: vi.fn(),
    },
    campaignInfluence: {
      groupBy: vi.fn(),
    },
    pipelineStage: {
      findMany: vi.fn(),
    },
    emailLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    lead: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    activity: {
      findMany: vi.fn(),
    },
    deal: { groupBy: vi.fn().mockResolvedValue([]),
      // Default [] — orgStageVocabulary reads distinct stages before the ROI
      // query, and an unresolved mock would return undefined into .map().
      findMany: vi.fn().mockResolvedValue([]),
    },
    contact: {
      deleteMany: vi.fn(),
    },
    task: {
      updateMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/constants", () => ({
  DEFAULT_CURRENCY: "USD",
  PAGE_SIZE: { INBOX: 100 },
}))

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "AI analysis text" }],
      }),
    },
  })),
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}))

import { GET as GET_RECURRING, POST as POST_RECURRING } from "@/app/api/v1/recurring-invoices/route"
import { GET as GET_RECURRING_ID, PUT as PUT_RECURRING, DELETE as DELETE_RECURRING } from "@/app/api/v1/recurring-invoices/[id]/route"
import { GET as GET_ROI } from "@/app/api/v1/campaign-roi/route"
import { GET as GET_EMAIL_LOG } from "@/app/api/v1/email-log/route"
import { POST as POST_EMAIL_ANALYSIS } from "@/app/api/v1/email-log/ai-analysis/route"
import { GET as GET_LEAD_SCORING, POST as POST_LEAD_SCORING } from "@/app/api/v1/lead-scoring/route"
import { POST as BULK_DELETE_CONTACTS } from "@/app/api/v1/contacts/bulk-delete/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

function makeReq(url: string, init?: RequestInit) {
  return new Request(url, init) as never
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(prisma.attributionModel.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.campaignInfluence.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.pipelineStage.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 0 } as never)
})

// ─── Recurring Invoices ─────────────────────────────────────────────

describe("GET /api/v1/recurring-invoices", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as never)
    const res = await GET_RECURRING(makeReq("http://localhost/api/v1/recurring-invoices"))
    expect(res.status).toBe(401)
  })

  it("returns recurring invoices with items", async () => {
    const data = [{ id: "ri1", title: "Monthly", items: [], _count: { invoices: 2 } }]
    vi.mocked(prisma.recurringInvoice.findMany).mockResolvedValue(data as never)
    const res = await GET_RECURRING(makeReq("http://localhost/api/v1/recurring-invoices"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toEqual(data)
  })
})

describe("POST /api/v1/recurring-invoices", () => {
  it("returns 400 for missing title", async () => {
    const res = await POST_RECURRING(makeReq("http://localhost/api/v1/recurring-invoices", {
      method: "POST",
      body: JSON.stringify({ startDate: "2026-01-01" }),
    }))
    expect(res.status).toBe(400)
  })

  it("creates recurring invoice and returns 201", async () => {
    const created = { id: "ri1", title: "Monthly SaaS", items: [] }
    vi.mocked(prisma.recurringInvoice.create).mockResolvedValue(created as never)
    const res = await POST_RECURRING(makeReq("http://localhost/api/v1/recurring-invoices", {
      method: "POST",
      body: JSON.stringify({ title: "Monthly SaaS", startDate: "2026-01-01" }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.title).toBe("Monthly SaaS")
  })
})

describe("GET /api/v1/recurring-invoices/[id]", () => {
  it("returns 404 when not found", async () => {
    vi.mocked(prisma.recurringInvoice.findFirst).mockResolvedValue(null)
    const res = await GET_RECURRING_ID(makeReq("http://localhost/api/v1/recurring-invoices/ri1"), makeParams("ri1"))
    expect(res.status).toBe(404)
  })
})

describe("PUT /api/v1/recurring-invoices/[id]", () => {
  it("returns 404 when not found", async () => {
    vi.mocked(prisma.recurringInvoice.findFirst).mockResolvedValue(null)
    const res = await PUT_RECURRING(
      makeReq("http://localhost/api/v1/recurring-invoices/ri1", { method: "PUT", body: JSON.stringify({ title: "X" }) }),
      makeParams("ri1"),
    )
    expect(res.status).toBe(404)
  })

  it("updates recurring invoice with new items", async () => {
    vi.mocked(prisma.recurringInvoice.findFirst).mockResolvedValue({ id: "ri1" } as never)
    vi.mocked(prisma.recurringInvoiceItem.deleteMany).mockResolvedValue({} as never)
    vi.mocked(prisma.recurringInvoiceItem.createMany).mockResolvedValue({} as never)
    vi.mocked(prisma.recurringInvoice.update).mockResolvedValue({ id: "ri1", title: "Updated", items: [] } as never)
    const res = await PUT_RECURRING(
      makeReq("http://localhost/api/v1/recurring-invoices/ri1", {
        method: "PUT",
        body: JSON.stringify({ title: "Updated", items: [{ name: "Service", quantity: 1, unitPrice: 100 }] }),
      }),
      makeParams("ri1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.title).toBe("Updated")
    expect(prisma.recurringInvoiceItem.deleteMany).toHaveBeenCalled()
    expect(prisma.recurringInvoiceItem.createMany).toHaveBeenCalled()
  })
})

describe("DELETE /api/v1/recurring-invoices/[id]", () => {
  it("deletes recurring invoice", async () => {
    vi.mocked(prisma.recurringInvoice.deleteMany).mockResolvedValue({ count: 1 } as never)
    const res = await DELETE_RECURRING(
      makeReq("http://localhost/api/v1/recurring-invoices/ri1", { method: "DELETE" }),
      makeParams("ri1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

// ─── Campaign ROI ───────────────────────────────────────────────────

describe("GET /api/v1/campaign-roi", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as never)
    const res = await GET_ROI(makeReq("http://localhost/api/v1/campaign-roi"))
    expect(res.status).toBe(401)
  })

  it("computes ROI from campaigns and won deals", async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([
      {
        id: "c1",
        name: "Email Blast",
        status: "sent",
        type: "email",
        budget: 1000,
        totalRecipients: 500,
        totalSent: 480,
        totalOpened: 200,
        totalClicked: 50,
        sentAt: new Date(),
        createdAt: new Date(),
        deals: [
          { id: "d1", name: "Deal A", stage: "WON", valueAmount: 5000, currency: "USD" },
          { id: "d2", name: "Deal B", stage: "NEGOTIATION", valueAmount: 2000, currency: "USD" },
        ],
      },
    ] as never)

    const res = await GET_ROI(makeReq("http://localhost/api/v1/campaign-roi"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.campaigns[0].revenue).toBe(5000)
    expect(json.data.campaigns[0].wonDeals).toBe(1)
    expect(json.data.campaigns[0].roi).toBe(400) // (5000-1000)/1000 * 100
    expect(json.data.summary.totalRevenue).toBe(5000)
  })
})

// ─── Email Log ──────────────────────────────────────────────────────

describe("GET /api/v1/email-log", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as never)
    const res = await GET_EMAIL_LOG(makeReq("http://localhost/api/v1/email-log"))
    expect(res.status).toBe(401)
  })

  it("returns paginated email logs with stats", async () => {
    vi.mocked(prisma.emailLog.findMany).mockResolvedValue([{ id: "el1" }] as never)
    vi.mocked(prisma.emailLog.count)
      .mockResolvedValueOnce(1)   // total for pagination
      .mockResolvedValueOnce(10)  // totalCount stat
      .mockResolvedValueOnce(7)   // outbound
      .mockResolvedValueOnce(3)   // inbound
      .mockResolvedValueOnce(6)   // sent
      .mockResolvedValueOnce(1)   // failed
      .mockResolvedValueOnce(0)   // bounced

    const res = await GET_EMAIL_LOG(makeReq("http://localhost/api/v1/email-log?page=1&limit=50"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.logs).toHaveLength(1)
    expect(json.data.stats.total).toBe(10)
    expect(json.data.stats.outbound).toBe(7)
  })
})

// ─── Email Log AI Analysis ──────────────────────────────────────────

describe("POST /api/v1/email-log/ai-analysis", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as never)
    const res = await POST_EMAIL_ANALYSIS(makeReq("http://localhost/api/v1/email-log/ai-analysis", {
      method: "POST",
      body: JSON.stringify({}),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 503 when ANTHROPIC_API_KEY is not set", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    const res = await POST_EMAIL_ANALYSIS(makeReq("http://localhost/api/v1/email-log/ai-analysis", {
      method: "POST",
      body: JSON.stringify({}),
    }))
    expect(res.status).toBe(503)
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey
  })
})

// ─── Lead Scoring ───────────────────────────────────────────────────

describe("GET /api/v1/lead-scoring", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as never)
    const res = await GET_LEAD_SCORING(makeReq("http://localhost/api/v1/lead-scoring"))
    expect(res.status).toBe(401)
  })

  it("returns scored leads with grades", async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValue([
      {
        id: "l1",
        contactName: "John",
        companyName: "Acme",
        email: "john@acme.com",
        phone: "+1234",
        source: "referral",
        status: "qualified",
        priority: "high",
        score: 85,
        scoreDetails: { conversionProb: 72, reasoning: "Strong lead" },
        lastScoredAt: new Date(),
        estimatedValue: 10000,
        notes: "Good prospect",
        createdAt: new Date("2026-01-01"),
      },
    ] as never)

    const res = await GET_LEAD_SCORING(makeReq("http://localhost/api/v1/lead-scoring"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.leads[0].grade).toBe("A")
    expect(json.data.leads[0].score).toBe(85)
    expect(json.data.total).toBe(1)
  })
})

describe("POST /api/v1/lead-scoring", () => {
  it("scores leads with rule-based fallback when no API key", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    vi.mocked(prisma.lead.findMany).mockResolvedValue([
      {
        id: "l1",
        contactName: "Jane",
        email: "jane@test.com",
        phone: "+1234",
        companyName: "TestCo",
        source: "referral",
        priority: "high",
        status: "qualified",
        estimatedValue: 5000,
        notes: "Interested in our product",
      },
    ] as never)
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    const res = await POST_LEAD_SCORING(makeReq("http://localhost/api/v1/lead-scoring", {
      method: "POST",
      body: JSON.stringify({}),
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.scored).toBe(1)
    expect(json.data.aiPowered).toBe(false)
    expect(json.data.results[0].score).toBeGreaterThan(0)

    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey
  })
})

// ─── Contacts Bulk Delete ───────────────────────────────────────────

describe("POST /api/v1/contacts/bulk-delete", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as never)
    const res = await BULK_DELETE_CONTACTS(makeReq("http://localhost/api/v1/contacts/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids: ["c1"] }),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 400 on empty ids array (Zod validation)", async () => {
    const res = await BULK_DELETE_CONTACTS(makeReq("http://localhost/api/v1/contacts/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids: [] }),
    }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })

  it("bulk deletes contacts and returns count", async () => {
    vi.mocked(prisma.contact.deleteMany).mockResolvedValue({ count: 3 } as never)
    const res = await BULK_DELETE_CONTACTS(makeReq("http://localhost/api/v1/contacts/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids: ["c1", "c2", "c3"] }),
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.deleted).toBe(3)
  })
})
