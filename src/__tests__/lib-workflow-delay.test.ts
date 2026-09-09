import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Tests for delayed workflow actions (TT §9: missed-call → SMS after 2 minutes).
 *
 * Verifies:
 *   1. Actions with `delayMinutes > 0` are enqueued to scheduled_actions
 *      instead of running immediately.
 *   2. Actions without delay run synchronously as before.
 *   3. The cron runner picks up ready rows and calls the action executor.
 */

const state: {
  rules: any[]
  scheduled: any[]
  notifications: any[]
  smsCalls: any[]
} = {
  rules: [],
  scheduled: [],
  notifications: [],
  smsCalls: [],
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workflowRule: {
      findMany: vi.fn(async () => state.rules),
    },
    scheduledAction: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `sa_${state.scheduled.length + 1}`, ...data, executedAt: null, attempts: 0 }
        state.scheduled.push(row)
        return row
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return state.scheduled.filter((r: any) => {
          if (where?.executedAt === null && r.executedAt !== null) return false
          if (where?.scheduledAt?.lte && r.scheduledAt > where.scheduledAt.lte) return false
          if (where?.attempts?.lt !== undefined && r.attempts >= where.attempts.lt) return false
          return true
        })
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.scheduled.find((r: any) => r.id === where.id)
        if (row) {
          Object.assign(row, data)
          if (data.attempts?.increment) row.attempts += data.attempts.increment
        }
        return row
      }),
    },
    task: { create: vi.fn(async () => ({ id: "t1" })) },
    channelConfig: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  },
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(async (n: any) => { state.notifications.push(n) }),
}))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }))
vi.mock("@/lib/slack", () => ({ sendSlackNotification: vi.fn(), formatGenericNotification: vi.fn(() => "") }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn() }))
vi.mock("@/lib/url-validation", () => ({ isPrivateUrl: vi.fn(() => false) }))
vi.mock("@/lib/sms", () => ({
  sendSms: vi.fn(async (opts: any) => { state.smsCalls.push(opts); return { success: true, messageId: "SM_1" } }),
  isSmsConfigured: vi.fn(async () => true),
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
}))

import { executeWorkflows, runScheduledAction } from "@/lib/workflow-engine"
import { prisma } from "@/lib/prisma"

beforeEach(() => {
  state.rules = []
  state.scheduled = []
  state.notifications = []
  state.smsCalls = []
  vi.clearAllMocks()
})

describe("executeWorkflows — delayMinutes handling", () => {
  it("enqueues action with delayMinutes>0 instead of running immediately", async () => {
    state.rules = [
      {
        id: "rule_1",
        organizationId: "org_1",
        entityType: "call",
        triggerEvent: "missed",
        conditions: {},
        isActive: true,
        actions: [
          {
            actionType: "send_sms",
            actionConfig: { message: "we'll call back", delayMinutes: 2 },
            actionOrder: 0,
          },
        ],
      },
    ]

    const before = Date.now()
    await executeWorkflows("org_1", "call", "missed", {
      id: "call_1",
      fromNumber: "+994501234567",
      phone: "+994501234567",
    })

    // Not run inline
    expect(state.smsCalls).toHaveLength(0)
    // Enqueued
    expect(state.scheduled).toHaveLength(1)
    const scheduled = state.scheduled[0]
    expect(scheduled.actionType).toBe("send_sms")
    expect(scheduled.entityId).toBe("call_1")
    expect(scheduled.organizationId).toBe("org_1")

    // scheduledAt ≈ now + 2 min (within 1 sec tolerance)
    const delta = new Date(scheduled.scheduledAt).getTime() - before
    expect(delta).toBeGreaterThanOrEqual(2 * 60 * 1000 - 1000)
    expect(delta).toBeLessThanOrEqual(2 * 60 * 1000 + 1000)
  })

  it("runs action synchronously when delayMinutes is missing or zero", async () => {
    state.rules = [
      {
        id: "rule_2",
        organizationId: "org_1",
        entityType: "lead",
        triggerEvent: "created",
        conditions: {},
        isActive: true,
        actions: [
          {
            actionType: "send_sms",
            actionConfig: { message: "welcome" }, // no delayMinutes
            actionOrder: 0,
          },
          {
            actionType: "send_sms",
            actionConfig: { message: "immediate", delayMinutes: 0 },
            actionOrder: 1,
          },
        ],
      },
    ]

    await executeWorkflows("org_1", "lead", "created", { id: "l1", phone: "+15551234567" })

    expect(state.scheduled).toHaveLength(0) // nothing deferred
    expect(state.smsCalls).toHaveLength(2) // both ran
  })

  it("does not resolve until an immediate SMS send has completed", async () => {
    const { sendSms } = await import("@/lib/sms")
    state.rules = [
      {
        id: "rule_sms_wait",
        organizationId: "org_1",
        entityType: "social_mention",
        triggerEvent: "created",
        conditions: {},
        isActive: true,
        actions: [
          {
            actionType: "send_sms",
            actionConfig: { message: "new mention" },
            actionOrder: 0,
          },
        ],
      },
    ]

    let releaseSms!: () => void
    const smsPending = new Promise<void>((resolve) => {
      releaseSms = resolve
    })
    vi.mocked(sendSms).mockImplementationOnce(async (opts) => {
      state.smsCalls.push(opts)
      await smsPending
      return { success: true, messageId: "SM_WAIT" }
    })

    let settled = false
    const execution = executeWorkflows("org_1", "social_mention", "created", {
      id: "mention_1",
      phone: "+15551234567",
    }).then((result) => {
      settled = true
      return result
    })

    await vi.waitFor(() => expect(sendSms).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseSms()
    await expect(execution).resolves.toBe(1)
  })

  it("mixed: delayed action queued, non-delayed action runs immediately", async () => {
    state.rules = [
      {
        id: "rule_3",
        organizationId: "org_1",
        entityType: "call",
        triggerEvent: "missed",
        conditions: {},
        isActive: true,
        actions: [
          {
            actionType: "send_sms",
            actionConfig: { message: "delayed SMS", delayMinutes: 5 },
            actionOrder: 0,
          },
          {
            actionType: "create_task",
            actionConfig: { title: "Call back" }, // no delay
            actionOrder: 1,
          },
        ],
      },
    ]

    await executeWorkflows("org_1", "call", "missed", { id: "c1", fromNumber: "+994501234567" })

    expect(state.scheduled).toHaveLength(1)
    expect(state.scheduled[0].actionType).toBe("send_sms")
    expect((prisma.task.create as any)).toHaveBeenCalledTimes(1)
  })
})

describe("runScheduledAction — cron executor", () => {
  it("executes a queued send_sms using the same action path as the trigger", async () => {
    const { sendSms } = await import("@/lib/sms")

    await runScheduledAction(
      "org_1",
      "call",
      "send_sms",
      { message: "deferred message" },
      { id: "c1", phone: "+994501234567" }
    )

    expect(sendSms).toHaveBeenCalledTimes(1)
    const args = (sendSms as any).mock.calls[0][0]
    expect(args.to).toBe("+994501234567")
    expect(args.message).toContain("deferred message")
    expect(args.organizationId).toBe("org_1")
  })
})
