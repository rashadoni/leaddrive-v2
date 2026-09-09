import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    // orgStageVocabulary resolves won/lost spellings before the route's own
    // query; both of these must answer for any deal-touching route.
    pipelineStage: { findMany: vi.fn().mockResolvedValue([]) },
    deal: { groupBy: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    dealCompetitor: { findMany: vi.fn(), upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    dealContactRole: { findMany: vi.fn(), upsert: vi.fn() },
    dealTeamMember: { findMany: vi.fn(), upsert: vi.fn() },
    contact: { findMany: vi.fn(), findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    task: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    offer: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    activity: { findMany: vi.fn() },
    emailLog: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn() }))
vi.mock("@/lib/constants", () => ({ DEFAULT_CURRENCY: "USD" }))
const mockAnthropicCreate = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "AI analysis result" }],
})
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockAnthropicCreate }
  },
}))

import { GET as GET_PRODUCTS, POST as POST_PRODUCTS } from "@/app/api/v1/deals/[id]/products/route"
import { GET as GET_COMPETITORS, POST as POST_COMPETITORS, DELETE as DELETE_COMPETITORS } from "@/app/api/v1/deals/[id]/competitors/route"
import { GET as GET_CONTACT_ROLES, POST as POST_CONTACT_ROLES } from "@/app/api/v1/deals/[id]/contact-roles/route"
import { GET as GET_TEAM, POST as POST_TEAM } from "@/app/api/v1/deals/[id]/team/route"
import {
  GET as GET_NEXT_STEPS,
  POST as POST_NEXT_STEPS,
  PUT as PUT_NEXT_STEP,
  DELETE as DELETE_NEXT_STEP,
} from "@/app/api/v1/deals/[id]/next-steps/route"
import { GET as GET_OFFERS } from "@/app/api/v1/deals/[id]/offers/route"
import { GET as GET_ENGAGEMENT } from "@/app/api/v1/deals/[id]/engagement/route"
import { POST as POST_AI_ANALYSIS } from "@/app/api/v1/deals/ai-analysis/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession } from "@/lib/api-auth"

const ORG = "org-1"

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  // These routes are getOrgId-only; withRls tries getSession first, so default it
  // to null to fall through to getOrgId (preserving the pre-codemod resolution).
  vi.mocked(getSession).mockResolvedValue(null as any)
})

// ─── Products ───────────────────────────────────────────────────────

describe("GET /deals/[id]/products", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValueOnce(null as any)
    const res = await GET_PRODUCTS(makeReq("http://localhost:3000/api/v1/deals/deal-1/products"), idParams("deal-1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when deal not found", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce(null)
    const res = await GET_PRODUCTS(makeReq("http://localhost:3000/api/v1/deals/deal-1/products"), idParams("deal-1"))
    expect(res.status).toBe(404)
  })

  it("returns products from deal metadata", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce({ metadata: { products: [{ productId: "p1", name: "Widget" }] } } as any)
    const res = await GET_PRODUCTS(makeReq("http://localhost:3000/api/v1/deals/deal-1/products"), idParams("deal-1"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(1)
    expect(json.data[0].name).toBe("Widget")
  })
})

describe("POST /deals/[id]/products", () => {
  it("adds product to deal and returns 409 on duplicate", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce({ metadata: { products: [{ productId: "p1" }] } } as any)
    vi.mocked(prisma.deal.updateMany).mockResolvedValueOnce({ count: 1 } as any)

    const res = await POST_PRODUCTS(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/products", {
        method: "POST",
        body: JSON.stringify({ productId: "p1", name: "Widget", price: 100 }),
      }),
      idParams("deal-1"),
    )
    expect(res.status).toBe(409)
  })

  it("adds new product successfully", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce({ metadata: { products: [] } } as any)
    vi.mocked(prisma.deal.updateMany).mockResolvedValueOnce({ count: 1 } as any)

    const res = await POST_PRODUCTS(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/products", {
        method: "POST",
        body: JSON.stringify({ productId: "p2", name: "Gadget", price: 200 }),
      }),
      idParams("deal-1"),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(1)
    expect(json.data[0].productId).toBe("p2")
  })
})

// ─── Competitors ────────────────────────────────────────────────────

describe("GET /deals/[id]/competitors", () => {
  it("returns 404 when deal not found", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce(null)
    const res = await GET_COMPETITORS(makeReq("http://localhost:3000/api/v1/deals/deal-1/competitors"), idParams("deal-1"))
    expect(res.status).toBe(404)
  })

  it("returns competitors list", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce({ id: "deal-1" } as any)
    vi.mocked(prisma.dealCompetitor.findMany).mockResolvedValueOnce([{ id: "c1", name: "Rival Inc" }] as any)
    const res = await GET_COMPETITORS(makeReq("http://localhost:3000/api/v1/deals/deal-1/competitors"), idParams("deal-1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
  })
})

