import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"

export interface CalendarCredentials {
  access_token?: string | null
  refresh_token?: string | null
  expiry_date?: number | null
  token_type?: string | null
  scope?: string | null
}

async function lockHost(tx: Prisma.TransactionClient, orgId: string, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking:${orgId}:${userId}`}))`
}

async function retireConnections(tx: Prisma.TransactionClient, orgId: string, userId: string) {
  const previous = await tx.account.findMany({ where: { userId, provider: "google-calendar" }, select: { id: true } })
  if (previous.length) await tx.bookingIntegrationBinding.updateMany({
    where: { organizationId: orgId, hostUserId: userId, accountId: { in: previous.map((row) => row.id) }, desiredState: "present", booking: { status: "confirmed", startsAt: { gt: new Date() } } },
    data: { state: "reconciliation_required" },
  })
  await tx.account.deleteMany({ where: { userId, provider: "google-calendar" } })
}

/** Caller holds a transaction. Consent/disconnect shares booking's host lock. */
export async function disconnectCalendarConnection(tx: Prisma.TransactionClient, orgId: string, userId: string) {
  await lockHost(tx, orgId, userId)
  await retireConnections(tx, orgId, userId)
}

/** Identity comes from Google's authenticated primary-calendar response, never
 * callback input. Only that same verified identity may reuse refresh tokens.
 * Legacy/changed identities get a fresh row; old bindings cannot be retargeted. */
export async function replaceCalendarConnection(tx: Prisma.TransactionClient, orgId: string, userId: string, tokens: CalendarCredentials, calendarId: string) {
  if (!tokens.access_token || !calendarId || calendarId.length > 512) throw new Error("CALENDAR_IDENTITY_MISSING")
  const providerAccountId = `gcal-v2-${createHash("sha256").update(userId).update("\0").update(calendarId).digest("hex")}`
  await lockHost(tx, orgId, userId)
  const sameIdentity = await tx.account.findFirst({ where: { userId, provider: "google-calendar", providerAccountId } })
  const data = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || sameIdentity?.refresh_token || null,
    expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
    token_type: tokens.token_type || "Bearer", scope: tokens.scope || sameIdentity?.scope || "https://www.googleapis.com/auth/calendar.events",
  }
  if (sameIdentity) return tx.account.update({ where: { id: sameIdentity.id }, data })
  await retireConnections(tx, orgId, userId)
  return tx.account.create({ data: { userId, type: "oauth", provider: "google-calendar", providerAccountId, ...data } })
}
