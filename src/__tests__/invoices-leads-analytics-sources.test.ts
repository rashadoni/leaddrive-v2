/**
 * The records behind the invoices and leads analytics tabs
 * (src/__tests__/invoices-leads-analytics-real-figures.test.ts renders them).
 *
 * 1. GET /api/v1/invoices?include=payments hands the tab each invoice's
 *    recorded payments — the only record of how much came in and when. Other
 *    callers keep the rows they always got.
 * 2. POST /api/v1/lead-scoring (Da Vinci) stores a conversion probability only
 *    when the model returned one, and says so. Its rule-based fallback used to
 *    store round(score × 0.85) — stamped `aiPowered: true` whenever a key was
 *    configured, even when the model call had failed — and the leads tab
 *    printed it as the lead's chance of converting.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findMany: vi.fn(), count: vi.fn() },
    invoicePayment: { findMany: vi.fn() },
    lead: { findMany: vi.fn(), update: vi.fn() },
    activity: { findMany: vi.fn().mockResolvedValue([]) },
    deal: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn() }))

const createMessage = vi.fn()
vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: () => ({ messages: { create: createMessage } }),
}))

import { GET as LIST_INVOICES } from "@/app/api/v1/invoices/route"
import { POST as SCORE_LEADS } from "@/app/api/v1/lead-scoring/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession } from "@/lib/api-auth"

const ORG = "org-1"
const dec = (v: number) => ({ toNumber: () => v, toString: () => `${v}.0000` })

function listedInvoice(id: string) {
  return {
    id,
    organizationId: ORG,
    invoiceNumber: id.toUpperCase(),
    title: "Xidmət",
    status: "paid",
    currency: "AZN",
    subtotal: dec(1000),
    discountValue: dec(0),
    discountAmount: dec(0),
    taxAmount: dec(0),
    totalAmount: dec(1000),
    paidAmount: dec(1000),
    balanceDue: dec(0),
    items: [],
    company: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getSession).mockResolvedValue(null as never)
})

describe("GET /api/v1/invoices?include=payments", () => {
  it("returns each invoice's recorded payments, as numbers, read inside the organisation", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([listedInvoice("inv-1"), listedInvoice("inv-2")] as never)
    vi.mocked(prisma.invoice.count).mockResolvedValue(2 as never)
    vi.mocked(prisma.invoicePayment.findMany).mockResolvedValue([
      { invoiceId: "inv-1", amount: dec(400), currency: "AZN", paymentDate: new Date("2026-09-15T08:00:00.000Z") },
      { invoiceId: "inv-1", amount: dec(600), currency: "AZN", paymentDate: new Date("2026-09-18T08:00:00.000Z") },
    ] as never)

    const res = await LIST_INVOICES(new Request("http://localhost/api/v1/invoices?limit=500&include=payments") as never)
    const json = await res.json()

    expect(res.status).toBe(200)
    const where = vi.mocked(prisma.invoicePayment.findMany).mock.calls[0][0]!.where
    expect(where).toEqual({ organizationId: ORG, invoiceId: { in: ["inv-1", "inv-2"] } })
    expect(json.data.invoices[0].payments).toEqual([
      { amount: 400, currency: "AZN", paymentDate: "2026-09-15T08:00:00.000Z" },
      { amount: 600, currency: "AZN", paymentDate: "2026-09-18T08:00:00.000Z" },
    ])
    // Marked paid, nothing recorded: an empty list, not a missing one.
    expect(json.data.invoices[1].payments).toEqual([])
  })

  it("leaves every other caller's rows as they were", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([listedInvoice("inv-1")] as never)
    vi.mocked(prisma.invoice.count).mockResolvedValue(1 as never)

    const res = await LIST_INVOICES(new Request("http://localhost/api/v1/invoices?limit=50") as never)
    const json = await res.json()

    expect(prisma.invoicePayment.findMany).not.toHaveBeenCalled()
    expect(json.data.invoices[0]).not.toHaveProperty("payments")
  })
})

describe("POST /api/v1/lead-scoring stores a probability only when the model produced one", () => {
  const lead = {
    id: "l1",
    contactName: "Leyla",
    email: "leyla@demo-journey.example",
    phone: null,
    companyName: "Demo Mebel",
    source: "website",
    priority: "high",
    status: "qualified",
    estimatedValue: 8740,
    notes: "Büdcə təsdiqlənib, təklif bu həftə gözlənilir.",
    createdAt: new Date("2026-09-12T08:00:00.000Z"),
  }

  async function score(apiKey: string | undefined) {
    const original = process.env.ANTHROPIC_API_KEY
    if (apiKey) process.env.ANTHROPIC_API_KEY = apiKey
    else delete process.env.ANTHROPIC_API_KEY
    try {
      vi.mocked(prisma.lead.findMany).mockResolvedValue([lead] as never)
      vi.mocked(prisma.lead.update).mockResolvedValue({} as never)
      const res = await SCORE_LEADS(
        new Request("http://localhost/api/v1/lead-scoring", { method: "POST", body: JSON.stringify({ locale: "az" }) }) as never,
      )
      expect(res.status).toBe(200)
      return vi.mocked(prisma.lead.update).mock.calls[0][0]!.data as { score: number; scoreDetails: Record<string, unknown> }
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = original
    }
  }

  const modelReply = (body: Record<string, unknown>) => ({ content: [{ type: "text", text: JSON.stringify(body) }] })

  it("rule-based scoring, no key: a score, no probability, not AI", async () => {
    const stored = await score(undefined)
    expect(stored.score).toBeGreaterThan(0)
    expect(stored.scoreDetails).not.toHaveProperty("conversionProb")
    expect(stored.scoreDetails.aiPowered).toBe(false)
  })

  it("a failed model call falls back to the rules — and is not stamped as AI", async () => {
    createMessage.mockRejectedValueOnce(new Error("upstream timeout"))
    const stored = await score("test-key")
    expect(stored.scoreDetails).not.toHaveProperty("conversionProb")
    expect(stored.scoreDetails.aiPowered).toBe(false)
  })

  it("keeps the probability the model returned", async () => {
    createMessage.mockResolvedValueOnce(
      modelReply({ score: 82, conversionProb: 64, factors: { dealPotential: 18 }, reasoning: "Büdcə var." }),
    )
    const stored = await score("test-key")
    expect(stored.scoreDetails).toMatchObject({ conversionProb: 64, aiPowered: true })
  })

  it("stores no probability when the model gave none — not 0%", async () => {
    createMessage.mockResolvedValueOnce(modelReply({ score: 82, factors: {}, reasoning: "Büdcə var." }))
    const stored = await score("test-key")
    expect(stored.scoreDetails).not.toHaveProperty("conversionProb")
    expect(stored.scoreDetails.aiPowered).toBe(true)
  })
})
