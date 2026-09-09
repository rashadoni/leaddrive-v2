/**
 * Tests for CLM Slice-3a: resolveApprovalAssignee (delegation resolver).
 *
 * The resolver is pure-ish: it takes a Prisma-like client, an orgId,
 * a userId, and a reference date. We mock the `userApprovalDelegate.findFirst`
 * method directly to avoid any real DB dependency.
 */
import { describe, expect, it, vi } from "vitest"
import { resolveApprovalAssignee } from "@/lib/contract-lifecycle/delegation"
import type { DelegationResult } from "@/lib/contract-lifecycle/delegation"

// Minimal mock of the Prisma client shape used by the resolver.
function makePrismaMock(result: { toUserId: string } | null) {
  return {
    userApprovalDelegate: {
      findFirst: vi.fn().mockResolvedValue(result),
    },
  }
}

const ORG = "org-1"
const USER_A = "user-alice"
const USER_B = "user-bob"
const USER_C = "user-carol"

// Helper: date relative to a base
const D = (days: number, base = new Date("2026-06-15T12:00:00Z")) => {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

describe("resolveApprovalAssignee", () => {
  it("returns original user when no active delegation found", async () => {
    const prisma = makePrismaMock(null)
    const asOf = D(0)
    const result = await resolveApprovalAssignee(prisma as never, ORG, USER_A, asOf)

    expect(result).toEqual<DelegationResult>({
      resolvedUserId: USER_A,
      delegated: false,
      originalUserId: USER_A,
    })
    expect(prisma.userApprovalDelegate.findFirst).toHaveBeenCalledOnce()
    // Verify org-scoping and date-window are passed
    const call = prisma.userApprovalDelegate.findFirst.mock.calls[0][0]
    expect(call.where.organizationId).toBe(ORG)
    expect(call.where.fromUserId).toBe(USER_A)
    expect(call.where.isActive).toBe(true)
    expect(call.where.startDate.lte).toEqual(asOf)
    expect(call.where.endDate.gte).toEqual(asOf)
  })

  it("returns the delegate when an active in-window delegation is found", async () => {
    const prisma = makePrismaMock({ toUserId: USER_B })
    const result = await resolveApprovalAssignee(prisma as never, ORG, USER_A, D(0))

    expect(result).toEqual<DelegationResult>({
      resolvedUserId: USER_B,
      delegated: true,
      originalUserId: USER_A,
    })
  })

  it("uses the asOf date for the date-window query (in-window)", async () => {
    const prisma = makePrismaMock({ toUserId: USER_B })
    const asOf = new Date("2026-06-20T08:00:00Z")
    await resolveApprovalAssignee(prisma as never, ORG, USER_A, asOf)

    const call = prisma.userApprovalDelegate.findFirst.mock.calls[0][0]
    expect(call.where.startDate.lte).toEqual(asOf)
    expect(call.where.endDate.gte).toEqual(asOf)
  })

  it("does NOT recurse — returns one-hop delegate only (not delegate's delegate)", async () => {
    // If USER_B also has a delegation to USER_C, the resolver must NOT follow it.
    // The DB mock returns USER_B as delegate; the test verifies that findFirst
    // is called exactly once (no second call for USER_B's chain).
    const prisma = makePrismaMock({ toUserId: USER_B })
    const result = await resolveApprovalAssignee(prisma as never, ORG, USER_A, D(0))

    expect(result.resolvedUserId).toBe(USER_B) // one hop
    expect(prisma.userApprovalDelegate.findFirst).toHaveBeenCalledOnce() // not twice
  })

  it("respects org scope — passes organizationId to the query", async () => {
    const OTHER_ORG = "org-other"
    const prisma = makePrismaMock(null)
    await resolveApprovalAssignee(prisma as never, OTHER_ORG, USER_A, D(0))

    const call = prisma.userApprovalDelegate.findFirst.mock.calls[0][0]
    expect(call.where.organizationId).toBe(OTHER_ORG)
  })

  it("returns original when delegation exists but isActive=false (mock returns null)", async () => {
    // The DB query includes isActive:true in the WHERE clause, so an inactive
    // delegation causes findFirst to return null — the resolver returns original.
    const prisma = makePrismaMock(null)
    const result = await resolveApprovalAssignee(prisma as never, ORG, USER_A, D(0))

    expect(result.delegated).toBe(false)
    expect(result.resolvedUserId).toBe(USER_A)
  })

  it("returns original when the reference date is before the delegation window", async () => {
    // Again: DB returns null because the WHERE predicate (startDate <= asOf) is not met.
    const prisma = makePrismaMock(null)
    const asOfBeforeWindow = new Date("2025-01-01T00:00:00Z")
    const result = await resolveApprovalAssignee(prisma as never, ORG, USER_A, asOfBeforeWindow)

    expect(result.delegated).toBe(false)
    expect(result.resolvedUserId).toBe(USER_A)
  })

  it("returns original when the reference date is after the delegation window", async () => {
    const prisma = makePrismaMock(null)
    const asOfAfterWindow = new Date("2099-12-31T23:59:59Z")
    const result = await resolveApprovalAssignee(prisma as never, ORG, USER_A, asOfAfterWindow)

    expect(result.delegated).toBe(false)
  })

  it("originalUserId always equals the input userId", async () => {
    // Regardless of delegation outcome, originalUserId must trace back to the
    // input (not the delegate's userId).
    const prismaDelegate = makePrismaMock({ toUserId: USER_C })
    const withDelegate = await resolveApprovalAssignee(prismaDelegate as never, ORG, USER_B, D(0))
    expect(withDelegate.originalUserId).toBe(USER_B)

    const prismaDirect = makePrismaMock(null)
    const withoutDelegate = await resolveApprovalAssignee(prismaDirect as never, ORG, USER_B, D(0))
    expect(withoutDelegate.originalUserId).toBe(USER_B)
  })
})
