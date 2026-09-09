/**
 * CLM Slice 5a — cron tests for contract milestone reminders
 *
 * Route under test: POST /api/cron/contract-milestone-reminders
 *
 * Coverage:
 *   - Picks due/overdue uncompleted milestones within lead window
 *   - Notifies ownerUserId + org admins/managers
 *   - Conditional CAS: count===0 → skipped, no double-notify
 *   - Overdue (dueAt <= now) → type "warning"; upcoming → type "info"
 *   - Owner not re-notified if already in admin list
 *   - Cron auth: 503 when CRON_SECRET unset; 401 when wrong
 *   - Returns { reminded, skipped, errors, timestamp }
 *   - Stale/foreign ownerUserId (not same-org active) → owner NOT notified; admins still are
 *   - Valid same-org active ownerUserId → owner IS notified
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractMilestone: {
      findMany:   vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}))

import { POST } from "@/app/api/cron/contract-milestone-reminders/route"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG         = "org-1"
const CTR         = "ctr-1"
const MLSTN       = "ms-1"
const CRON_SECRET = "test-secret"

const now          = new Date("2026-06-07T12:00:00.000Z")
const overdueDate  = new Date("2026-06-06T12:00:00.000Z")  // 24h ago
const upcomingDate = new Date("2026-06-10T12:00:00.000Z")  // 3 days ahead (within 7-day window)
const farFuture    = new Date("2026-08-01T00:00:00.000Z")  // beyond lead window
const longAgo      = new Date("2026-06-05T12:00:00.000Z")  // lastRemindedAt well past interval

const makeBaseMilestone = (overrides: Record<string, unknown> = {}) => ({
  id:             MLSTN,
  organizationId: ORG,
  contractId:     CTR,
  label:          "Phase-1 report",
  dueAt:          overdueDate,
  status:         "pending",
  ownerUserId:    null,
  lastRemindedAt: null,
  contract: {
    id:             CTR,
    title:          "Test Contract",
    contractNumber: "CNT-001",
  },
  ...overrides,
})

function makeCronReq(secret?: string) {
  return new NextRequest("http://localhost/api/cron/contract-milestone-reminders", {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
  })
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("CRON_SECRET", CRON_SECRET)
  vi.useFakeTimers()
  vi.setSystemTime(now)

  vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([])
  vi.mocked(prisma.contractMilestone.updateMany).mockResolvedValue({ count: 1 })
  // Default: first call is admin/manager query → [admin-1, admin-2];
  // second call is owner validation → [owner-1] (valid same-org owner).
  // Individual tests override as needed.
  vi.mocked(prisma.user.findMany)
    .mockResolvedValueOnce([{ id: "admin-1" }, { id: "admin-2" }] as any)  // admins
    .mockResolvedValueOnce([{ id: "owner-1" }] as any)                      // owners validation
  vi.mocked(createNotification).mockResolvedValue({ id: "notif-1" } as any)
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
    expect(json.error).toMatch(/CRON_SECRET/)
  })

  it("returns 401 when secret is wrong", async () => {
    const res = await POST(makeCronReq("wrong-secret"))
    expect(res.status).toBe(401)
  })

  it("returns 200 with correct secret", async () => {
    const res = await POST(makeCronReq(CRON_SECRET))
    expect(res.status).toBe(200)
  })
})

// ─── Core logic tests ─────────────────────────────────────────────────────────

describe("reminder logic", () => {
  it("notifies owner + admins for an overdue milestone", async () => {
    const milestone = makeBaseMilestone({ ownerUserId: "owner-1", dueAt: overdueDate })
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([milestone] as any)

    const res  = await POST(makeCronReq(CRON_SECRET))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data.reminded).toBe(1)
    expect(json.data.skipped).toBe(0)

    // Admin notifications
    const calls = vi.mocked(createNotification).mock.calls
    const adminCalls  = calls.filter(([args]) => args.userId === "admin-1" || args.userId === "admin-2")
    const ownerCalls  = calls.filter(([args]) => args.userId === "owner-1")
    expect(adminCalls.length).toBeGreaterThan(0)
    expect(ownerCalls.length).toBe(1)

    // Overdue → warning type
    expect(adminCalls[0][0].type).toBe("warning")
    expect(ownerCalls[0][0].type).toBe("warning")
  })

  it("uses info type for upcoming (not yet overdue) milestone", async () => {
    const milestone = makeBaseMilestone({ dueAt: upcomingDate })
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([milestone] as any)

    const res  = await POST(makeCronReq(CRON_SECRET))
    const json = await res.json()
    expect(json.data.reminded).toBe(1)

    const calls = vi.mocked(createNotification).mock.calls
    expect(calls[0][0].type).toBe("info")
  })

  it("skips when CAS count===0 (another worker won) — no double-notify", async () => {
    const milestone = makeBaseMilestone()
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([milestone] as any)
    vi.mocked(prisma.contractMilestone.updateMany).mockResolvedValue({ count: 0 })

    const res  = await POST(makeCronReq(CRON_SECRET))
    const json = await res.json()
    expect(json.data.reminded).toBe(0)
    expect(json.data.skipped).toBe(1)
    // No notifications sent
    expect(vi.mocked(createNotification)).not.toHaveBeenCalled()
  })

  it("does not notify owner separately when owner is already in admin list", async () => {
    // owner-1 is also an admin — first call (admins), second call (owner validation → valid)
    vi.mocked(prisma.user.findMany).mockReset()
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce([{ id: "owner-1" }, { id: "admin-2" }] as any)  // admins
      .mockResolvedValueOnce([{ id: "owner-1" }] as any)                      // owner validation → valid
    const milestone = makeBaseMilestone({ ownerUserId: "owner-1" })
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([milestone] as any)

    await POST(makeCronReq(CRON_SECRET))

    const ownerCalls = vi.mocked(createNotification).mock.calls.filter(([args]) => args.userId === "owner-1")
    // owner-1 was notified via the admin loop — no separate owner notification
    expect(ownerCalls.length).toBe(1)
  })

  it("sends no notifications when findMany returns empty (nothing due)", async () => {
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([])
    const res  = await POST(makeCronReq(CRON_SECRET))
    const json = await res.json()
    expect(json.data.reminded).toBe(0)
    expect(vi.mocked(createNotification)).not.toHaveBeenCalled()
  })

  it("returns { reminded, skipped, errors, timestamp } on success", async () => {
    const res  = await POST(makeCronReq(CRON_SECRET))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveProperty("reminded")
    expect(json.data).toHaveProperty("skipped")
    expect(json.data).toHaveProperty("errors")
    expect(json.data).toHaveProperty("timestamp")
  })

  it("sets kind contract.milestone_reminder on notifications", async () => {
    const milestone = makeBaseMilestone()
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([milestone] as any)

    await POST(makeCronReq(CRON_SECRET))

    const calls = vi.mocked(createNotification).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    for (const [args] of calls) {
      expect(args.kind).toBe("contract.milestone_reminder")
    }
  })

  it("does NOT notify owner when ownerUserId is stale/foreign (not same-org active)", async () => {
    // Reset and re-setup: owner validation returns empty → stale/foreign owner
    vi.mocked(prisma.user.findMany).mockReset()
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce([{ id: "admin-1" }, { id: "admin-2" }] as any)  // admins
      .mockResolvedValueOnce([] as any)                                        // owner validation → stale/foreign
    const milestone = makeBaseMilestone({ ownerUserId: "stale-foreign-user" })
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([milestone] as any)

    const res  = await POST(makeCronReq(CRON_SECRET))
    const json = await res.json()
    expect(json.data.reminded).toBe(1)

    const calls = vi.mocked(createNotification).mock.calls
    // Admins are still notified
    const adminCalls = calls.filter(([args]) => args.userId === "admin-1" || args.userId === "admin-2")
    expect(adminCalls.length).toBeGreaterThan(0)
    // Stale owner is NOT notified
    const staleCalls = calls.filter(([args]) => args.userId === "stale-foreign-user")
    expect(staleCalls.length).toBe(0)
  })

  it("notifies a valid same-org active owner", async () => {
    // Reset and re-setup: owner-99 is valid in this org
    vi.mocked(prisma.user.findMany).mockReset()
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce([{ id: "admin-1" }] as any)    // admins
      .mockResolvedValueOnce([{ id: "owner-99" }] as any)   // owner validation → valid
    const milestone = makeBaseMilestone({ ownerUserId: "owner-99" })
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([milestone] as any)

    await POST(makeCronReq(CRON_SECRET))

    const calls = vi.mocked(createNotification).mock.calls
    const ownerCalls = calls.filter(([args]) => args.userId === "owner-99")
    // Valid same-org owner is notified exactly once
    expect(ownerCalls.length).toBe(1)
    expect(ownerCalls[0][0].organizationId).toBe(ORG)
  })
})
