import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`)
  }),
  entitlement: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/ai/support-settings-access", () => ({
  isSupportAiSettingsRole: vi.fn((role: string) => role === "admin" || role === "superadmin"),
  hasSupportAiSettingsEntitlement: mocks.entitlement,
}))
vi.mock("@/app/(dashboard)/support/ai-settings/support-ai-settings-client", () => ({
  SupportAiSettingsClient: () => null,
}))

import SupportAiSettingsPage from "@/app/(dashboard)/support/ai-settings/page"

describe("Support AI settings direct-route gate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.entitlement.mockResolvedValue(true)
    mocks.auth.mockResolvedValue({
      user: { id: "user-1", organizationId: "org-1", role: "admin" },
    })
  })

  it("redirects an anonymous request before rendering", async () => {
    mocks.auth.mockResolvedValue(null)

    await expect(SupportAiSettingsPage()).rejects.toThrow("redirect:/login")
  })

  it("redirects a non-admin request before rendering", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "user-2", organizationId: "org-1", role: "manager" },
    })

    await expect(SupportAiSettingsPage()).rejects.toThrow("redirect:/dashboard")
    expect(mocks.entitlement).not.toHaveBeenCalled()
  })

  it("redirects an unlicensed administrator", async () => {
    mocks.entitlement.mockResolvedValue(false)

    await expect(SupportAiSettingsPage()).rejects.toThrow("redirect:/dashboard")
  })

  it("renders for an authorized, licensed administrator", async () => {
    await expect(SupportAiSettingsPage()).resolves.toBeTruthy()
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.entitlement).toHaveBeenCalledWith("org-1")
  })
})
