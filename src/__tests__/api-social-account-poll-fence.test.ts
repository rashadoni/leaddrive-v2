import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  findAccount: vi.fn(),
  withTenantFence: vi.fn(),
  pollFacebookAccount: vi.fn(),
  pollInstagramAccount: vi.fn(),
  pollTwitterAccount: vi.fn(),
  pollTikTokAccount: vi.fn(),
  pollYouTubeAccount: vi.fn(),
  pollVkAccount: vi.fn(),
  scanTelegramForOrg: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (
    _module: string,
    _action: string,
    handler: (
      req: NextRequest,
      auth: { orgId: string },
      context: { params: Promise<{ id: string }> },
    ) => unknown,
  ) => (
    req: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => handler(req, { orgId: "org-1" }, context),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialAccount: { findFirst: mocks.findAccount },
  },
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
vi.mock("@/lib/social/tiktok-poller", () => ({
  pollTikTokAccount: mocks.pollTikTokAccount,
}))
vi.mock("@/lib/social/youtube-poller", () => ({
  pollYouTubeAccount: mocks.pollYouTubeAccount,
}))
vi.mock("@/lib/social/vk-poller", () => ({
  pollVkAccount: mocks.pollVkAccount,
}))
vi.mock("@/lib/social/telegram-scanner", () => ({
  scanTelegramForOrg: mocks.scanTelegramForOrg,
}))

import { POST } from "@/app/api/v1/social/accounts/[id]/poll/route"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findAccount.mockResolvedValue({
    id: "facebook-1",
    organizationId: "org-1",
    platform: "facebook",
  })
  mocks.withTenantFence.mockResolvedValue({
    allowed: false,
    reason: "social_monitoring_collection_blocked",
  })
})

describe("POST /api/v1/social/accounts/[id]/poll clean-slate fence", () => {
  it("does not start a manual connected-account poll while collection is blocked", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/v1/social/accounts/facebook-1/poll", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "facebook-1" }) },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      success: false,
      error: "social_monitoring_collection_blocked",
    })
    expect(mocks.withTenantFence).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(mocks.pollFacebookAccount).not.toHaveBeenCalled()
    expect(mocks.pollInstagramAccount).not.toHaveBeenCalled()
  })
})
