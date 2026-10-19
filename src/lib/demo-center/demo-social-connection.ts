import { hmacToken } from "@/lib/secure-token"
import { isSessionExpired, type DemoGrantTimeState } from "./session"

/**
 * A prospect's own Facebook Page, connected to the demo for one day
 * (docs/DEMO_CENTER.md, «Live social connections»).
 *
 * One function decides whether a connection is still live:
 * `demoSocialReleaseReason`. The webhook, the send path, the demo page and the
 * release cron all ask it, so they cannot drift — and because it reads only
 * timestamps and the grant's state, use stops at the right moment even when
 * the cron does not run. A grant's expiry is lazy (`access.ts`): a closed tab
 * stays ACTIVE in the database, so the session's end is computed here from its
 * timestamps, never read from its status alone.
 */

/** Why a connection ended. The same list is the database's CHECK on `releaseReason`. */
export const DEMO_SOCIAL_RELEASE_REASONS = [
  /** The prospect pressed «Ayır». */
  "disconnected",
  /** Meta told us the person removed our app (Facebook Login's deauthorize callback). */
  "deauthorized",
  /** The grant row was deleted; the connection outlived it (ON DELETE SET NULL). */
  "grant_gone",
  /** The admin revoked the link, or re-issued it (which revokes the old one). */
  "revoked",
  /** The prospect pressed «Bitir». */
  "finished",
  /** The session ended: two hours, thirty idle minutes, or a closed tab. */
  "session_over",
  /** The connect was started and never finished. */
  "connect_abandoned",
  /** 23:59 in Baku. */
  "day_over",
] as const
export type DemoSocialReleaseReason = (typeof DEMO_SOCIAL_RELEASE_REASONS)[number]

/** A connect that has not bound a Page after this long is abandoned. */
export const DEMO_SOCIAL_CONNECT_WINDOW_MS = 30 * 60_000

export interface DemoSocialLiveness {
  releaseReason: string | null
  grantId: string | null
  /** The grant row; null when it no longer exists. */
  grant: DemoGrantTimeState | null
  connectedAt: Date | null
  createdAt: Date
  expiresAt: Date
}

function isReleaseReason(value: string): value is DemoSocialReleaseReason {
  return (DEMO_SOCIAL_RELEASE_REASONS as readonly string[]).includes(value)
}

/**
 * Null while the connection is live; otherwise why it must be released.
 * In order: a release already asked for; the grant gone; revoked; finished;
 * the session over; a connect never finished; the Baku day over.
 *
 * Release at session end, not only at midnight, is a choice: after the session
 * the prospect can no longer reach «Ayır». «Midnight only» would be dropping
 * the session_over line.
 */
export function demoSocialReleaseReason(row: DemoSocialLiveness, now: Date = new Date()): DemoSocialReleaseReason | null {
  if (row.releaseReason) return isReleaseReason(row.releaseReason) ? row.releaseReason : "disconnected"
  const grant = row.grant
  if (!row.grantId || !grant) return "grant_gone"
  if (grant.status === "REVOKED") return "revoked"
  if (grant.status === "COMPLETED") return "finished"
  // Only an ACTIVE session holds a connection; anything else — EXPIRED, or a
  // state a session never returns to — has ended it.
  if (grant.status !== "ACTIVE" || !grant.sessionStartedAt || isSessionExpired(grant, now)) return "session_over"
  if (!row.connectedAt && row.createdAt.getTime() + DEMO_SOCIAL_CONNECT_WINDOW_MS <= now.getTime()) return "connect_abandoned"
  if (row.expiresAt.getTime() <= now.getTime()) return "day_over"
  return null
}

/** The `encryptToken` purpose of one row's token: a cipher copied to another row or column does not decrypt. */
export function demoSocialTokenPurpose(connectionId: string, kind: "user" | "page"): string {
  return `demo-social:${kind}:${connectionId}`
}

/**
 * This session's code for its Page: six characters derived from the grant,
 * shown only on its own demo page. The first message to the Page carrying it
 * proves one sender. A different label from the WhatsApp thread's code, so one
 * cannot be read off the other.
 */
export function demoSocialCode(grantId: string): string {
  return `LD-${hmacToken(grantId, "demo-social-code").slice(0, 6).toUpperCase()}`
}