describe("POST /deals/[id]/competitors", () => {
  it("returns 400 for invalid body (missing name)", async () => {
    const res = await POST_COMPETITORS(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/competitors", {
        method: "POST",
        body: JSON.stringify({ threat: "High" }),
      }),
      idParams("deal-1"),
    )
    expect(res.status).toBe(400)
  })

  it("upserts competitor successfully", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce({ id: "deal-1" } as any)
    vi.mocked(prisma.dealCompetitor.upsert).mockResolvedValueOnce({ id: "c1", name: "Rival", threat: "High" } as any)

    const res = await POST_COMPETITORS(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/competitors", {
        method: "POST",
        body: JSON.stringify({ name: "Rival", threat: "High" }),
      }),
      idParams("deal-1"),
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("Rival")
  })

  it("stamps the caller's org on the created row", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce({ id: "deal-1" } as any)
    vi.mocked(prisma.dealCompetitor.upsert).mockResolvedValueOnce({ id: "c1", name: "Rival" } as any)

    await POST_COMPETITORS(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/competitors", {
        method: "POST",
        body: JSON.stringify({ name: "Rival", threat: "High" }),
      }),
      idParams("deal-1"),
    )

    const arg = vi.mocked(prisma.dealCompetitor.upsert).mock.calls[0][0] as any
    expect(arg.create.organizationId).toBe(ORG)
  })
})

// ── F-56: DELETE must constrain competitorId by the deal ────────────────────
// competitorId arrives unvalidated from the body. The route used to run
// `delete({ where: { id: competitorId } })`, and deal_competitors carried no RLS
// policy, so any authenticated user in any tenant could delete any competitor
// row in the database by naming one of their own deals in the URL. The deal
// lookup above it only ever gated the 404.

describe("DELETE /deals/[id]/competitors", () => {
  it("returns 400 without competitorId", async () => {
    const res = await DELETE_COMPETITORS(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/competitors", {
        method: "DELETE",
        body: JSON.stringify({}),
      }),
      idParams("deal-1"),
    )
    expect(res.status).toBe(400)
    expect(prisma.dealCompetitor.deleteMany).not.toHaveBeenCalled()
  })

  it("rejects a non-string competitorId instead of passing it to Prisma as a filter", async () => {
    // {"competitorId": {"not": "x"}} would otherwise reach the query as an
    // operator and delete every competitor of the deal except one.
    const res = await DELETE_COMPETITORS(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/competitors", {
        method: "DELETE",
        body: JSON.stringify({ competitorId: { not: "c1" } }),
      }),
      idParams("deal-1"),
    )
    expect(res.status).toBe(400)
    expect(prisma.dealCompetitor.deleteMany).not.toHaveBeenCalled()
  })

  it("returns 404 without deleting when the deal belongs to another org", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce(null)

    const res = await DELETE_COMPETITORS(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/competitors", {
        method: "DELETE",
        body: JSON.stringify({ competitorId: "victim-competitor" }),
      }),
      idParams("deal-1"),
    )

    expect(res.status).toBe(404)
    expect(prisma.dealCompetitor.deleteMany).not.toHaveBeenCalled()
  })

  it("scopes the delete to the deal, so a foreign competitorId matches nothing", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce({ id: "deal-1" } as any)
    vi.mocked(prisma.dealCompetitor.deleteMany).mockResolvedValueOnce({ count: 0 } as any)

    const res = await DELETE_COMPETITORS(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/competitors", {
        method: "DELETE",
        body: JSON.stringify({ competitorId: "competitor-of-another-tenant" }),
      }),
      idParams("deal-1"),
    )

    // dealId is part of the predicate — an id from another deal cannot match.
    expect(prisma.dealCompetitor.deleteMany).toHaveBeenCalledWith({
      where: { id: "competitor-of-another-tenant", dealId: "deal-1" },
    })
    // …and it must NOT reach the unconstrained single-row delete.
    expect(prisma.dealCompetitor.delete).not.toHaveBeenCalled()
    // 404, not 500 — the old code raised P2025 for a nonexistent id and
    // returned 200 for a real foreign one, which was a blind existence oracle.
    expect(res.status).toBe(404)
  })

  it("deletes a competitor that does belong to the deal", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce({ id: "deal-1" } as any)
    vi.mocked(prisma.dealCompetitor.deleteMany).mockResolvedValueOnce({ count: 1 } as any)

    const res = await DELETE_COMPETITORS(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/competitors", {
        method: "DELETE",
        body: JSON.stringify({ competitorId: "c1" }),
      }),
      idParams("deal-1"),
    )

    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })
})

