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
  | "ready_for_otp"
  | "otp_sent"
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
    return credentials.verified && verificationAlive ? "verified" : "ready_for_otp"
  }
  if (grant.status === "OTP_SENT") return "otp_sent"
  if (grant.status === "SENT") return "ready_for_otp"
  return "unavailable"
}
