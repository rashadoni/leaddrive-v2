/**
 * Integration tests for CLM Slice 3c:
 *   POST /api/cron/contract-approval-escalations
 *
 * Tests cover:
 *   - Picks overdue pending stages (dueAt <= now, status=pending, escalationLevel < MAX)
 *   - Respects ESCALATION_INTERVAL_HOURS (lastEscalatedAt <= now - 24h)
 *   - Respects MAX_ESCALATIONS cap (escalationLevel >= 3 → skip)
 *   - Skips stages on non-pending_approval contracts
 *   - Skips stages with dueAt in the future (not overdue)
 *   - Skips stages with terminal status (approved/rejected)
 *   - Notifies admins + assignee
 *   - Logs ContractApprovalEscalationEvent
 *   - Conditional CAS update: count===0 → skipped (no double-escalation)
 *   - Cron auth: 503 when CRON_SECRET unset; 401 when wrong
 *   - Returns { escalated, skipped, errors, timestamp }
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractApprovalStage: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    contractApprovalEscalationEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}))

import { POST } from "@/app/api/cron/contract-approval-escalations/route"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG = "org-1"
const CONTRACT_ID = "contract-1"
const STAGE_ID = "stage-1"
const CRON_SECRET = "test-secret"

const now = new Date("2026-06-07T12:00:00.000Z")
const overdueDate = new Date("2026-06-07T06:00:00.000Z") // 6h ago
const futureDate = new Date("2026-06-07T18:00:00.000Z") // 6h ahead
const longAgo = new Date("2026-06-06T06:00:00.000Z") // >24h ago
const recentlyEscalated = new Date("2026-06-07T10:00:00.000Z") // 2h ago (inside interval)

const makeOverdueStage = (overrides: Record<string, unknown> = {}) => ({
  id: STAGE_ID,
  organizationId: ORG,
  contractId: CONTRACT_ID,
  order: 1,
  label: "Legal Review",
  status: "pending",
  dueAt: overdueDate,
  escalationLevel: 0,
  lastEscalatedAt: null,
  assigneeUserId: null,
  assigneeRole: null,
  slaHours: 24,
  contract: {
    id: CONTRACT_ID,
    title: "Test Contract",
    contractNumber: "CNT-001",
    status: "pending_approval",
  },
  ...overrides,
})

function makeCronReq(secret?: string) {
  return new NextRequest("http://localhost/api/cron/contract-approval-escalations", {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
  })
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("CRON_SECRET", CRON_SECRET)
  vi.useFakeTimers()
  vi.setSystemTime(now)

  vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([])
  vi.mocked(prisma.contractApprovalStage.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.contractApprovalEscalationEvent.create).mockResolvedValue({} as never)
  vi.mocked(createNotification).mockResolvedValue({ id: "notif-1" } as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([
    { id: "admin-1" },
    { id: "admin-2" },
  ] as never)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

// ─── Auth tests ───────────────────────────────────────────────────────────────

describe("cron auth", () => {
  it("returns 503 when CRON_SECRET is not configured", async () => {
    vi.unstubAllEnvs()
    vi.stubEnv("CRON_SECRET", "")

    const res = await POST(makeCronReq())
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toMatch(/CRON_SECRET not configured/i)
  })

  it("returns 401 when x-cron-secret is wrong", async () => {
    const res = await POST(makeCronReq("wrong-secret"))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toMatch(/unauthorized/i)
  })

  it("passes with correct secret", async () => {
    const res = await POST(makeCronReq(CRON_SECRET))
    expect(res.status).toBe(200)
  })
})

// ─── Core escalation logic ────────────────────────────────────────────────────

describe("escalation cron", () => {
  it("escalates an overdue pending stage with no previous escalation", async () => {
    const stage = makeOverdueStage()
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([stage] as never)

    const res = await POST(makeCronReq(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.escalated).toBe(1)
    expect(json.data.skipped).toBe(0)
  })

  it("notifies org admins and the stage assignee", async () => {
    const stage = makeOverdueStage({ assigneeUserId: "user-alice" })
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([stage] as never)

    await POST(makeCronReq(CRON_SECRET))

    // Should have notified admin-1, admin-2, and alice
    const calls = vi.mocked(createNotification).mock.calls
    const notifiedIds = calls.map((c) => c[0].userId)
    expect(notifiedIds).toContain("admin-1")
    expect(notifiedIds).toContain("admin-2")
    expect(notifiedIds).toContain("user-alice")
  })

  it("does not double-notify the assignee if they are already an admin", async () => {
    // assigneeUserId is admin-1 who is already in the admin list
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "admin-1" },
    ] as never)
    const stage = makeOverdueStage({ assigneeUserId: "admin-1" })
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([stage] as never)

    await POST(makeCronReq(CRON_SECRET))

    // admin-1 should appear only once in the calls (not twice)
    const calls = vi.mocked(createNotification).mock.calls
    const notifiedIds = calls.map((c) => c[0].userId)
    const admin1Count = notifiedIds.filter((id) => id === "admin-1").length
    expect(admin1Count).toBe(1)
  })

  it("logs a ContractApprovalEscalationEvent with correct fields", async () => {
    const stage = makeOverdueStage({ assigneeUserId: "user-alice" })
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([stage] as never)

    await POST(makeCronReq(CRON_SECRET))

    expect(prisma.contractApprovalEscalationEvent.create).toHaveBeenCalledOnce()
    const call = vi.mocked(prisma.contractApprovalEscalationEvent.create).mock.calls[0][0]
    expect(call.data.organizationId).toBe(ORG)
    expect(call.data.contractId).toBe(CONTRACT_ID)
    expect(call.data.stageId).toBe(STAGE_ID)
    expect(call.data.order).toBe(1)
    expect(call.data.level).toBe(1) // next level (was 0)
    expect(call.data.eventType).toBe("escalated")
    expect(Array.isArray(call.data.notifiedUserIds)).toBe(true)
  })

  it("conditionally updates escalationLevel via CAS — count===1 → escalated", async () => {
    const stage = makeOverdueStage()
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([stage] as never)
    vi.mocked(prisma.contractApprovalStage.updateMany).mockResolvedValue({ count: 1 })

    const res = await POST(makeCronReq(CRON_SECRET))
    const json = await res.json()
    expect(json.data.escalated).toBe(1)
    expect(json.data.skipped).toBe(0)

    // Verify CAS guard: updateMany should filter by current escalationLevel
    const updateCall = vi.mocked(prisma.contractApprovalStage.updateMany).mock.calls[0][0]
    expect(updateCall.where.escalationLevel).toBe(0) // current level
    expect(updateCall.where.status).toBe("pending")
  })

  it("CAS count===0 → skipped, no notification and no event created (double-worker guard)", async () => {
    const stage = makeOverdueStage()
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([stage] as never)
    vi.mocked(prisma.contractApprovalStage.updateMany).mockResolvedValue({ count: 0 })

    const res = await POST(makeCronReq(CRON_SECRET))
    const json = await res.json()

    expect(json.data.escalated).toBe(0)
    expect(json.data.skipped).toBe(1)
    // No notification must be sent when the CAS misses (another worker won)
    expect(createNotification).not.toHaveBeenCalled()
    // No escalation event must be logged when the CAS misses
    expect(prisma.contractApprovalEscalationEvent.create).not.toHaveBeenCalled()
  })

  it("CAS updateMany is called BEFORE notifications and event (ordering guard)", async () => {
    const callOrder: string[] = []
    const stage = makeOverdueStage()
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([stage] as never)

    vi.mocked(prisma.contractApprovalStage.updateMany).mockImplementation(async () => {
      callOrder.push("updateMany")
      return { count: 1 }
    })
    vi.mocked(createNotification).mockImplementation(async () => {
      callOrder.push("createNotification")
      return { id: "notif-1" } as never
    })
    vi.mocked(prisma.contractApprovalEscalationEvent.create).mockImplementation(async () => {
      callOrder.push("createEvent")
      return {} as never
    })

    await POST(makeCronReq(CRON_SECRET))

    // updateMany (CAS) must be the very first operation recorded
    expect(callOrder[0]).toBe("updateMany")
    // notifications and event come after
    expect(callOrder).toContain("createNotification")
    expect(callOrder).toContain("createEvent")
    const casIndex = callOrder.indexOf("updateMany")
    const firstNotifIndex = callOrder.indexOf("createNotification")
    const eventIndex = callOrder.indexOf("createEvent")
    expect(casIndex).toBeLessThan(firstNotifIndex)
    expect(casIndex).toBeLessThan(eventIndex)
  })

  it("respects ESCALATION_INTERVAL_HOURS — skips if lastEscalatedAt is recent (< 24h)", async () => {
    // The findMany query itself filters by interval. We test that the WHERE clause
    // is correct by verifying the call arguments include the OR clause.
    // The cron relies on Prisma to filter — simulate with empty result for recent escalation.
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([])

    const res = await POST(makeCronReq(CRON_SECRET))
    const json = await res.json()

    expect(json.data.escalated).toBe(0)
    // Verify the findMany WHERE contains an OR clause for lastEscalatedAt
    const findCall = vi.mocked(prisma.contractApprovalStage.findMany).mock.calls[0][0]
    expect(findCall?.where?.OR).toBeDefined()
    const orClause = findCall?.where?.OR as Array<Record<string, unknown>>
    const hasNullBranch = orClause.some((c) => c.lastEscalatedAt === null)
    const hasIntervalBranch = orClause.some((c) => typeof c.lastEscalatedAt === "object")
    expect(hasNullBranch).toBe(true)
    expect(hasIntervalBranch).toBe(true)
  })

  it("skips stages at MAX_ESCALATIONS (escalationLevel >= 3) — not returned by query", async () => {
    // The findMany WHERE filters escalationLevel < MAX_ESCALATIONS.
    // We verify the WHERE clause rather than simulating via the return value.
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([])

    await POST(makeCronReq(CRON_SECRET))

    const findCall = vi.mocked(prisma.contractApprovalStage.findMany).mock.calls[0][0]
    expect(findCall?.where?.escalationLevel).toEqual({ lt: 3 })
  })

  it("skips stages on non-pending_approval contracts — not returned by query", async () => {
    // The WHERE clause requires contract.status === "pending_approval".
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([])

    await POST(makeCronReq(CRON_SECRET))

    const findCall = vi.mocked(prisma.contractApprovalStage.findMany).mock.calls[0][0]
    expect(findCall?.where?.contract?.status).toBe("pending_approval")
  })

  it("skips stages whose dueAt is in the future (not overdue) — not returned by query", async () => {
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([])

    await POST(makeCronReq(CRON_SECRET))

    const findCall = vi.mocked(prisma.contractApprovalStage.findMany).mock.calls[0][0]
    // dueAt must be not null AND <= now
    expect(findCall?.where?.dueAt).toBeDefined()
    const dueAtClause = findCall?.where?.dueAt as Record<string, unknown>
    expect(dueAtClause.not).toBeNull()
    expect(dueAtClause.lte).toBeInstanceOf(Date)
  })

  it("skips stages with terminal status — not returned by query", async () => {
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([])

    await POST(makeCronReq(CRON_SECRET))

    const findCall = vi.mocked(prisma.contractApprovalStage.findMany).mock.calls[0][0]
    expect(findCall?.where?.status).toBe("pending")
  })

  it("returns summary with escalated/skipped/errors/timestamp", async () => {
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([])

    const res = await POST(makeCronReq(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(typeof json.data.escalated).toBe("number")
    expect(typeof json.data.skipped).toBe("number")
    expect(typeof json.data.errors).toBe("number")
    expect(typeof json.data.timestamp).toBe("string")
  })

  it("handles errors per stage and increments error counter without crashing", async () => {
    const stage = makeOverdueStage()
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([stage] as never)
    vi.mocked(prisma.contractApprovalEscalationEvent.create).mockRejectedValue(new Error("DB error"))

    const res = await POST(makeCronReq(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.errors).toBe(1)
    expect(json.data.escalated).toBe(0)
  })
})
