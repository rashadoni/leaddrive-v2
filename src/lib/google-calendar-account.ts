/**
 * Google's own view of the connected calendars (see calendar/accounts.ts).
 *
 * The Google client speaks of one account per user; the booking section has
 * to see every provider. Both read the same rows through the same rule, so a
 * calendar can never count for one and not for the other.
 */
import type { Prisma } from "@prisma/client"
import { connectedCalendars, isIdentityOnlyGoogleScope } from "./calendar/accounts"

export { isIdentityOnlyGoogleScope }

type Reader = Pick<Prisma.TransactionClient, "account">

export async function calendarAccounts(client: Reader, userIds: string[]) {
  const connected = await connectedCalendars(client, userIds)
  const google = new Map<string, { id: string; userId: string }>()
  for (const [userId, calendars] of connected) {
    const account = calendars.find((item) => item.provider === "google")
    if (account) google.set(userId, { id: account.id, userId })
  }
  return google
}

export async function calendarAccount(client: Reader, userId: string) {
  return (await calendarAccounts(client, [userId])).get(userId) ?? null
}
