import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mocks (vi.mock is hoisted — inline factories only) ──

vi.mock("@/lib/prisma", () => ({
  prisma: {
    leadAssignmentRule: { findMany: vi.fn() },
    lead: { count: vi.fn(), update: vi.fn() },
    contactEvent: { create: vi.fn(), findMany: vi.fn() },
    contact: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/modules", () => ({
  PLANS: {
    starter: { modules: [], limits: { users: 3, contacts: 500 }, price: 9 },
    business: { modules: [], limits: { users: 10, contacts: 2500 }, price: 19 },
    enterprise: { modules: [], limits: { users: -1, contacts: -1 }, price: 59 },
  },
}))

import { prisma as mockPrisma } from "@/lib/prisma"
import { applyLeadAssignmentRules } from "@/lib/lead-assignment"
import { buildContactWhere } from "@/lib/segment-conditions"
import { trackContactEvent, recalculateEngagementScore } from "@/lib/contact-events"
import { checkContactLimit, checkUserLimit, checkLimit, getRemainingLimit, getPercentageUsed } from "@/lib/plan-limits"

// ═════════════════════════════════════════════════════════════════════════
// 1. lead-assignment.ts
// ═════════════════════════════════════════════════════════════════════════
describe("lead-assignment: applyLeadAssignmentRules", () => {
  beforeEach(() => vi.clearAllMocks())

  it("does nothing when no rules exist", async () => {
    mockPrisma.leadAssignmentRule.findMany.mockResolvedValue([])
    await applyLeadAssignmentRules("org-1", { id: "lead-1" })
    expect(mockPrisma.lead.update).not.toHaveBeenCalled()
  })

  it("applies round-robin assignment when no conditions on rule", async () => {
    mockPrisma.leadAssignmentRule.findMany.mockResolvedValue([
      { method: "round_robin", conditions: [], assignees: ["alice", "bob", "charlie"], priority: 1 },
    ])
    mockPrisma.lead.count.mockResolvedValue(7) // 7 % 3 = 1 => "bob"
    await applyLeadAssignmentRules("org-1", { id: "lead-1" })
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { assignedTo: "bob" },
    })
  })

  it("matches condition-based rule with == operator", async () => {
    mockPrisma.leadAssignmentRule.findMany.mockResolvedValue([
      {
        method: "condition",
        conditions: [{ field: "source", operator: "==", value: "website" }],
        assignees: ["agent-web"],
        priority: 1,
      },
    ])
    await applyLeadAssignmentRules("org-1", { id: "lead-2", source: "website" })
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: "lead-2" },
      data: { assignedTo: "agent-web" },
    })
  })

  it("does not assign when condition does not match", async () => {
    mockPrisma.leadAssignmentRule.findMany.mockResolvedValue([
      {
        method: "condition",
        conditions: [{ field: "source", operator: "==", value: "referral" }],
        assignees: ["agent-ref"],
        priority: 1,
      },
    ])
    await applyLeadAssignmentRules("org-1", { id: "lead-3", source: "cold_call" })
    expect(mockPrisma.lead.update).not.toHaveBeenCalled()
  })

  it("supports contains operator", async () => {
    mockPrisma.leadAssignmentRule.findMany.mockResolvedValue([
      {
        method: "condition",
        conditions: [{ field: "companyName", operator: "contains", value: "tech" }],
        assignees: ["tech-agent"],
        priority: 1,
      },
    ])
    await applyLeadAssignmentRules("org-1", { id: "lead-4", companyName: "TechCorp Inc" })
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: "lead-4" },
      data: { assignedTo: "tech-agent" },
    })
  })

  it("supports >= operator for numeric fields", async () => {
    mockPrisma.leadAssignmentRule.findMany.mockResolvedValue([
      {
        method: "condition",
        conditions: [{ field: "estimatedValue", operator: ">=", value: "10000" }],
        assignees: ["vip-agent"],
        priority: 1,
      },
    ])
    await applyLeadAssignmentRules("org-1", { id: "lead-5", estimatedValue: 15000 })
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: "lead-5" },
      data: { assignedTo: "vip-agent" },
    })
  })

  it("round-robins among multiple assignees on a condition rule", async () => {
    mockPrisma.leadAssignmentRule.findMany.mockResolvedValue([
      {
        method: "condition",
        conditions: [{ field: "source", operator: "==", value: "ads" }],
        assignees: ["a1", "a2"],
        priority: 1,
      },
    ])
    mockPrisma.lead.count.mockResolvedValue(4) // 4 % 2 = 0 => "a1"
    await applyLeadAssignmentRules("org-1", { id: "lead-6", source: "ads" })
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: "lead-6" },
      data: { assignedTo: "a1" },
    })
  })

  it("first matching rule wins (stops after first match)", async () => {
    mockPrisma.leadAssignmentRule.findMany.mockResolvedValue([
      {
        method: "condition",
        conditions: [{ field: "source", operator: "==", value: "web" }],
        assignees: ["first-agent"],
        priority: 1,
      },
      {
        method: "round_robin",
        conditions: [],
        assignees: ["fallback-agent"],
        priority: 2,
      },
    ])
    await applyLeadAssignmentRules("org-1", { id: "lead-7", source: "web" })
    expect(mockPrisma.lead.update).toHaveBeenCalledTimes(1)
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: "lead-7" },
      data: { assignedTo: "first-agent" },
    })
  })

  it("skips rules with empty assignees", async () => {
    mockPrisma.leadAssignmentRule.findMany.mockResolvedValue([
      { method: "round_robin", conditions: [], assignees: [], priority: 1 },
    ])
    await applyLeadAssignmentRules("org-1", { id: "lead-8" })
    expect(mockPrisma.lead.update).not.toHaveBeenCalled()
  })

  it("catches errors without throwing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockPrisma.leadAssignmentRule.findMany.mockRejectedValue(new Error("DB fail"))
    await expect(applyLeadAssignmentRules("org-1", { id: "l1" })).resolves.not.toThrow()
    consoleSpy.mockRestore()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 2. segment-conditions.ts
// ═════════════════════════════════════════════════════════════════════════
describe("segment-conditions: buildContactWhere", () => {
  it("returns base where with only orgId when conditions are empty", () => {
    const where = buildContactWhere("org-1", {})
    expect(where).toEqual({ organizationId: "org-1" })
    expect(where.AND).toBeUndefined()
  })

  it("builds company name filter (insensitive contains)", () => {
    const where = buildContactWhere("org-1", { company: "Acme" })
    expect(where.AND).toEqual([
      { company: { name: { contains: "Acme", mode: "insensitive" } } },
    ])
  })

  it("builds source filter", () => {
    const where = buildContactWhere("org-1", { source: "website" })
    expect(where.AND).toEqual([{ source: "website" }])
  })

  it("builds role/position filter", () => {
    const where = buildContactWhere("org-1", { role: "CEO" })
    expect(where.AND).toEqual([
      { position: { contains: "CEO", mode: "insensitive" } },
    ])
  })

  it("builds tag filter with has operator", () => {
    const where = buildContactWhere("org-1", { tag: "vip" })
    expect(where.AND).toEqual([{ tags: { has: "vip" } }])
  })

  it("builds createdAfter date filter", () => {
    const where = buildContactWhere("org-1", { createdAfter: "2024-01-01" })
    expect(where.AND).toHaveLength(1)
    expect(where.AND[0]).toEqual({ createdAt: { gte: new Date("2024-01-01") } })
  })

  it("builds createdBefore date filter (snake_case alias)", () => {
    const where = buildContactWhere("org-1", { created_before: "2024-12-31" })
    expect(where.AND).toHaveLength(1)
    expect(where.AND[0]).toEqual({ createdAt: { lte: new Date("2024-12-31") } })
  })

  it("builds hasEmail filter", () => {
    const where = buildContactWhere("org-1", { hasEmail: true })
    expect(where.AND).toEqual([
      { email: { not: null } },
      { NOT: { email: "" } },
    ])
  })

  it("builds engagementScoreMin/Max range", () => {
    const where = buildContactWhere("org-1", { engagementScoreMin: "20", engagementScoreMax: "80" })
    expect(where.AND).toEqual([
      { engagementScore: { gte: 20 } },
      { engagementScore: { lte: 80 } },
    ])
  })

  it("builds engagementTier 'hot' shorthand (>= 50)", () => {
    const where = buildContactWhere("org-1", { engagementTier: "hot" })
    expect(where.AND).toEqual([{ engagementScore: { gte: 50 } }])
  })

  it("builds engagementTier 'warm' shorthand (20-50)", () => {
    const where = buildContactWhere("org-1", { engagementTier: "warm" })
    expect(where.AND).toEqual([{ engagementScore: { gte: 20, lt: 50 } }])
  })

  it("builds engagementTier 'cold' shorthand (< 20)", () => {
    const where = buildContactWhere("org-1", { engagementTier: "cold" })
    expect(where.AND).toEqual([{ engagementScore: { lt: 20 } }])
  })

  it("builds inactiveDays filter with OR (null or old date)", () => {
    const before = Date.now()
    const where = buildContactWhere("org-1", { inactiveDays: "30" })
    expect(where.AND).toHaveLength(1)
    expect(where.AND[0].OR).toHaveLength(2)
    expect(where.AND[0].OR[0]).toEqual({ lastActivityAt: null })
    expect(where.AND[0].OR[1].lastActivityAt.lt).toBeInstanceOf(Date)
  })

  it("builds hasEventType filter", () => {
    const where = buildContactWhere("org-1", { hasEventType: "email_opened" })
    expect(where.AND).toEqual([
      { events: { some: { eventType: "email_opened" } } },
    ])
  })

  it("builds openedCampaign filter", () => {
    const where = buildContactWhere("org-1", { openedCampaign: "camp-1" })
    expect(where.AND).toEqual([
      {
        events: {
          some: {
            eventType: "email_opened",
            eventData: { path: ["campaignId"], equals: "camp-1" },
          },
        },
      },
    ])
  })

  it("combines multiple conditions into AND array", () => {
    const where = buildContactWhere("org-1", {
      source: "ads",
      tag: "premium",
      engagementTier: "hot",
    })
    expect(where.AND).toHaveLength(3)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 3. contact-events.ts
// ═════════════════════════════════════════════════════════════════════════
describe("contact-events: trackContactEvent", () => {
  beforeEach(() => vi.clearAllMocks())

  it("creates event record with known event type score", async () => {
    mockPrisma.contactEvent.create.mockResolvedValue({})
    mockPrisma.contact.findUnique.mockResolvedValue({ engagementScore: 10 })
    mockPrisma.contact.update.mockResolvedValue({})

    await trackContactEvent("org-1", "c1", "email_opened", { campaignId: "camp-1" })
    expect(mockPrisma.contactEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        contactId: "c1",
        eventType: "email_opened",
        score: 3, // SCORE_WEIGHTS["email_opened"] = 3
        source: "system",
      }),
    })
  })

  it("defaults score to 1 for unknown event types", async () => {
    mockPrisma.contactEvent.create.mockResolvedValue({})
    mockPrisma.contact.findUnique.mockResolvedValue({ engagementScore: 0 })
    mockPrisma.contact.update.mockResolvedValue({})

    await trackContactEvent("org-1", "c1", "custom_event")
    expect(mockPrisma.contactEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ score: 1 }),
    })
  })

  it("increments engagement score and caps at 100", async () => {
    mockPrisma.contactEvent.create.mockResolvedValue({})
    mockPrisma.contact.findUnique.mockResolvedValue({ engagementScore: 98 })
    mockPrisma.contact.update.mockResolvedValue({})

    await trackContactEvent("org-1", "c1", "deal_created") // score = 15
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: expect.objectContaining({ engagementScore: 100 }), // min(100, 98+15) = 100
    })
  })

  it("uses custom source when provided", async () => {
    mockPrisma.contactEvent.create.mockResolvedValue({})
    mockPrisma.contact.findUnique.mockResolvedValue({ engagementScore: 0 })
    mockPrisma.contact.update.mockResolvedValue({})

    await trackContactEvent("org-1", "c1", "page_visited", {}, "web")
    expect(mockPrisma.contactEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: "web" }),
    })
  })

  it("catches errors without throwing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockPrisma.contactEvent.create.mockRejectedValue(new Error("DB error"))
    await expect(trackContactEvent("org-1", "c1", "email_sent")).resolves.not.toThrow()
    consoleSpy.mockRestore()
  })
})

