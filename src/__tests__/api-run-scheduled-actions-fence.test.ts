import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  runScheduledAction: vi.fn(),
  withTenantCollectionFence: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    scheduledAction: {
      findMany: mocks.findMany,
      update: mocks.update,
    },
  },
}))
vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: vi.fn(() => null) }))
vi.mock("@/lib/workflow-engine", () => ({ runScheduledAction: mocks.runScheduledAction }))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: vi.fn(async (callback: () => Promise<unknown>) => callback()),
}))
vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: mocks.withTenantCollectionFence,
}))

import { NextRequest } from "next/server"
import { POST } from "@/app/api/cron/run-scheduled-actions/route"

function scheduledRow(entityType: string) {
  return {
    id: "scheduled-1",
    organizationId: "org-1",
    ruleId: "rule-1",
    entityType,
    entityId: "entity-1",
    entitySnapshot: { id: "entity-1", phone: "+15551234567" },
    actionType: "send_sms",
    actionConfig: { message: "hello" },
    scheduledAt: new Date("2026-07-28T10:00:00.000Z"),
    executedAt: null,
    error: null,
    attempts: 0,
    createdAt: new Date("2026-07-28T09:00:00.000Z"),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.update.mockResolvedValue({})
  mocks.runScheduledAction.mockResolvedValue(undefined)
  mocks.withTenantCollectionFence.mockImplementation(async (
    _organizationId: string,
    collect: () => Promise<unknown>,
  ) => ({ allowed: true, value: await collect() }))
})

describe("run-scheduled-actions social collection fence", () => {
  it("leaves a blocked social_mention row completely unmutated", async () => {
    mocks.findMany.mockResolvedValue([scheduledRow("social_mention")])
    mocks.withTenantCollectionFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    const response = await POST(new NextRequest("https://crm.test/api/cron/run-scheduled-actions"))

    await expect(response.json()).resolves.toEqual({
      success: true,
      picked: 1,
      executed: 0,
      failed: 0,
      blocked: 1,
    })
    expect(mocks.withTenantCollectionFence).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(mocks.runScheduledAction).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("keeps non-social scheduled actions on the existing execution path", async () => {
    mocks.findMany.mockResolvedValue([scheduledRow("deal")])

    const response = await POST(new NextRequest("https://crm.test/api/cron/run-scheduled-actions"))

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      picked: 1,
      executed: 1,
      failed: 0,
      blocked: 0,
    })
    expect(mocks.withTenantCollectionFence).not.toHaveBeenCalled()
    expect(mocks.runScheduledAction).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "scheduled-1" },
      data: {
        executedAt: expect.any(Date),
        attempts: { increment: 1 },
      },
    })
  })
})
