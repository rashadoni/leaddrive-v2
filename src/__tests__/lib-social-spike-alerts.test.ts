import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findOrganizations: vi.fn(),
  countMentions: vi.fn(),
  findAudit: vi.fn(),
  createAudit: vi.fn(),
  findUsers: vi.fn(),
  createNotification: vi.fn(),
  withTenantFence: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findMany: mocks.findOrganizations },
    socialMention: { count: mocks.countMentions },
    auditLog: { findFirst: mocks.findAudit, create: mocks.createAudit },
    user: { findMany: mocks.findUsers },
  },
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: mocks.createNotification,
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: mocks.withTenantFence,
}))

import { detectNegativeSpikes } from "@/lib/social/spike-alerts"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.withTenantFence.mockImplementation(async (
    _organizationId: string,
    collect: () => Promise<unknown>,
  ) => ({ allowed: true as const, value: await collect() }))
  mocks.findOrganizations.mockResolvedValue([
    { id: "org-1", settings: { socialSpike: { minAbsolute: 5, multiplier: 3 } } },
  ])
  mocks.countMentions
    .mockResolvedValueOnce(5)
    .mockResolvedValueOnce(1)
  mocks.findAudit.mockResolvedValue({ id: "already-alerted" })
  mocks.createAudit.mockResolvedValue({ id: "marker" })
  mocks.findUsers.mockResolvedValue([])
  mocks.createNotification.mockResolvedValue(undefined)
})

describe("negative social spike visibility", () => {
  it("does not count purged or source-deleted mentions", async () => {
    await detectNegativeSpikes("org-1")

    expect(mocks.countMentions).toHaveBeenCalledTimes(2)
    for (const [args] of mocks.countMentions.mock.calls) {
      expect(args).toEqual({
        where: expect.objectContaining({
          organizationId: "org-1",
          purgedAt: null,
          deletedAtSource: null,
        }),
      })
    }
  })

  it("does not read findings or emit alerts while the tenant fence is closed", async () => {
    mocks.withTenantFence.mockResolvedValue({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    const result = await detectNegativeSpikes("org-1")

    expect(result).toEqual([])
    expect(mocks.withTenantFence).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(mocks.countMentions).not.toHaveBeenCalled()
    expect(mocks.findAudit).not.toHaveBeenCalled()
    expect(mocks.createAudit).not.toHaveBeenCalled()
    expect(mocks.findUsers).not.toHaveBeenCalled()
    expect(mocks.createNotification).not.toHaveBeenCalled()
  })

  it("does not notify when the hourly dedupe marker cannot be persisted", async () => {
    mocks.findAudit.mockResolvedValue(null)
    mocks.createAudit.mockRejectedValue(new Error("audit unavailable"))

    const result = await detectNegativeSpikes("org-1")

    expect(result).toEqual([])
    expect(mocks.createAudit).toHaveBeenCalledTimes(1)
    expect(mocks.findUsers).not.toHaveBeenCalled()
    expect(mocks.createNotification).not.toHaveBeenCalled()
  })
})
