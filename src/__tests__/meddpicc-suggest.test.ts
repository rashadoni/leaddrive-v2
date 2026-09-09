/**
 * D3 — AI-fill MEDDPICC from correspondence: route + helper behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deal: { findFirst: vi.fn() },
    activity: { findMany: vi.fn() },
    emailLog: { findMany: vi.fn() },
    contact: { findMany: vi.fn() },
    aiInteractionLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((v: unknown) => v instanceof Response),
}))
const llmCreate = vi.fn()
vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: () => ({ messages: { create: llmCreate } }),
  AI_DEFAULT_TIMEOUT_MS: 45000,
  AI_DEFAULT_MAX_RETRIES: 1,
}))

import { POST } from "@/app/api/v1/deals/[id]/meddpicc/suggest/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession } from "@/lib/api-auth"

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const req = () =>
  new NextRequest("http://localhost/api/v1/deals/deal-1/meddpicc/suggest", {
    method: "POST",
    headers: { "x-organization-id": "org-1" },
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1" as never)
  vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "manager" } as never)
  vi.mocked(prisma.aiInteractionLog.create).mockResolvedValue({} as never)
})

describe("POST /deals/[id]/meddpicc/suggest (D3)", () => {
  it("404 when the deal doesn't exist", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValue(null as never)
    const res = await POST(req(), ctx("nope"))
    expect(res.status).toBe(404)
    expect(llmCreate).not.toHaveBeenCalled()
  })

  it("evidenceCount 0 and NO LLM call when the deal has no correspondence", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValue({
      id: "deal-1", name: "D", stage: "LEAD", valueAmount: 0, currency: "AZN",
      contactId: null, companyId: null, company: null, contactRoles: [],
    } as never)
    vi.mocked(prisma.activity.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.emailLog.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([] as never)
    const res = await POST(req(), ctx("deal-1"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.evidenceCount).toBe(0)
    expect(body.data.suggestions).toEqual({})
    expect(llmCreate).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.aiInteractionLog.create)).not.toHaveBeenCalled()
  })

  it("drafts blocks from evidence, clamps garbage, logs cost, scopes emails to deal contacts", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValue({
      id: "deal-1", name: "Acme", stage: "PROPOSAL", valueAmount: 5000, currency: "USD",
      contactId: "ct-1", companyId: "co-1", company: { name: "Acme Inc" },
      contactRoles: [{ contactId: "ct-2" }, { contactId: "ct-1" }],
    } as never)
    vi.mocked(prisma.activity.findMany).mockResolvedValue([
      { type: "call", subject: "Discovery", description: "Talked budget with the CFO", createdAt: new Date("2026-07-10T00:00:00Z") },
    ] as never)
    vi.mocked(prisma.emailLog.findMany).mockResolvedValue([
      { direction: "inbound", subject: "Re: pricing", body: "<p>We compare you with Vendor X</p>", createdAt: new Date("2026-07-12T00:00:00Z") },
    ] as never)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ fullName: "Jane Doe" }] as never)
    llmCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          economicBuyer: { score: 4, note: "CFO engaged on budget", next: "Confirm sign-off" },
          competition: { score: 9, note: "Vendor X in play", next: "" },
          bogus: { score: 3, note: "should be dropped" },
        }),
      }],
      usage: { input_tokens: 120, output_tokens: 60 },
    })

    const res = await POST(req(), ctx("deal-1"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.evidenceCount).toBe(2)
    // valid block kept
    expect(body.data.suggestions.economicBuyer).toMatchObject({ score: 4, note: "CFO engaged on budget" })
    // out-of-range score dropped by parseMeddpicc, note preserved
    expect(body.data.suggestions.competition.score).toBeUndefined()
    expect(body.data.suggestions.competition.note).toBe("Vendor X in play")
    // unknown key dropped
    expect(body.data.suggestions.bogus).toBeUndefined()
    // emails scoped to the de-duped deal contacts (primary + roles)
    const emailWhere = (vi.mocked(prisma.emailLog.findMany).mock.calls[0][0] as { where: { contactId: { in: string[] } } }).where
    expect([...emailWhere.contactId.in].sort()).toEqual(["ct-1", "ct-2"])
    // activities scoped to this deal
    const actWhere = (vi.mocked(prisma.activity.findMany).mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(actWhere).toMatchObject({ organizationId: "org-1", relatedType: "deal", relatedId: "deal-1" })
    // cost logged once
    expect(llmCreate).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.aiInteractionLog.create)).toHaveBeenCalledTimes(1)
  })

  it("502 when the LLM call throws", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValue({
      id: "deal-1", name: "D", stage: "LEAD", valueAmount: 0, currency: "AZN",
      contactId: "ct-1", companyId: null, company: null, contactRoles: [],
    } as never)
    vi.mocked(prisma.activity.findMany).mockResolvedValue([
      { type: "note", subject: "x", description: "y", createdAt: new Date() },
    ] as never)
    vi.mocked(prisma.emailLog.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ fullName: "Jane" }] as never)
    llmCreate.mockRejectedValue(new Error("upstream 529"))
    const res = await POST(req(), ctx("deal-1"))
    expect(res.status).toBe(502)
  })
})
