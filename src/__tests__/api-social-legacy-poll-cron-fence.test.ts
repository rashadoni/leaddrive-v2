import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  findAccountOrganizations: vi.fn(),
  runWithRlsBypass: vi.fn((fn: () => unknown) => fn()),
  requireCronAuth: vi.fn(),
  withTenantFence: vi.fn(),
  pollAllTwitter: vi.fn(),
  pollAllTikTok: vi.fn(),
  pollAllYouTube: vi.fn(),
  pollAllVk: vi.fn(),
  scanTelegramForOrg: vi.fn(),
  detectNegativeSpikes: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialAccount: { findMany: mocks.findAccountOrganizations },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: mocks.runWithRlsBypass,
}))
vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: mocks.requireCronAuth,
}))
vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: mocks.withTenantFence,
}))
vi.mock("@/lib/social/twitter-poller", () => ({
  pollAllTwitter: mocks.pollAllTwitter,
}))
vi.mock("@/lib/social/tiktok-poller", () => ({
  pollAllTikTok: mocks.pollAllTikTok,
}))
vi.mock("@/lib/social/youtube-poller", () => ({
  pollAllYouTube: mocks.pollAllYouTube,
}))
vi.mock("@/lib/social/vk-poller", () => ({
  pollAllVk: mocks.pollAllVk,
}))
vi.mock("@/lib/social/telegram-scanner", () => ({
  scanTelegramForOrg: mocks.scanTelegramForOrg,
}))
vi.mock("@/lib/social/spike-alerts", () => ({
  detectNegativeSpikes: mocks.detectNegativeSpikes,
}))

import { POST } from "@/app/api/cron/social-poll/route"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireCronAuth.mockReturnValue(null)
  mocks.findAccountOrganizations.mockResolvedValue([{
    organizationId: "org-blocked",
    platform: "facebook",
  }])
  mocks.withTenantFence.mockResolvedValue({
    allowed: false,
    reason: "social_monitoring_collection_blocked",
  })
  mocks.detectNegativeSpikes.mockResolvedValue([])
})

describe("POST /api/cron/social-poll clean-slate fence", () => {
  it("does not start any legacy platform poller for a blocked tenant", async () => {
    const response = await POST(new NextRequest("http://localhost/api/cron/social-poll", {
      method: "POST",
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.runWithRlsBypass).toHaveBeenCalledOnce()
    expect(mocks.withTenantFence).toHaveBeenCalledWith("org-blocked", expect.any(Function))
    expect(mocks.pollAllTwitter).not.toHaveBeenCalled()
    expect(mocks.pollAllTikTok).not.toHaveBeenCalled()
    expect(mocks.pollAllYouTube).not.toHaveBeenCalled()
    expect(mocks.pollAllVk).not.toHaveBeenCalled()
    expect(mocks.scanTelegramForOrg).not.toHaveBeenCalled()
    expect(body.data).toMatchObject({
      twitter: { total: 0, accounts: 0 },
      tiktok: { total: 0, accounts: 0 },
      youtube: { total: 0, accounts: 0 },
      vk: { total: 0, accounts: 0 },
      telegram: { total: 0, orgs: 0 },
      blockedOrganizations: ["org-blocked"],
    })
  })

  it("counts and scans only organizations with an active Telegram account", async () => {
    mocks.findAccountOrganizations.mockResolvedValue([
      { organizationId: "org-facebook", platform: "facebook" },
      { organizationId: "org-telegram", platform: "telegram" },
    ])
    mocks.withTenantFence.mockImplementation(async (
      _organizationId: string,
      collect: () => Promise<unknown>,
    ) => ({ allowed: true, value: await collect() }))
    mocks.pollAllTwitter.mockResolvedValue({ total: 0, perAccount: [] })
    mocks.pollAllTikTok.mockResolvedValue({ total: 0, accounts: 0 })
    mocks.pollAllYouTube.mockResolvedValue({ total: 0, accounts: 0 })
    mocks.pollAllVk.mockResolvedValue({ total: 0, accounts: 0 })
    mocks.scanTelegramForOrg.mockResolvedValue({ ingested: 3 })

    const response = await POST(new NextRequest("http://localhost/api/cron/social-poll", {
      method: "POST",
    }))
    const body = await response.json()

    expect(mocks.withTenantFence).toHaveBeenCalledTimes(2)
    expect(mocks.scanTelegramForOrg).toHaveBeenCalledOnce()
    expect(mocks.scanTelegramForOrg).toHaveBeenCalledWith("org-telegram")
    expect(body.data.telegram).toEqual({ total: 3, orgs: 1 })
  })
})
