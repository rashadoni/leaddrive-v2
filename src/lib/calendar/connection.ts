/**
 * Connecting and disconnecting one calendar of one host.
 *
 * Shared by Google and Outlook because the hazard is the same in both: a
 * confirmed meeting in the future has an event on the calendar it was written
 * to, and swapping the credential under it would leave that event orphaned or,
 * worse, retarget it at a stranger's calendar. So replacing a connection
 * retires the bindings of the connection it replaces, and only an identity
 * the provider itself confirmed may reuse a refresh token.
 *
 * Only one provider is touched per call: connecting Outlook must leave a
 * host's Google connection, and its meetings, exactly as they were.
 */
import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { MICROSOFT_ACCOUNT_PROVIDER, type CalendarProvider } from "./providers"

export interface CalendarCredentials {
  access_token?: string | null
  refresh_token?: string | null
  /** Milliseconds, as Google's client reports it. */
  expiry_date?: number | null
  token_type?: string | null
  scope?: string | null
}

const SETTINGS: Record<CalendarProvider, { provider: string; identityPrefix: string; defaultScope: string }> = {
  google: { provider: "google-calendar", identityPrefix: "gcal-v2", defaultScope: "https://www.googleapis.com/auth/calendar.events" },
  microsoft: { provider: MICROSOFT_ACCOUNT_PROVIDER, identityPrefix: "ocal-v1", defaultScope: "https://graph.microsoft.com/Calendars.ReadWrite" },
}

async function lockHost(tx: Prisma.TransactionClient, orgId: string, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking:${orgId}:${userId}`}))`
}

async function retireConnections(tx: Prisma.TransactionClient, orgId: string, userId: string, provider: string) {
  const previous = await tx.account.findMany({ where: { userId, provider }, select: { id: true } })
  if (previous.length) await tx.bookingIntegrationBinding.updateMany({
    where: { organizationId: orgId, hostUserId: userId, accountId: { in: previous.map((row) => row.id) }, desiredState: "present", booking: { status: "confirmed", startsAt: { gt: new Date() } } },
    data: { state: "reconciliation_required" },
  })
  await tx.account.deleteMany({ where: { userId, provider } })
}

/** Caller holds a transaction. Consent/disconnect shares booking's host lock. */
export async function disconnectCalendar(tx: Prisma.TransactionClient, orgId: string, userId: string, provider: CalendarProvider) {
  await lockHost(tx, orgId, userId)
  await retireConnections(tx, orgId, userId, SETTINGS[provider].provider)
}

/** Identity comes from the provider's own authenticated answer, never callback
 * input. Only that same verified identity may reuse refresh tokens.
 * Legacy/changed identities get a fresh row; old bindings cannot be retargeted. */
export async function replaceCalendar(tx: Prisma.TransactionClient, orgId: string, userId: string, provider: CalendarProvider, tokens: CalendarCredentials, identity: string) {
  if (!tokens.access_token || !identity || identity.length > 512) throw new Error("CALENDAR_IDENTITY_MISSING")
  const settings = SETTINGS[provider]
  const providerAccountId = `${settings.identityPrefix}-${createHash("sha256").update(userId).update("\0").update(identity).digest("hex")}`
  await lockHost(tx, orgId, userId)
  const sameIdentity = await tx.account.findFirst({ where: { userId, provider: settings.provider, providerAccountId } })
  const data = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || sameIdentity?.refresh_token || null,
    expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
    token_type: tokens.token_type || "Bearer",
    scope: tokens.scope || sameIdentity?.scope || settings.defaultScope,
  }
  if (sameIdentity) return tx.account.update({ where: { id: sameIdentity.id }, data })
  await retireConnections(tx, orgId, userId, settings.provider)
  return tx.account.create({ data: { userId, type: "oauth", provider: settings.provider, providerAccountId, ...data } })
}
