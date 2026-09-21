export type TwoFactorMethod = "totp" | "sms" | null

export type TwoFactorState = {
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

export type TwoFactorAdminStatus = {
  /** The stored per-user policy: the position of the "Require 2FA" switch. */
  required: boolean
  /** A factor that counts at sign-in is set up (TOTP, or SMS with a verified phone). */
  configured: boolean
  /** Required but nothing set up yet: the user must set a factor up at the next sign-in. */
  setupPending: boolean
}

/**
 * How an administrator reads one account's 2FA in Settings → Users: two
 * independent facts. A factor the user set up on their own does not make 2FA
 * mandatory, and only the stored requirement satisfies policies that demand
 * mandatory MFA (the Workforce reopen/undo actions among them).
 */
export function twoFactorAdminStatus(state: TwoFactorState): TwoFactorAdminStatus {
  return {
    required: state.require2fa,
    configured: resolveTwoFactorMethod(state) !== null,
    setupPending: requiresTwoFactorSetup(state),
  }
}

/**
 * The update the "Require 2FA" switch saves: the opposite of the stored
 * requirement, whatever factors are enrolled.
 */
export function requireTwoFactorToggleUpdate(state: Pick<TwoFactorState, "require2fa">): { require2fa: boolean } {
  return { require2fa: !state.require2fa }
}