describe("contact-events: recalculateEngagementScore", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calculates score with time-decay weighting", async () => {
    const now = Date.now()
    mockPrisma.contactEvent.findMany.mockResolvedValue([
      // Recent event (< 30 days): full weight
      { eventType: "email_opened", score: 3, createdAt: new Date(now - 5 * 86400000) },
      // 30-60 days: 50% weight
      { eventType: "deal_created", score: 15, createdAt: new Date(now - 45 * 86400000) },
      // 60-90 days: 25% weight
      { eventType: "meeting_scheduled", score: 10, createdAt: new Date(now - 75 * 86400000) },
    ])
    mockPrisma.contact.update.mockResolvedValue({})

    const score = await recalculateEngagementScore("c1")
    // 3 (full) + 7 (floor(15*0.5)) + 2 (floor(10*0.25)) = 12
    expect(score).toBe(12)
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { engagementScore: 12 },
    })
  })

  it("caps recalculated score at 100", async () => {
    const now = Date.now()
    const manyEvents = Array.from({ length: 20 }, () => ({
      eventType: "deal_created",
      score: 15,
      createdAt: new Date(now - 1 * 86400000),
    }))
    mockPrisma.contactEvent.findMany.mockResolvedValue(manyEvents)
    mockPrisma.contact.update.mockResolvedValue({})

    const score = await recalculateEngagementScore("c1")
    expect(score).toBe(100) // 20*15=300, capped at 100
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 4. plan-limits.ts
// ═════════════════════════════════════════════════════════════════════════
describe("plan-limits: checkLimit", () => {
  it("returns true when usage is below limit", () => {
    expect(checkLimit({ plan: "starter" }, "contacts", 100)).toBe(true) // limit 500
  })

  it("returns false when usage meets or exceeds limit", () => {
    expect(checkLimit({ plan: "starter" }, "contacts", 500)).toBe(false)
  })

  it("returns true for unlimited plan (enterprise: -1)", () => {
    expect(checkLimit({ plan: "enterprise" }, "contacts", 999999)).toBe(true)
  })

  it("returns false for unknown plan (limit 0)", () => {
    expect(checkLimit({ plan: "nonexistent" }, "contacts", 1)).toBe(false)
  })

  it("uses currentUsage from org context when available", () => {
    expect(checkLimit({ plan: "starter", currentUsage: { users: 0, contacts: 499, ai_calls: 0 } }, "contacts")).toBe(true)
    expect(checkLimit({ plan: "starter", currentUsage: { users: 0, contacts: 500, ai_calls: 0 } }, "contacts")).toBe(false)
  })
})

describe("plan-limits: getRemainingLimit", () => {
  it("returns remaining contacts correctly", () => {
    expect(getRemainingLimit({ plan: "starter" }, "contacts", 100)).toBe(400)
  })

  it("returns 0 when at limit", () => {
    expect(getRemainingLimit({ plan: "starter" }, "contacts", 600)).toBe(0) // max(0, 500-600)
  })

  it("returns Infinity for unlimited plan", () => {
    expect(getRemainingLimit({ plan: "enterprise" }, "contacts", 100)).toBe(Infinity)
  })
})

describe("plan-limits: getPercentageUsed", () => {
  it("returns correct percentage", () => {
    expect(getPercentageUsed({ plan: "starter" }, "contacts", 250)).toBe(50) // 250/500*100
  })

  it("caps at 100%", () => {
    expect(getPercentageUsed({ plan: "starter" }, "contacts", 1000)).toBe(100)
  })

  it("returns 0 for unlimited plan", () => {
    expect(getPercentageUsed({ plan: "enterprise" }, "contacts", 500)).toBe(0)
  })
})

describe("plan-limits: checkContactLimit (DB-backed)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns allowed when under limit", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      maxContacts: 1000,
      _count: { contacts: 500 },
    })
    const result = await checkContactLimit("org-1")
    expect(result).toEqual({ allowed: true })
  })

  it("returns denied with message when at limit", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      maxContacts: 100,
      _count: { contacts: 100 },
    })
    const result = await checkContactLimit("org-1")
    expect(result.allowed).toBe(false)
    expect(result.message).toContain("Contact limit reached")
  })

  it("returns allowed when maxContacts is -1 (unlimited)", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      maxContacts: -1,
      _count: { contacts: 99999 },
    })
    const result = await checkContactLimit("org-1")
    expect(result).toEqual({ allowed: true })
  })

  it("returns denied when org not found", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null)
    const result = await checkContactLimit("bad-org")
    expect(result).toEqual({ allowed: false, message: "Organization not found" })
  })
})

describe("plan-limits: checkUserLimit (DB-backed)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns allowed when under user limit", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      maxUsers: 10,
      _count: { users: 5 },
    })
    const result = await checkUserLimit("org-1")
    expect(result).toEqual({ allowed: true })
  })

  it("returns denied when at user limit", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      maxUsers: 3,
      _count: { users: 3 },
    })
    const result = await checkUserLimit("org-1")
    expect(result.allowed).toBe(false)
    expect(result.message).toContain("User limit reached")
  })
})