// ─── Contact Roles ──────────────────────────────────────────────────

describe("GET /deals/[id]/contact-roles", () => {
  it("returns enriched contact roles", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce({ id: "deal-1" } as any)
    vi.mocked(prisma.dealContactRole.findMany).mockResolvedValueOnce([{ contactId: "ct-1", role: "decision_maker" }] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([{ id: "ct-1", fullName: "John", position: "CEO", email: "j@co.com", phone: null }] as any)

    const res = await GET_CONTACT_ROLES(makeReq("http://localhost:3000/api/v1/deals/deal-1/contact-roles"), idParams("deal-1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data[0].contact.fullName).toBe("John")
  })
})

describe("POST /deals/[id]/contact-roles", () => {
  it("upserts contact role", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce({ id: "deal-1" } as any)
    vi.mocked(prisma.dealContactRole.upsert).mockResolvedValueOnce({ id: "cr-1", contactId: "ct-1", role: "contact_person" } as any)

    const res = await POST_CONTACT_ROLES(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/contact-roles", {
        method: "POST",
        body: JSON.stringify({ contactId: "ct-1" }),
      }),
      idParams("deal-1"),
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.contactId).toBe("ct-1")
  })
})

// ─── Team ───────────────────────────────────────────────────────────

describe("GET /deals/[id]/team", () => {
  it("returns enriched team members", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce({ id: "deal-1" } as any)
    vi.mocked(prisma.dealTeamMember.findMany).mockResolvedValueOnce([{ userId: "u-1", role: "member" }] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u-1", name: "Alice", email: "a@co.com", avatar: null, role: "admin" }] as any)

    const res = await GET_TEAM(makeReq("http://localhost:3000/api/v1/deals/deal-1/team"), idParams("deal-1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data[0].user.name).toBe("Alice")
  })
})

describe("POST /deals/[id]/team", () => {
  it("returns 400 for invalid body", async () => {
    const res = await POST_TEAM(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/team", {
        method: "POST",
        body: JSON.stringify({ role: "lead" }),
      }),
      idParams("deal-1"),
    )
    expect(res.status).toBe(400)
  })

  it("upserts team member", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce({ id: "deal-1" } as any)
    vi.mocked(prisma.dealTeamMember.upsert).mockResolvedValueOnce({ userId: "u-1", role: "lead" } as any)

    const res = await POST_TEAM(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/team", {
        method: "POST",
        body: JSON.stringify({ userId: "u-1", role: "lead" }),
      }),
      idParams("deal-1"),
    )
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

// ─── Next Steps ─────────────────────────────────────────────────────

describe("GET /deals/[id]/next-steps", () => {
  it("returns tasks related to deal", async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValueOnce([{ id: "t-1", title: "Follow up" }] as any)
    const res = await GET_NEXT_STEPS(makeReq("http://localhost:3000/api/v1/deals/deal-1/next-steps"), idParams("deal-1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
  })
})

describe("POST /deals/[id]/next-steps", () => {
  it("creates a next-step task", async () => {
    vi.mocked(prisma.task.create).mockResolvedValueOnce({ id: "t-2", title: "Send proposal", status: "pending" } as any)

    const res = await POST_NEXT_STEPS(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/next-steps", {
        method: "POST",
        body: JSON.stringify({ title: "Send proposal" }),
      }),
      idParams("deal-1"),
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.title).toBe("Send proposal")
  })

  it.each(["{{7*7}}", "<script>alert(1)</script>"])(
    "rejects markup-like next-step title %s",
    async (title) => {
      const res = await POST_NEXT_STEPS(
        makeReq("http://localhost:3000/api/v1/deals/deal-1/next-steps", {
          method: "POST",
          body: JSON.stringify({ title }),
        }),
        idParams("deal-1"),
      )

      expect(res.status).toBe(400)
      expect(prisma.task.create).not.toHaveBeenCalled()
    },
  )
})

describe("PUT /deals/[id]/next-steps", () => {
  it("completes only a task belonging to this deal and organization", async () => {
    vi.mocked(prisma.task.updateMany).mockResolvedValueOnce({ count: 1 } as any)

    const res = await PUT_NEXT_STEP(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/next-steps", {
        method: "PUT",
        body: JSON.stringify({ taskId: "t-1", status: "completed" }),
      }),
      idParams("deal-1"),
    )

    expect(res.status).toBe(200)
    expect(prisma.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "t-1",
        organizationId: ORG,
        relatedType: "deal",
        relatedId: "deal-1",
      },
    }))
  })
})

