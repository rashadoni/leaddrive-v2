import { beforeEach, describe, expect, it, vi } from "vitest"

const groupBy = vi.hoisted(() => vi.fn())
const activityFindMany = vi.hoisted(() => vi.fn())
const leadFindFirst = vi.hoisted(() => vi.fn())
const leadUpdate = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { groupBy, findFirst: leadFindFirst, update: leadUpdate },
    activity: { findMany: activityFindMany },
  },
}))

import { calculateLeadScore, scoreLeadNow } from "@/lib/ai/lead-scoring"

const ORG = "org-1"

/** A lead exactly as the inbox produces one: a chat, a phone, a stated need. */
function chatLead(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead-1",
    email: null,
    phone: "+994500000001",
    phoneWhatsApp: null,
    telegramHandle: null,
    contactName: "rashadoni",
    companyName: null,
    source: "tiktok",
    interest: "Müştəri qazablok ilə kərpicin kubik üzrə qiymət və iqtisadiyyat fərqini öyrənmək istəyir.",
    customerStage: null,
    salesCallOutcomes: [],
    estimatedValue: null,
    notes: null,
    createdAt: new Date(),
    ...overrides,
  }
}

describe("lead scoring model", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activityFindMany.mockResolvedValue([])
    // A channel that has produced many leads and few conversions — the exact
    // shape that used to subtract points from every lead it delivered.
    groupBy.mockResolvedValue([{ status: "new", _count: { id: 45 } }])
  })

  it("does not flatten every chat lead onto the same number", async () => {
    // The complaint that started this: 43 of 53 active leads scored exactly 13,
    // because each lost the same points for having no work email, no activity
    // rows yet, and arriving through a channel that converts slowly.
    const withPhone = await calculateLeadScore(ORG, chatLead())
    const withoutAnyChannel = await calculateLeadScore(ORG, chatLead({ phone: null, interest: null }))

    expect(withPhone.score).toBeGreaterThan(withoutAnyChannel.score)
    expect(withPhone.score).toBeGreaterThan(30)
    expect(withoutAnyChannel.score).toBeLessThan(20)
  })

  it("lets the salesperson's own verdict outweigh the metadata", async () => {
    const interested = await calculateLeadScore(ORG, chatLead({ customerStage: "interested" }))
    const neutral = await calculateLeadScore(ORG, chatLead())
    const refused = await calculateLeadScore(ORG, chatLead({ customerStage: "not_sold" }))

    expect(interested.score).toBeGreaterThan(neutral.score)
    expect(refused.score).toBeLessThan(neutral.score)
    // A human who spoke to the customer must move the number further than any
    // guess made from form fields.
    expect(interested.score - refused.score).toBeGreaterThanOrEqual(40)
  })

  it("reads the outcome list when no single stage is set", async () => {
    const viaOutcomes = await calculateLeadScore(ORG, chatLead({ salesCallOutcomes: ["interested"] }))
    const neutral = await calculateLeadScore(ORG, chatLead())
    expect(viaOutcomes.score).toBeGreaterThan(neutral.score)
  })

  it("never subtracts for the channel a lead arrived through", async () => {
    // Circular by construction: a source converts poorly, so its leads rank
    // low, so they are worked last, so it converts poorly.
    groupBy.mockResolvedValue([
      { status: "new", _count: { id: 100 } },
      { status: "converted", _count: { id: 1 } },
    ])
    const punished = await calculateLeadScore(ORG, chatLead())
    groupBy.mockResolvedValue([{ status: "new", _count: { id: 2 } }])
    const unknownSource = await calculateLeadScore(ORG, chatLead())
    expect(punished.score).toBeGreaterThanOrEqual(unknownSource.score)
  })

  it("does not punish a lead for being new", async () => {
    activityFindMany.mockResolvedValue([])
    const fresh = await calculateLeadScore(ORG, chatLead())
    activityFindMany.mockResolvedValue([{ createdAt: new Date() }])
    const touched = await calculateLeadScore(ORG, chatLead())
    // Some history is worth more than none, but none is not a demerit.
    expect(touched.score).toBeGreaterThan(fresh.score)
    expect(fresh.score).toBeGreaterThan(30)
  })

  it("stamps when it scored, so 'not scored yet' stops looking like 'worthless'", async () => {
    leadFindFirst.mockResolvedValue(chatLead())
    leadUpdate.mockResolvedValue({})

    const score = await scoreLeadNow(ORG, "lead-1")

    expect(score).toBeGreaterThan(0)
    const data = leadUpdate.mock.calls[0][0].data
    expect(data.lastScoredAt).toBeInstanceOf(Date)
    expect(data.scoreDetails.factors).toMatchObject({
      contactCompleteness: expect.any(Number),
      engagementLevel: expect.any(Number),
      dealPotential: expect.any(Number),
    })
  })

  it("never lets a scoring failure break whatever created the lead", async () => {
    leadFindFirst.mockRejectedValue(new Error("db down"))
    await expect(scoreLeadNow(ORG, "lead-1")).resolves.toBeNull()
    expect(leadUpdate).not.toHaveBeenCalled()
  })
})
