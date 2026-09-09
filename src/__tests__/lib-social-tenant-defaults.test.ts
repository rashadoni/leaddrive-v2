import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  platformAvailable: vi.fn(),
  getPolicy: vi.fn(),
  updatePolicy: vi.fn(),
}))

vi.mock("@/lib/social/monitoring-settings", () => ({
  getSocialMonitoringSettings: mocks.getSettings,
  saveSocialMonitoringSettings: mocks.saveSettings,
  platformApifyTokenAvailable: mocks.platformAvailable,
}))
vi.mock("@/lib/social/media-observations", () => ({
  getOrCreateMediaPolicy: mocks.getPolicy,
  updateMediaPolicy: mocks.updatePolicy,
}))

import { ensureSocialMonitoringTenantDefaults } from "@/lib/social/tenant-defaults"

function settings(overrides: Record<string, unknown> = {}) {
  return { searchIndex: { enabled: false, hasToken: false, provider: "apify", ...overrides } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSettings.mockResolvedValue(settings())
  mocks.saveSettings.mockResolvedValue({})
  mocks.platformAvailable.mockReturnValue(false)
  mocks.getPolicy.mockResolvedValue({ enabled: false, policyVersion: 1 })
  mocks.updatePolicy.mockResolvedValue({})
})

describe("ensureSocialMonitoringTenantDefaults — новый тенант работает из коробки", () => {
  it("включает searchIndex при платформенном токене и штампует медиа-политику", async () => {
    mocks.platformAvailable.mockReturnValue(true)
    const result = await ensureSocialMonitoringTenantDefaults("org-new")
    expect(result).toEqual({ searchIndexEnabled: true, mediaPolicyStamped: true })
    expect(mocks.saveSettings).toHaveBeenCalledWith("org-new", { searchIndex: { enabled: true, provider: "apify" } })
    expect(mocks.updatePolicy).toHaveBeenCalledWith("org-new", undefined, expect.objectContaining({
      enabled: true, coverOcrEnabled: true, preferPlatformTranscript: true,
      dailyBudgetUsd: 1, monthlyBudgetUsd: 20, perObservationBudgetUsd: 0.05,
    }))
  })

  it("без токена searchIndex НЕ включается — пробел остаётся видимым", async () => {
    const result = await ensureSocialMonitoringTenantDefaults("org-new")
    expect(result.searchIndexEnabled).toBe(false)
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it("идемпотентно: уже включённый searchIndex и трогнутая политика не перезаписываются", async () => {
    mocks.getSettings.mockResolvedValue(settings({ enabled: true, hasToken: true }))
    mocks.getPolicy.mockResolvedValue({ enabled: false, policyVersion: 4 })
    const result = await ensureSocialMonitoringTenantDefaults("org-old")
    expect(result).toEqual({ searchIndexEnabled: false, mediaPolicyStamped: false })
    expect(mocks.saveSettings).not.toHaveBeenCalled()
    expect(mocks.updatePolicy).not.toHaveBeenCalled()
  })

  it("явное выключение политики оператором (policyVersion > 1) уважается", async () => {
    mocks.platformAvailable.mockReturnValue(true)
    mocks.getPolicy.mockResolvedValue({ enabled: false, policyVersion: 2 })
    const result = await ensureSocialMonitoringTenantDefaults("org-optout")
    expect(result.mediaPolicyStamped).toBe(false)
    expect(mocks.updatePolicy).not.toHaveBeenCalled()
  })
})