describe("DELETE /deals/[id]/next-steps", () => {
  it("deletes only a task belonging to this deal and organization", async () => {
    vi.mocked(prisma.task.deleteMany).mockResolvedValueOnce({ count: 1 } as any)

    const res = await DELETE_NEXT_STEP(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/next-steps", {
        method: "DELETE",
        body: JSON.stringify({ taskId: "t-1" }),
      }),
      idParams("deal-1"),
    )

    expect(res.status).toBe(200)
    expect(prisma.task.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "t-1",
        organizationId: ORG,
        relatedType: "deal",
        relatedId: "deal-1",
      },
    })
  })

  it("returns 404 when the task is outside this deal scope", async () => {
    vi.mocked(prisma.task.deleteMany).mockResolvedValueOnce({ count: 0 } as any)

    const res = await DELETE_NEXT_STEP(
      makeReq("http://localhost:3000/api/v1/deals/deal-1/next-steps", {
        method: "DELETE",
        body: JSON.stringify({ taskId: "other-task" }),
      }),
      idParams("deal-1"),
    )

    expect(res.status).toBe(404)
  })
})

// ─── Offers ─────────────────────────────────────────────────────────

describe("GET /deals/[id]/offers", () => {
  it("returns offers for deal", async () => {
    vi.mocked(prisma.offer.findMany).mockResolvedValueOnce([{ id: "off-1", offerNumber: "OFF-2026-001", items: [] }] as any)
    const res = await GET_OFFERS(makeReq("http://localhost:3000/api/v1/deals/deal-1/offers"), idParams("deal-1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
  })
})

// ─── Engagement ─────────────────────────────────────────────────────

describe("GET /deals/[id]/engagement", () => {
  it("returns 404 when deal not found", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce(null)
    const res = await GET_ENGAGEMENT(makeReq("http://localhost:3000/api/v1/deals/deal-1/engagement"), idParams("deal-1"))
    expect(res.status).toBe(404)
  })

  it("returns engagement metrics", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValueOnce({ id: "deal-1", contactId: "ct-1", companyId: "co-1" } as any)
    vi.mocked(prisma.activity.findMany).mockResolvedValueOnce([
      { id: "a1", type: "call", subject: "Call 1", createdAt: new Date(), completedAt: null },
      { id: "a2", type: "email", subject: "Email 1", createdAt: new Date(), completedAt: null },
    ] as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValueOnce({ email: "ct@co.com" } as any)
    vi.mocked(prisma.emailLog.findMany).mockResolvedValueOnce([
      { status: "sent", createdAt: new Date() },
      { status: "opened", createdAt: new Date() },
    ] as any)

    const res = await GET_ENGAGEMENT(makeReq("http://localhost:3000/api/v1/deals/deal-1/engagement"), idParams("deal-1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.activities.total).toBe(2)
    expect(json.data.activities.calls).toBe(1)
    expect(json.data.email.sent).toBe(2)
    expect(json.data.email.opened).toBe(1)
  })
})

// ─── AI Analysis ────────────────────────────────────────────────────

describe("POST /deals/ai-analysis", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValueOnce(null as any)
    const res = await POST_AI_ANALYSIS(makeReq("http://localhost:3000/api/v1/deals/ai-analysis", { method: "POST", body: JSON.stringify({}) }))
    expect(res.status).toBe(401)
  })

  it("returns 503 when ANTHROPIC_API_KEY is missing", async () => {
    const origKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    const res = await POST_AI_ANALYSIS(makeReq("http://localhost:3000/api/v1/deals/ai-analysis", { method: "POST", body: JSON.stringify({}) }))
    expect(res.status).toBe(503)

    process.env.ANTHROPIC_API_KEY = origKey || ""
  })

  it("returns 404 when no deals exist", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.mocked(prisma.deal.findMany).mockResolvedValueOnce([])

    const res = await POST_AI_ANALYSIS(makeReq("http://localhost:3000/api/v1/deals/ai-analysis", { method: "POST", body: JSON.stringify({}) }))
    expect(res.status).toBe(404)
  })

  it("returns AI analysis when deals exist", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.mocked(prisma.deal.findMany).mockResolvedValueOnce([
      { id: "d1", name: "Big Deal", stage: "WON", valueAmount: 50000, currency: "USD", probability: 100, company: { name: "Acme" }, createdAt: new Date() },
    ] as any)

    const res = await POST_AI_ANALYSIS(makeReq("http://localhost:3000/api/v1/deals/ai-analysis", { method: "POST", body: JSON.stringify({ lang: "en" }) }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.analysis).toBe("AI analysis result")
  })
})
