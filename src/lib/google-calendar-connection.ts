/** Google's half of the shared calendar-connection rules (see calendar/connection.ts). */
import type { Prisma } from "@prisma/client"
import { disconnectCalendar, replaceCalendar, type CalendarCredentials } from "./calendar/connection"

export type { CalendarCredentials }

export function disconnectCalendarConnection(tx: Prisma.TransactionClient, orgId: string, userId: string) {
  return disconnectCalendar(tx, orgId, userId, "google")
}

export function replaceCalendarConnection(tx: Prisma.TransactionClient, orgId: string, userId: string, tokens: CalendarCredentials, calendarId: string) {
  return replaceCalendar(tx, orgId, userId, "google", tokens, calendarId)
}
