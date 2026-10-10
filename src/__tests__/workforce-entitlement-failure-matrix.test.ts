import { beforeEach, describe, expect, it, vi } from "vitest"
const { candidates, materialize } = vi.hoisted(() => ({ candidates: vi.fn(), materialize: vi.fn() }))
vi.mock("@/lib/workforce/no-show-candidate-batch", () => ({ readWorkforceNoShowCandidateBatch: candidates }))
vi.mock("@/lib/workforce/no-show-case-materializer", () => ({ materializeAuthorizedWorkforceNoShowReviewCaseInTransaction: materialize }))
import { runScheduledWorkforceNoShowReview } from "@/lib/workforce/no-show-review-scheduler"
import { accessibleNavItems } from "@/lib/nav-items"

const modes = [[false, false], [false, true], [true, false], [true, true]] as const
function fixture(routeField: boolean, workforceHrm: boolean, enabled = true) {
  const modules = { mtm: routeField, "route-field": routeField, "workforce-hrm": workforceHrm }
  const organization = { id: "tenant-matrix", isActive: true, plan: "enterprise", addons: [], features: enabled ? ["workforce-no-show-review-v1"] : [], modules }
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ cursor: null, version: 1 }]),
    systemJobCursor: { upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
    organization: { findUnique: vi.fn().mockResolvedValue(organization), findFirst: vi.fn().mockResolvedValueOnce(organization).mockResolvedValue(null) },
    mtmAuditLog: { create: vi.fn() },
  }
  const db = { $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)) }
  const leaseStore = { acquire: vi.fn().mockResolvedValue(true), renew: vi.fn().mockResolvedValue(true), recordSkipped: vi.fn(), complete: vi.fn().mockResolvedValue(true), fail: vi.fn().mockResolvedValue(true) }
  return { modules, tx, db, leaseStore, input: { db: db as never, leaseStore, now: new Date("2026-10-06T09:00:00Z") } }
}
beforeEach(() => { vi.clearAllMocks(); candidates.mockReset(); candidates.mockResolvedValue({ candidates: [], morePending: false, nextCursorAgentId: null }) })

describe("Withdrawal four-mode navigation/job matrix without activating any tenant", () => {
  it.each(modes)("Routes=%s HRM=%s keeps Route & Field while suppressing HRM nav and jobs", async (routes, hrm) => {
    const setup = fixture(routes, hrm)
    const hrefs = accessibleNavItems({ plan: "enterprise", role: "manager", modules: setup.modules }).map(item => item.href)
    expect(hrefs.includes("/mtm")).toBe(routes)
    expect(hrefs.includes("/workforce")).toBe(false)
    const result = await runScheduledWorkforceNoShowReview(setup.input)
    expect(result.workforceTenantsConsidered).toBe(0)
    expect(result.reviewEnabledTenantsScanned).toBe(0)
    expect(candidates).toHaveBeenCalledTimes(0)
    expect(materialize).not.toHaveBeenCalled()
    expect(setup.tx.mtmAuditLog.create).toHaveBeenCalledTimes(0)
  })
  it.each(modes)("Routes=%s HRM=%s cannot enter a failing HRM dependency even with retained entitlement", async (routes, hrm) => {
    const setup = fixture(routes, hrm)
    candidates.mockRejectedValue(new Error("SYNTHETIC-CANDIDATE-DEPENDENCY"))
    await expect(runScheduledWorkforceNoShowReview(setup.input)).resolves.toMatchObject({ reviewEnabledTenantsScanned: 0 })
    expect(setup.leaseStore.fail).not.toHaveBeenCalled()
    expect(candidates).toHaveBeenCalledTimes(0)
    expect(materialize).not.toHaveBeenCalled()
  })
  it.each(modes)("Routes=%s HRM=%s still needs the separate no-show rollout opt-in", async (routes, hrm) => {
    const setup = fixture(routes, hrm, false)
    await expect(runScheduledWorkforceNoShowReview(setup.input)).resolves.toMatchObject({ reviewEnabledTenantsScanned: 0 })
    expect(candidates).not.toHaveBeenCalled()
    expect(materialize).not.toHaveBeenCalled()
  })
})
