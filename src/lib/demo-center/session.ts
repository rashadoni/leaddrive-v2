export type DemoGrantLifecycle =
  | "ISSUING"
  | "SENT"
  | "OTP_SENT"
  | "OTP_VERIFIED"
  | "ACTIVE"
  | "COMPLETED"
  | "EXPIRED"
  | "REVOKED"
  | "DELIVERY_FAILED"

export type DemoAccessState =
  /** The emailed link is open and the address is not confirmed in this browser yet. */
  | "ready"
  | "verified"
  | "active"
  | "active_elsewhere"
  | "completed"
  | "expired"
  | "revoked"
  | "unavailable"

export interface DemoGrantTimeState {
  status: string
  linkExpiresAt: Date
  verificationExpiresAt: Date | null
  sessionStartedAt: Date | null
  sessionLastSeenAt: Date | null
  sessionExpiresAt: Date | null
  inactivityMinutes: number
}

export function isTerminalDemoStatus(status: string): boolean {
  return status === "COMPLETED" || status === "EXPIRED" || status === "REVOKED"
}

export function isSessionExpired(grant: DemoGrantTimeState, now = new Date()): boolean {
  if (!grant.sessionStartedAt) return false
  if (!grant.sessionExpiresAt || grant.sessionExpiresAt <= now) return true
  if (!grant.sessionLastSeenAt) return true
  const idleDeadline = grant.sessionLastSeenAt.getTime() + grant.inactivityMinutes * 60_000
  return idleDeadline <= now.getTime()
}

export function shouldExpireGrant(grant: DemoGrantTimeState, now = new Date()): boolean {
  if (isTerminalDemoStatus(grant.status)) return false
  if (grant.sessionStartedAt) return isSessionExpired(grant, now)
  return grant.linkExpiresAt <= now
}

export function publicAccessState(
  grant: DemoGrantTimeState,
  credentials: { verified: boolean; session: boolean },
  now = new Date(),
): DemoAccessState {
  if (grant.status === "REVOKED") return "revoked"
  if (grant.status === "COMPLETED") return "completed"
  if (grant.status === "EXPIRED" || shouldExpireGrant(grant, now)) return "expired"
  if (grant.status === "ACTIVE") return credentials.session ? "active" : "active_elsewhere"
  if (grant.status === "OTP_VERIFIED") {
    const verificationAlive = !!grant.verificationExpiresAt && grant.verificationExpiresAt > now
    return credentials.verified && verificationAlive ? "verified" : "ready"
  }
  // OTP_SENT: a code requested before the code gave way to the button
  // (2026-10-18). The button confirms such a grant like any other.
  if (grant.status === "SENT" || grant.status === "OTP_SENT") return "ready"
  return "unavailable"
}
