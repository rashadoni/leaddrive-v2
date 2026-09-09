import { describe, expect, it } from "vitest"

import { requiresTwoFactorSetup, resolveTwoFactorMethod } from "@/lib/two-factor-policy"

const BASE = {
  require2fa: false,
  totpEnabled: false,
  smsAuthEnabled: false,
  verifiedPhone: null,
}

describe("two-factor policy", () => {
  it("does not require setup unless the per-user policy is enabled", () => {
    expect(requiresTwoFactorSetup(BASE)).toBe(false)
    expect(requiresTwoFactorSetup({ ...BASE, require2fa: true })).toBe(true)
  })

  it("keeps a voluntarily enrolled TOTP factor active without requiring setup", () => {
    const state = { ...BASE, totpEnabled: true }

    expect(resolveTwoFactorMethod(state)).toBe("totp")
    expect(requiresTwoFactorSetup(state)).toBe(false)
    expect(requiresTwoFactorSetup({ ...state, require2fa: true })).toBe(false)
  })

  it("uses SMS only when the enabled factor has a verified phone", () => {
    expect(resolveTwoFactorMethod({ ...BASE, smsAuthEnabled: true })).toBeNull()
    expect(resolveTwoFactorMethod({
      ...BASE,
      smsAuthEnabled: true,
      verifiedPhone: "+994000000000",
    })).toBe("sms")
    expect(requiresTwoFactorSetup({
      ...BASE,
      require2fa: true,
      smsAuthEnabled: true,
      verifiedPhone: "+994000000000",
    })).toBe(false)
  })

  it("prefers TOTP when both usable methods are enabled", () => {
    expect(resolveTwoFactorMethod({
      ...BASE,
      totpEnabled: true,
      smsAuthEnabled: true,
      verifiedPhone: "+994000000000",
    })).toBe("totp")
  })
})
