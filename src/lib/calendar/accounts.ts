import type { Prisma } from "@prisma/client"
import { CALENDAR_ACCOUNT_PROVIDERS, calendarProviderOf, type CalendarProvider } from "./providers"

const IDENTITY_SCOPES = new Set(["openid", "email", "profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"])

/** Only positive evidence of sign-in-only consent excludes an SSO account.
 * Unknown scopes and explicit calendar connections still fail closed. */
export function isIdentityOnlyGoogleScope(scope: string | null): boolean {
  const scopes = scope?.trim().split(/\s+/).filter(Boolean) ?? []
  return scopes.length > 0 && scopes.every((item) => IDENTITY_SCOPES.has(item))
}

type Reader = Pick<Prisma.TransactionClient, "account">

export interface ConnectedCalendar {
  /** The stored account row; the credential and every binding point at it. */
  id: string
  userId: string
  provider: CalendarProvider
  /** The row's own provider string, for queries that must match it exactly. */
  accountProvider: string
}

/**
 * Every calendar these users have connected — at most one per provider each.
 *
 * Two rows of the same provider cannot both be live: connecting replaces the
 * previous one (see connection.ts), and the order below keeps the explicit
 * `google-calendar` row ahead of a legacy `google` one.
 */
export async function connectedCalendars(client: Reader, userIds: string[]): Promise<Map<string, ConnectedCalendar[]>> {
  const rows = await client.account.findMany({
    where: { userId: { in: userIds }, provider: { in: CALENDAR_ACCOUNT_PROVIDERS } },
    select: { id: true, userId: true, provider: true, scope: true },
    orderBy: [{ provider: "desc" }, { id: "asc" }],
  })
  const selected = new Map<string, ConnectedCalendar[]>()
  for (const row of rows) {
    const provider = calendarProviderOf(row.provider)
    if (!provider) continue
    // A sign-in-only Google account is not a calendar connection. Unknown
    // scopes still count: failing closed here would silently stop blocking
    // the host's real calendar.
    if (row.provider === "google" && isIdentityOnlyGoogleScope(row.scope)) continue
    const list = selected.get(row.userId) ?? []
    if (list.some((item) => item.provider === provider)) continue
    list.push({ id: row.id, userId: row.userId, provider, accountProvider: row.provider })
    selected.set(row.userId, list)
  }
  return selected
}

export async function connectedCalendarsOf(client: Reader, userId: string): Promise<ConnectedCalendar[]> {
  return (await connectedCalendars(client, [userId])).get(userId) ?? []
}
