export type TwoFactorMethod = "totp" | "sms" | null

type TwoFactorState = {
  require2fa: boolean
  totpEnabled: boolean
  smsAuthEnabled: boolean
  verifiedPhone: string | null
}

export function resolveTwoFactorMethod(state: TwoFactorState): TwoFactorMethod {
  if (state.totpEnabled) return "totp"
  if (state.smsAuthEnabled && state.verifiedPhone) return "sms"
  return null
}

/**
 * Mandatory setup is an explicit per-user policy. Roles never opt a user into
 * MFA implicitly; administrators can require it through the existing Users UI.
 * A factor that a user enrolled voluntarily remains active and is still
 * challenged at sign-in.
 */
export function requiresTwoFactorSetup(state: TwoFactorState): boolean {
  return state.require2fa && resolveTwoFactorMethod(state) === null
}
