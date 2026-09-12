import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sharingRule: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}))

import { applyRecordFilter } from "@/lib/sharing-rules"
import { prisma } from "@/lib/prisma"

describe("applyRecordFilter", () => {
  const orgId = "org-1"
  const userId = "user-1"
  const baseWhere = { organizationId: orgId, status: "active" }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("admin sees everything — returns baseWhere unmodified", async () => {
    const result = await applyRecordFilter(orgId, userId, "admin", "deal", baseWhere)
    expect(result).toEqual(baseWhere)
    expect(prisma.sharingRule.findMany).not.toHaveBeenCalled()
  })

  it("manager sees everything — returns baseWhere unmodified", async () => {
    const result = await applyRecordFilter(orgId, userId, "manager", "deal", baseWhere)
    expect(result).toEqual(baseWhere)
  })

  it("non-admin with no rules sees only own task records", async () => {
    vi.mocked(prisma.sharingRule.findMany).mockResolvedValue([])

    const result = await applyRecordFilter(orgId, userId, "sales", "task", baseWhere)
    expect(result).toHaveProperty("OR")
    expect(result.OR).toContainEqual({ assignedTo: userId })
    expect(result.OR).toContainEqual({ createdBy: userId })
    expect(result.organizationId).toBe(orgId)
    expect(result.status).toBe("active")
  })

  it.each(["company", "contact"])(
    "treats ownerless %s records as tenant-wide instead of querying phantom fields",
    async (entityType) => {
      const result = await applyRecordFilter(orgId, userId, "sales", entityType, baseWhere)

      expect(result).toEqual(baseWhere)
      expect(prisma.sharingRule.findMany).not.toHaveBeenCalled()
    },
  )

  it("shows salespeople only their assigned leads without exposing the unassigned SMM queue", async () => {
    vi.mocked(prisma.sharingRule.findMany).mockResolvedValue([])

    const result = await applyRecordFilter(orgId, userId, "sales", "lead", baseWhere)

    expect(result.OR).toEqual([{ assignedTo: userId }])
    expect(JSON.stringify(result)).not.toContain("createdBy")
  })

  it("shows own and unassigned deals, which also have no createdBy column", async () => {
    vi.mocked(prisma.sharingRule.findMany).mockResolvedValue([])

    const result = await applyRecordFilter(orgId, userId, "sales", "deal", baseWhere)

    expect(result.OR).toEqual([{ assignedTo: userId }, { assignedTo: null }])
    expect(JSON.stringify(result)).not.toContain("createdBy")
  })

  it("keeps ownerless tickets visible as a claimable shared intake queue", async () => {
    vi.mocked(prisma.sharingRule.findMany).mockResolvedValue([])

    const result = await applyRecordFilter(orgId, userId, "support", "ticket", baseWhere)

    expect(result.OR).toEqual([
      { assignedTo: userId },
      { createdBy: userId },
      { assignedTo: null },
    ])
  })

  it("shares leads by assignee without referencing a missing createdBy column", async () => {
    vi.mocked(prisma.sharingRule.findMany).mockResolvedValue([
      { id: "r1", ruleType: "role", targetRole: "sales", sourceRole: "manager", isActive: true } as never,
    ])
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "mgr-1" } as never])

    const result = await applyRecordFilter(orgId, userId, "sales", "lead", baseWhere)

    expect(result.OR).toEqual([
      { assignedTo: userId },
      { OR: [{ assignedTo: { in: ["mgr-1"] } }] },
    ])
  })

  it("rule type 'all' grants full access to everyone", async () => {
    vi.mocked(prisma.sharingRule.findMany).mockResolvedValue([
      { id: "r1", ruleType: "all", isActive: true } as never,
    ])

    const result = await applyRecordFilter(orgId, userId, "support", "deal", baseWhere)
    expect(result).toEqual(baseWhere) // No OR filter applied
  })

  it("role-based rule adds source user records to OR conditions", async () => {
    vi.mocked(prisma.sharingRule.findMany).mockResolvedValue([
      { id: "r1", ruleType: "role", targetRole: "sales", sourceRole: "manager", isActive: true } as never,
    ])
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "mgr-1" } as never,
      { id: "mgr-2" } as never,
    ])

    const result = await applyRecordFilter(orgId, userId, "sales", "task", baseWhere)
    expect(result.OR).toHaveLength(3) // own assigned + own created + manager records
    expect(result.OR[2]).toEqual({
      OR: [
        { assignedTo: { in: ["mgr-1", "mgr-2"] } },
        { createdBy: { in: ["mgr-1", "mgr-2"] } },
      ],
    })
  })

  it("role-based rule for different targetRole is ignored", async () => {
    vi.mocked(prisma.sharingRule.findMany).mockResolvedValue([
      { id: "r1", ruleType: "role", targetRole: "support", sourceRole: "sales", isActive: true } as never,
    ])

    const result = await applyRecordFilter(orgId, userId, "sales", "task", baseWhere)
    // Rule targetRole=support doesn't match user role=sales, so only own records
    expect(result.OR).toHaveLength(2)
  })

  it("preserves all original baseWhere conditions", async () => {
    vi.mocked(prisma.sharingRule.findMany).mockResolvedValue([])
    const complexWhere = { organizationId: orgId, status: "open", priority: "high", category: "billing" }

    const result = await applyRecordFilter(orgId, userId, "sales", "ticket", complexWhere)
    expect(result.organizationId).toBe(orgId)
    expect(result.status).toBe("open")
    expect(result.priority).toBe("high")
    expect(result.category).toBe("billing")
    expect(result.OR).toBeDefined()
  })

  it("conjoins ownership with an existing search OR instead of replacing it", async () => {
    vi.mocked(prisma.sharingRule.findMany).mockResolvedValue([])
    const searchWhere = {
      organizationId: orgId,
      OR: [
        { contactName: { contains: "acme" } },
        { companyName: { contains: "acme" } },
      ],
    }

    const result = await applyRecordFilter(orgId, userId, "sales", "lead", searchWhere)

    expect(result).toEqual({
      AND: [
        searchWhere,
        { OR: [{ assignedTo: userId }] },
      ],
    })
  })
})
