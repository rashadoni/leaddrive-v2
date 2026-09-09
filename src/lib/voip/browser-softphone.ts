/**
 * The parking ticket: how a browser proves it is the one on this call.
 *
 * A browser softphone call has two halves that meet in a relay neither of them
 * trusts: the PBX dials out with the call's UUID, and the salesperson's browser
 * arrives claiming the same UUID. The relay joins whoever matches, so "whoever
 * matches" has to be unforgeable.
 *
 * The call's UUID cannot carry that weight by itself. It is already visible to
 * every user in the organisation through the ordinary call-polling endpoint, so
 * treating it as a secret would let any colleague listen to a call by quoting a
 * number they can read. The ticket is what makes the claim specific: it is
 * signed by the server, it names ONE user and ONE call, and it expires in
 * thirty seconds — long enough to open a socket, too short to be passed around.
 *
 * It is deliberately stateless. A database row would need a migration and a
 * cleanup job for a value whose whole life is half a minute.
 *
 * What the relay enforces is narrower than single use, and saying so matters:
 * it refuses a SECOND browser while one is already joined to that call, and
 * releases the claim when that browser's socket closes. So the same ticket
 * works again afterwards, and what actually bounds replay is the expiry below.
 * An earlier version of this comment claimed the relay "remembers the tickets
 * it has spent"; it does not, and a comment that overstates a defence stops the
 * next reader from adding the one that is missing.
 */

import { createHmac, timingSafeEqual } from "node:crypto"

/** Half a minute: enough to open a socket, too short to circulate. */
export const PARK_TICKET_TTL_MS = 30_000

/**
 * How long an unanswered inbound call belongs to one browser.
 *
 * Microphone permission is obtained before the claim, so this lease only has
 * to cover ticket verification and the PBX readiness poll. Keeping it short is
 * intentional: a tab can disappear between those steps, and no salesperson
 * should leave the shared queue locked behind a dead browser.
 */
export const INBOUND_BROWSER_CLAIM_LEASE_MS = 30_000

export type ParkTicketClaims = {
  callLogId: string
  userId: string
  orgId: string
  /** Present only for inbound answer tickets; immutable DB claim incarnation. */
  claimToken?: string
  /** Milliseconds since the epoch, after which the relay must refuse it. */
  expiresAt: number
}

const CLAIM_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function ticketSecret(): string | null {
  const secret = process.env.BROWSER_SOFTPHONE_TICKET_SECRET
  return secret && secret.length >= 32 ? secret : null
}

function payload(claims: ParkTicketClaims): string {
  // Fixed field order: a signature over a re-ordered payload is a different
  // signature, and JSON key order is not something to depend on.
  return [
    claims.orgId,
    claims.userId,
    claims.callLogId,
    String(claims.expiresAt),
    ...(claims.claimToken ? [claims.claimToken] : []),
  ].join(".")
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url")
}

/**
 * Mint a ticket for one user on one call, or null when the deployment has no
 * signing secret — in which case the feature must stay off rather than fall
 * back to something weaker.
 */
export function issueParkTicket(
  claims: Omit<ParkTicketClaims, "expiresAt">,
  now: number = Date.now(),
): string | null {
  const secret = ticketSecret()
  if (!secret) return null
  const full: ParkTicketClaims = { ...claims, expiresAt: now + PARK_TICKET_TTL_MS }
  const body = payload(full)
  return `${Buffer.from(body).toString("base64url")}.${sign(body, secret)}`
}

/**
 * Read a ticket back, or null if it is malformed, mis-signed or expired.
 *
 * Returning null for every failure is deliberate: the relay has nothing useful
 * to do with the difference between "wrong signature" and "expired", and an
 * error that distinguishes them tells an attacker which half to work on.
 */
export function readParkTicket(ticket: unknown, now: number = Date.now()): ParkTicketClaims | null {
  const secret = ticketSecret()
  if (!secret || typeof ticket !== "string") return null
  const ticketParts = ticket.split(".")
  if (ticketParts.length !== 2) return null
  const [encoded, signature] = ticketParts
  if (!encoded || !signature) return null

  let body: string
  try {
    body = Buffer.from(encoded, "base64url").toString("utf8")
  } catch {
    return null
  }

  const expected = sign(body, secret)
  const given = Buffer.from(signature)
  const want = Buffer.from(expected)
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null

  const fields = body.split(".")
  if (fields.length !== 4 && fields.length !== 5) return null
  const [orgId, userId, callLogId, expiresAtRaw, claimToken] = fields
  const expiresAt = Number(expiresAtRaw)
  if (!orgId || !userId || !callLogId || !Number.isFinite(expiresAt)) return null
  if (claimToken !== undefined && !CLAIM_TOKEN_RE.test(claimToken)) return null
  if (now >= expiresAt) return null
  return {
    orgId,
    userId,
    callLogId,
    expiresAt,
    ...(claimToken ? { claimToken } : {}),
  }
}

/**
 * The salespeople this deployment is piloting the softphone with.
 *
 * Empty means the whole organisation, which is what the flag alone used to
 * mean. A non-empty list narrows it to those users and nobody else.
 *
 * In the ENVIRONMENT, deliberately, and not in a preference or a user row. A
 * salesperson can write their own `UserPreference`; a list stored there would be
 * a feature they could grant themselves. The voice pilot made the same choice
 * for the same reason (`VOICE_PILOT_USER_IDS`), and one mechanism understood by
 * everyone beats two that each cover half the cases.
 *
 * Read fresh on every call rather than at module load: a warm PM2 process must
 * not keep serving a list that was changed under it.
 */
export function browserSoftphoneUserIds(): string[] {
  return (process.env.BROWSER_SOFTPHONE_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
}

/**
 * Whether this user, in this organisation, may place browser calls.
 *
 * Three switches, and every one of them can only ever say no:
 *
 *  - the environment variable is the kill switch. Unset it, restart, and every
 *    tenant falls back to the phone path without a deploy.
 *  - the organisation flag is the tenant's own decision.
 *  - the pilot list is the rollout inside a tenant: one salesperson, then the
 *    team. Empty means everyone the flag already allows, so adding the list
 *    changes nothing for a deployment that does not use it.
 *
 * `userId` is optional so a caller that has no user in hand — a background job,
 * a test — behaves exactly as before. But a caller that HAS one and forgets to
 * pass it would silently widen the rollout to the whole tenant, which is why
 * both call sites pass it and a test asserts they do.
 */
export function browserSoftphoneAllowed(
  modules: Record<string, boolean> | undefined,
  userId?: string,
): boolean {
  if (process.env.BROWSER_SOFTPHONE_ENABLED !== "1") return false
  if (!browserSoftphoneConfigured()) return false
  if (modules?.browserSoftphone !== true) return false
  const pilot = browserSoftphoneUserIds()
  if (pilot.length === 0) return true
  return Boolean(userId) && pilot.includes(userId as string)
}

/**
 * Whether this deployment can actually finish a browser call.
 *
 * Checked in the gate, BEFORE the customer is dialled. Without it the flags
 * alone would authorise a call, the customer's phone would ring, and only then
 * would the server discover it has no signing secret to mint a ticket with or
 * no relay to name — leaving a real person listening to silence over a
 * configuration mistake.
 */
export function browserSoftphoneConfigured(): boolean {
  const relay = process.env.SOFTPHONE_RELAY_URL
  return Boolean(ticketSecret()) && Boolean(relay && /^wss?:\/\//.test(relay))
}
