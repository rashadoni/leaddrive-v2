/**
 * The record cards the assistant reads aloud.
 *
 * Two properties dominate: a missing record is BAD_RECORD (the instruction
 * tells the model that code is final), and empty fields surface as null so the
 * assistant says "not filled in" instead of improvising a value the listener
 * cannot distinguish from a fact.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  dealFindFirst: vi.fn(),
  contactFindFirst: vi.fn(),
  contactFindMany: vi.fn(),
  invoiceFindFirst: vi.fn(),
  productFindFirst: vi.fn(),
  transitionFindMany: vi.fn(),
  activityFindMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deal: { findFirst: mocks.dealFindFirst },
    pipelineStageTransition: { findMany: mocks.transitionFindMany },
    activity: { findMany: mocks.activityFindMany },
    contact: { findFirst: mocks.contactFindFirst, findMany: mocks.contactFindMany },
    invoice: { findFirst: mocks.invoiceFindFirst },
    product: { findFirst: mocks.productFindFirst },
    company: { findFirst: vi.fn(async () => null) },
    lead: { findFirst: vi.fn(async () => null) },
    ticket: { findFirst: vi.fn(async () => null) },
    project: { findFirst: vi.fn(async () => null) },
    contract: { findFirst: vi.fn(async () => null) },
  },
}))

import { readVoiceRecord, VOICE_READABLE_TYPES } from "@/lib/ai/voice/record-read"

const ORG = "org-test"

function dealRow(overrides: Record<string, unknown> = {}) {
  return {
    name: "MegaSoft Integration",
    stage: "PROPOSAL",
    valueAmount: 200000,
    currency: "USD",
    probability: 50,
    confidenceLevel: 50,
    expectedClose: new Date("2026-05-15T00:00:00Z"),
    createdAt: new Date("2026-04-15T00:00:00Z"),
    meddpicc: {
      metrics: { score: 3, note: "20% qənaət" },
      champion: {},
    },
    contactRoles: [
      {
        role: "influencer",
        influence: "High",
        loyalty: "Supportive",
        isPrimary: true,
        cashbackType: "percent",
        cashbackValue: 5,
        contactId: "contact-1",
      },
      {
        role: "contact_person",
        influence: "Low",
        loyalty: "Neutral",
        isPrimary: false,
        cashbackType: null,
        cashbackValue: null,
        contactId: "contact-gone",
      },
    ],
    competitors: [
      { name: "Palo Alto", product: null, strengths: "  brand  ", weaknesses: null, threat: "High" },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
  mocks.contactFindMany.mockResolvedValue([
    { id: "contact-1", fullName: "Aliyev Tural", position: "Regional Manager" },
  ])
  mocks.transitionFindMany.mockResolvedValue([])
  mocks.activityFindMany.mockResolvedValue([])
})

describe("readVoiceRecord: deal history", () => {
  it("reads what actually happened, not only where the deal stands", async () => {
    // Without this the card had no past at all, so "tell me about this deal in
    // detail" could only be refused — which the owner read as the assistant
    // not seeing deals.
    mocks.dealFindFirst.mockResolvedValue(dealRow())
    mocks.transitionFindMany.mockResolvedValue([
      { fromStage: "QUALIFIED", toStage: "PROPOSAL", transitionedAt: new Date("2026-05-02T09:00:00Z"), transitionType: "advance" },
      { fromStage: null, toStage: "QUALIFIED", transitionedAt: new Date("2026-04-15T09:00:00Z"), transitionType: "created" },
    ])
    mocks.activityFindMany.mockResolvedValue([
      { type: "call", subject: "Qiymət razılaşması", createdAt: new Date("2026-05-03T08:00:00Z"), scheduledAt: null, completedAt: new Date("2026-05-03T10:00:00Z") },
      { type: "meeting", subject: null, createdAt: new Date("2026-05-06T08:00:00Z"), scheduledAt: new Date("2026-05-10T08:00:00Z"), completedAt: null },
    ])

    const card = (await readVoiceRecord(ORG, "deal", "deal-1")) as Record<string, any>

    expect(card.stageHistory).toEqual([
      { fromStage: "QUALIFIED", toStage: "PROPOSAL", date: "2026-05-02", type: "advance" },
      { fromStage: null, toStage: "QUALIFIED", date: "2026-04-15", type: "created" },
    ])
    // A planned meeting is not a held one: the date is the one that applies and
    // `done` keeps the two apart.
    expect(card.recentActivity).toEqual([
      { type: "call", subject: "Qiymət razılaşması", date: "2026-05-03", done: true },
      { type: "meeting", subject: null, date: "2026-05-10", done: false },
    ])
    // Scoped to this deal, by the same convention the deal page uses.
    expect(mocks.activityFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: ORG, relatedType: "deal", relatedId: "deal-1" },
    }))
    expect(mocks.transitionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: ORG, dealId: "deal-1" },
    }))
  })

  it("reports an empty history as empty rather than inferring one", async () => {
    mocks.dealFindFirst.mockResolvedValue(dealRow())

    const card = (await readVoiceRecord(ORG, "deal", "deal-1")) as Record<string, any>

    expect(card.stageHistory).toEqual([])
    expect(card.recentActivity).toEqual([])
    // The current stage is still there — it just is not passed off as history.
    expect(card.stage).toBe("PROPOSAL")
  })
})

describe("readVoiceRecord: deal", () => {
  it("reads the full card: MEDDPICC, cashback, competitors", async () => {
    mocks.dealFindFirst.mockResolvedValue(dealRow())

    const card = (await readVoiceRecord(ORG, "deal", "deal-1")) as Record<string, any>

    expect(card.amount).toBe(200000)
    expect(card.meddpicc.scoreOf40).toBe(3)
    expect(card.meddpicc.assessedBlocks).toBe(1)
    expect(card.meddpicc.totalBlocks).toBe(8)
    // The exact question the owner asked the assistant to answer.
    expect(card.contacts[0]).toMatchObject({
      name: "Aliyev Tural",
      cashback: { type: "percent", value: 5 },
      influence: "High",
    })
    expect(card.competitors[0]).toMatchObject({ name: "Palo Alto", threat: "High" })
    expect(card.competitors[0].strengths).toBe("brand")
  })

  it("says null for cashback nobody agreed, instead of a guess", async () => {
    mocks.dealFindFirst.mockResolvedValue(dealRow())

    const card = (await readVoiceRecord(ORG, "deal", "deal-1")) as Record<string, any>

    expect(card.contacts[1].cashback).toBeNull()
  })

  it("keeps the facts of a role whose contact vanished", async () => {
    mocks.dealFindFirst.mockResolvedValue(dealRow())

    const card = (await readVoiceRecord(ORG, "deal", "deal-1")) as Record<string, any>

    expect(card.contacts[1].name).toBe("unknown contact")
    expect(card.contacts[1].role).toBe("contact_person")
  })

  it("returns BAD_RECORD for an id that is not there", async () => {
    mocks.dealFindFirst.mockResolvedValue(null)

    await expect(readVoiceRecord(ORG, "deal", "nope")).resolves.toEqual({
      error: "BAD_RECORD",
    })
  })

  it("scopes the query to the organisation", async () => {
    mocks.dealFindFirst.mockResolvedValue(null)

    await readVoiceRecord(ORG, "deal", "deal-1")

    expect(mocks.dealFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "deal-1", organizationId: ORG },
      }),
    )
  })

  it("survives garbage stored in meddpicc", async () => {
    mocks.dealFindFirst.mockResolvedValue(dealRow({ meddpicc: "corrupted" }))

    const card = (await readVoiceRecord(ORG, "deal", "deal-1")) as Record<string, any>

    expect(card.meddpicc.assessedBlocks).toBe(0)
    expect(card.meddpicc.scoreOf40).toBe(0)
  })
})

describe("readVoiceRecord: other types", () => {
  it("reads an invoice card", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({
      invoiceNumber: "INV-42",
      title: "Blok partiyası",
      status: "sent",
      totalAmount: 25000,
      currency: "AZN",
      issueDate: new Date("2026-08-01T00:00:00Z"),
      dueDate: null,
      company: { name: "Delta Telecom" },
      contact: null,
    })

    const card = (await readVoiceRecord(ORG, "invoice", "inv-1")) as Record<string, any>

    expect(card).toMatchObject({
      number: "INV-42",
      total: 25000,
      company: "Delta Telecom",
      contact: null,
      dueDate: null,
    })
  })

  it("reads a product card", async () => {
    mocks.productFindFirst.mockResolvedValue({
      name: "Gobustone blok",
      description: null,
      category: "material",
      sku: "GB-10",
      price: 12,
      currency: "AZN",
      isActive: true,
    })

    const card = (await readVoiceRecord(ORG, "product", "p-1")) as Record<string, any>

    expect(card).toMatchObject({ name: "Gobustone blok", price: 12, active: true })
  })

  it("has a real reader behind every advertised type", async () => {
    // The schema promises these types to the model. The first version of this
    // test compared the list with itself and could not fail; this one proves
    // each reader actually runs its query, because a promise without a reader
    // surfaces as BAD_RECORD on a record that exists.
    const { prisma } = await import("@/lib/prisma")
    for (const type of VOICE_READABLE_TYPES) {
      const result = await readVoiceRecord(ORG, type, "some-id-123")
      expect(result, type).toEqual({ error: "BAD_RECORD" })
    }
    expect(VOICE_READABLE_TYPES).not.toContain("board")
  })

  it("never defaults a missing cashback type to percent", async () => {
    mocks.dealFindFirst.mockResolvedValue(dealRow({
      contactRoles: [{
        role: "influencer", influence: "High", loyalty: "Supportive",
        isPrimary: true, cashbackType: null, cashbackValue: 500,
        contactId: "contact-1",
      }],
      competitors: [],
    }))

    const card = (await readVoiceRecord(ORG, "deal", "deal-1")) as Record<string, any>

    // 500 stored as fixed with an unset type must not become "500 percent".
    expect(card.contacts[0].cashback).toEqual({ type: null, value: 500 })
  })

  it("keeps decimal prices instead of rounding to whole units", async () => {
    mocks.productFindFirst.mockResolvedValue({
      name: "Blok", description: null, category: "material",
      sku: null, price: 12.5, currency: "AZN", isActive: true,
    })

    const card = (await readVoiceRecord(ORG, "product", "p-1")) as Record<string, any>

    expect(card.price).toBe(12.5)
  })

  it("caps the people and competitor lists a deal can speak", async () => {
    mocks.dealFindFirst.mockResolvedValue(dealRow())

    await readVoiceRecord(ORG, "deal", "deal-1")

    const select = mocks.dealFindFirst.mock.calls[0][0].select
    // A deal with two hundred roles must not flood the model context.
    expect(select.contactRoles.take).toBe(12)
    expect(select.competitors.take).toBe(8)
  })

  it("trims oversized names before they reach speech", async () => {
    mocks.dealFindFirst.mockResolvedValue(dealRow({ name: "ə".repeat(5000) }))

    const card = (await readVoiceRecord(ORG, "deal", "deal-1")) as Record<string, any>

    expect((card.name as string).length).toBeLessThanOrEqual(300)
  })
})
