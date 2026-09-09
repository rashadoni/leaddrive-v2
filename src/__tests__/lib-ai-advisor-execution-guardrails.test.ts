import { beforeEach, describe, expect, it, vi } from "vitest"

const db = {
  organizationFindUnique: vi.fn(),
  aiShadowActionCount: vi.fn(),
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: (...args: unknown[]) => db.organizationFindUnique(...args),
    },
    aiShadowAction: {
      count: (...args: unknown[]) => db.aiShadowActionCount(...args),
    },
  },
}))

import {
  advisorExecutionDayStart,
  advisorExecutionKillSwitch,
  evaluateAdvisorExecutionGuardrails,
  parseAdvisorExecutionSettings,
} from "@/lib/ai/advisor/execution-guardrails"

beforeEach(() => {
  vi.clearAllMocks()
  db.organizationFindUnique.mockResolvedValue({ settings: {} })
  db.aiShadowActionCount.mockResolvedValue(0)
})

describe("Advisor execution guardrails", () => {
  it("parses tenant execution settings with safe defaults", () => {
    expect(parseAdvisorExecutionSettings({})).toEqual({
      executionEnabled: true,
      dailyLimit: 100,
      actionTypeDailyLimit: 25,
    })
    expect(parseAdvisorExecutionSettings({
      aiAdvisorExecutionEnabled: false,
      aiAdvisorExecutionDailyLimit: 7,
      aiAdvisorActionTypeDailyLimit: 3,
    })).toEqual({
      executionEnabled: false,
      dailyLimit: 7,
      actionTypeDailyLimit: 3,
    })
  })

  it("detects global execution kill switches before database checks", async () => {
    expect(advisorExecutionKillSwitch({ LEADDRIVE_ADVISOR_EXECUTION_DISABLED: "1" })).toBe("LEADDRIVE_ADVISOR_EXECUTION_DISABLED")
    await expect(evaluateAdvisorExecutionGuardrails({
      organizationId: "org-1",
      actionType: "create_task",
    }, new Date("2026-06-27T12:00:00.000Z"), { ADVISOR_EXECUTION_DISABLED: "1" })).resolves.toMatchObject({
      allowed: false,
      code: "global_disabled",
    })
    expect(db.organizationFindUnique).not.toHaveBeenCalled()
  })

  it("blocks execution when tenant settings disable Advisor execution", async () => {
    db.organizationFindUnique.mockResolvedValue({ settings: { aiAdvisorExecutionDisabled: true } })

    await expect(evaluateAdvisorExecutionGuardrails({
      organizationId: "org-1",
      actionType: "create_task",
    }, new Date("2026-06-27T12:00:00.000Z"), {})).resolves.toMatchObject({
      allowed: false,
      code: "tenant_disabled",
      settings: expect.objectContaining({ executionEnabled: false }),
    })
    expect(db.aiShadowActionCount).not.toHaveBeenCalled()
  })

  it("blocks execution when the tenant daily cap is exhausted", async () => {
    db.organizationFindUnique.mockResolvedValue({ settings: { aiAdvisorExecutionDailyLimit: 2, aiAdvisorActionTypeDailyLimit: 10 } })
    db.aiShadowActionCount
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)

    await expect(evaluateAdvisorExecutionGuardrails({
      organizationId: "org-1",
      actionType: "create_task",
    }, new Date("2026-06-27T12:00:00.000Z"), {})).resolves.toMatchObject({
      allowed: false,
      code: "daily_limit",
      limit: 2,
      used: 2,
    })
  })

  it("blocks execution when the action-type daily cap is exhausted", async () => {
    db.organizationFindUnique.mockResolvedValue({ settings: { aiAdvisorExecutionDailyLimit: 10, aiAdvisorActionTypeDailyLimit: 1 } })
    db.aiShadowActionCount
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)

    await expect(evaluateAdvisorExecutionGuardrails({
      organizationId: "org-1",
      actionType: "create_alert",
    }, new Date("2026-06-27T12:00:00.000Z"), {})).resolves.toMatchObject({
      allowed: false,
      code: "action_type_daily_limit",
      limit: 1,
      used: 1,
    })
  })

  it("allows execution while exposing volume counters", async () => {
    db.organizationFindUnique.mockResolvedValue({ settings: { aiAdvisorExecutionDailyLimit: 10, aiAdvisorActionTypeDailyLimit: 5 } })
    db.aiShadowActionCount
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)

    await expect(evaluateAdvisorExecutionGuardrails({
      organizationId: "org-1",
      actionType: "create_note",
    }, new Date("2026-06-27T12:00:00.000Z"), {})).resolves.toMatchObject({
      allowed: true,
      dailyUsed: 3,
      actionTypeDailyUsed: 2,
    })
    expect(db.aiShadowActionCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org-1",
        actionType: "create_note",
      }),
    })
  })

  it("uses UTC day boundaries for execution counters", () => {
    expect(advisorExecutionDayStart(new Date("2026-06-27T23:59:59.000Z")).toISOString()).toBe("2026-06-27T00:00:00.000Z")
  })
})
