import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  accounts: [] as Array<{
    id: string
    organizationId: string
    platform: string
    accessToken: string | null
  }>,
  findManyAccounts: vi.fn(),
  countMentions: vi.fn(),
  findManyUsers: vi.fn(),
  runWithRlsBypass: vi.fn((fn: () => Promise<Response>) => fn()),
  requireCronAuth: vi.fn(),
  withJobLease: vi.fn(async (
    _options: unknown,
    job: () => Promise<Response>,
  ) => ({ status: "completed" as const, value: await job() })),
  withTenantFence: vi.fn(),
  pollFacebookAccount: vi.fn(),
  pollInstagramAccount: vi.fn(),
  pollTwitterAccount: vi.fn(),
  pollVkAccount: vi.fn(),
  pollYouTubeAccount: vi.fn(),
  pollTikTokAccount: vi.fn(),
  scanTelegramForOrg: vi.fn(),
  sendPushToUser: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialAccount: { findMany: mocks.findManyAccounts },
    socialMention: { count: mocks.countMentions },
    user: { findMany: mocks.findManyUsers },
  },
}))

vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: mocks.runWithRlsBypass,
}))

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: mocks.requireCronAuth,
}))

vi.mock("@/lib/cron/job-lease", () => ({
  withJobLease: mocks.withJobLease,
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: mocks.withTenantFence,
}))

vi.mock("@/lib/social/facebook-poller", () => ({
  pollFacebookAccount: mocks.pollFacebookAccount,
  pollInstagramAccount: mocks.pollInstagramAccount,
}))

vi.mock("@/lib/social/twitter-poller", () => ({
  pollTwitterAccount: mocks.pollTwitterAccount,
}))

vi.mock("@/lib/social/vk-poller", () => ({
  pollVkAccount: mocks.pollVkAccount,
}))

vi.mock("@/lib/social/youtube-poller", () => ({
  pollYouTubeAccount: mocks.pollYouTubeAccount,
}))

vi.mock("@/lib/social/tiktok-poller", () => ({
  pollTikTokAccount: mocks.pollTikTokAccount,
}))

vi.mock("@/lib/social/telegram-scanner", () => ({
  scanTelegramForOrg: mocks.scanTelegramForOrg,
}))

vi.mock("@/lib/push-send", () => ({
  sendPushToUser: mocks.sendPushToUser,
}))

import { POST } from "@/app/api/v1/social/cron/poll-all/route"

function request() {
  return new NextRequest("http://localhost/api/v1/social/cron/poll-all", {
    method: "POST",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findManyAccounts.mockImplementation(async () => mocks.accounts)
  mocks.countMentions.mockResolvedValue(0)
  mocks.findManyUsers.mockResolvedValue([])
  mocks.requireCronAuth.mockReturnValue(null)
  mocks.withTenantFence.mockImplementation(async (
    _organizationId: string,
    collect: () => Promise<unknown>,
  ) => ({ allowed: true as const, value: await collect() }))
  mocks.pollFacebookAccount.mockResolvedValue({ ingested: 0 })
  mocks.pollInstagramAccount.mockResolvedValue({ ingested: 0 })
})

describe("POST /api/v1/social/cron/poll-all", () => {
  it("does not poll or persist connected Facebook and Instagram accounts while the clean-slate fence is closed", async () => {
    mocks.accounts = [
      { id: "facebook-1", organizationId: "org-blocked", platform: "facebook", accessToken: "encrypted" },
      { id: "instagram-1", organizationId: "org-blocked", platform: "instagram", accessToken: "encrypted" },
    ]
    mocks.withTenantFence.mockResolvedValue({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.withTenantFence).toHaveBeenCalledTimes(2)
    expect(mocks.withTenantFence).toHaveBeenNthCalledWith(
      1,
      "org-blocked",
      expect.any(Function),
    )
    expect(mocks.withTenantFence).toHaveBeenNthCalledWith(
      2,
      "org-blocked",
      expect.any(Function),
    )
    expect(mocks.pollFacebookAccount).not.toHaveBeenCalled()
    expect(mocks.pollInstagramAccount).not.toHaveBeenCalled()
    expect(mocks.countMentions).not.toHaveBeenCalled()
    expect(body.data).toMatchObject({
      pollerCount: 2,
      ingestedTotal: 0,
      spikes: [],
      polled: [
        {
          id: "facebook-1",
          platform: "facebook",
          ingested: 0,
          error: "social_monitoring_collection_blocked",
        },
        {
          id: "instagram-1",
          platform: "instagram",
          ingested: 0,
          error: "social_monitoring_collection_blocked",
        },
      ],
    })
  })

  it("runs native polling inside the tenant fence when collection is allowed", async () => {
    mocks.accounts = [
      { id: "facebook-1", organizationId: "org-allowed", platform: "facebook", accessToken: "encrypted" },
    ]
    mocks.pollFacebookAccount.mockResolvedValue({ ingested: 1 })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.pollFacebookAccount).toHaveBeenCalledWith("facebook-1")
    expect(mocks.withTenantFence.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.pollFacebookAccount.mock.invocationCallOrder[0])
    expect(body.data.ingestedTotal).toBe(1)
    expect(mocks.countMentions).toHaveBeenCalledTimes(2)
  })

  it("does not read or send spike alerts when reset closes the second tenant fence", async () => {
    mocks.accounts = [
      { id: "facebook-1", organizationId: "org-reset", platform: "facebook", accessToken: "encrypted" },
    ]
    mocks.pollFacebookAccount.mockResolvedValue({ ingested: 1 })
    mocks.withTenantFence
      .mockImplementationOnce(async (
        _organizationId: string,
        collect: () => Promise<unknown>,
      ) => ({ allowed: true as const, value: await collect() }))
      .mockResolvedValueOnce({
        allowed: false,
        reason: "social_monitoring_collection_blocked",
      })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.pollFacebookAccount).toHaveBeenCalledWith("facebook-1")
    expect(mocks.withTenantFence).toHaveBeenCalledTimes(2)
    expect(mocks.withTenantFence).toHaveBeenNthCalledWith(2, "org-reset", expect.any(Function))
    expect(mocks.countMentions).not.toHaveBeenCalled()
    expect(mocks.findManyUsers).not.toHaveBeenCalled()
    expect(mocks.sendPushToUser).not.toHaveBeenCalled()
    expect(body.data.spikes).toEqual([])
  })
})
