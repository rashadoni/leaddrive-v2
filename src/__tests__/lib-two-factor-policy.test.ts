import { describe, expect, it } from "vitest"

import {
  requireTwoFactorToggleUpdate,
  requiresTwoFactorSetup,
  resolveTwoFactorMethod,
  twoFactorAdminStatus,
} from "@/lib/two-factor-policy"

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

describe("two-factor status an administrator reads in Settings → Users", () => {
  it("keeps the requirement and an enrolled factor independent", () => {
    expect(twoFactorAdminStatus({ ...BASE, totpEnabled: true })).toEqual({
      required: false,
      configured: true,
      setupPending: false,
    })
    expect(twoFactorAdminStatus({ ...BASE, require2fa: true, totpEnabled: true })).toEqual({
      required: true,
      configured: true,
      setupPending: false,
    })
    expect(twoFactorAdminStatus({ ...BASE, require2fa: true })).toEqual({
      required: true,
      configured: false,
      setupPending: true,
    })
    expect(twoFactorAdminStatus(BASE)).toEqual({ required: false, configured: false, setupPending: false })
  })

  it("counts SMS as configured only with a verified phone", () => {
    expect(twoFactorAdminStatus({ ...BASE, smsAuthEnabled: true }).configured).toBe(false)
    expect(twoFactorAdminStatus({ ...BASE, smsAuthEnabled: true, verifiedPhone: "+994000000000" }).configured).toBe(true)
  })

  it("saves the opposite of the stored requirement, whatever factors are enrolled", () => {
    // Prod bug: the switch showed "required OR enrolled" and saved its opposite,
    // so for an enrolled user every click saved false.
    expect(requireTwoFactorToggleUpdate({ ...BASE, totpEnabled: true })).toEqual({ require2fa: true })
    expect(requireTwoFactorToggleUpdate({ ...BASE, smsAuthEnabled: true, verifiedPhone: "+994000000000" })).toEqual({ require2fa: true })
    expect(requireTwoFactorToggleUpdate({ ...BASE, require2fa: true, totpEnabled: true })).toEqual({ require2fa: false })
    expect(requireTwoFactorToggleUpdate(BASE)).toEqual({ require2fa: true })
    expect(requireTwoFactorToggleUpdate({ ...BASE, require2fa: true })).toEqual({ require2fa: false })
  })
})
