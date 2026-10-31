import { formatDateTime } from "@/lib/format-date"

/**
 * A visit the agent opened and did not close is not a visit going on now.
 *
 * Owner, 2026-10-15, from the UX audit of the route module: «Сейчас идут
 * визиты: 1» on the visits page was a visit opened on 12 October, three days
 * before, and its card said «21:21 → ещё не завершён» with no date — it read
 * as a visit begun that evening. The office does not close an agent's visit
 * for him (owner, 2026-09-25: MTM_VISIT_CLOSE_BY_AGENT_ONLY), so the screen
 * says what it is — left open by the agent, since when — and offers a
 * reminder to the agent, never a «close».
 *
 * «Left open» is the tenant's own line: open at least `autoCheckoutMinutes`
 * (the setting that raises the long-open visit alert; 120 by default).
 */

export const MTM_VISIT_LONG_OPEN_DEFAULT_MINUTES = 120

function at(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value)
}

/** Whole minutes the visit has been open, never negative. */
export function mtmVisitOpenMinutes(checkInAt: string | Date, now: Date): number {
  const started = at(checkInAt)
  if (!Number.isFinite(started)) return 0
  return Math.max(0, Math.floor((now.getTime() - started) / 60_000))
}

/** An open visit past the tenant's long-open line. A closed or cancelled visit never is. */
export function isMtmVisitLeftOpen(
  visit: { status?: string | null; checkInAt: string | Date | null; checkOutAt?: string | Date | null },
  now: Date,
  longOpenMinutes: number = MTM_VISIT_LONG_OPEN_DEFAULT_MINUTES,
): boolean {
  if (!visit.checkInAt || visit.checkOutAt) return false
  if (visit.status && visit.status !== "CHECKED_IN") return false
  const line = Number.isFinite(longOpenMinutes) && longOpenMinutes > 0 ? longOpenMinutes : MTM_VISIT_LONG_OPEN_DEFAULT_MINUTES
  return mtmVisitOpenMinutes(visit.checkInAt, now) >= line
}

/** How long it has been open, in the one unit a person says: days, else hours, else minutes. */
export function mtmVisitOpenFor(minutes: number): { unit: "days" | "hours" | "minutes"; value: number } {
  if (minutes >= 24 * 60) return { unit: "days", value: Math.floor(minutes / (24 * 60)) }
  if (minutes >= 60) return { unit: "hours", value: Math.floor(minutes / 60) }
  return { unit: "minutes", value: minutes }
}

const REMINDER: Record<"ru" | "az" | "en", (customer: string, since: string) => string> = {
  ru: (customer, since) => `Визит в «${customer}» открыт с ${since} и всё ещё не закрыт. Закройте его в приложении.`,
  az: (customer, since) => `«${customer}» vizitiniz ${since} tarixindən açıqdır və hələ bağlanmayıb. Zəhmət olmasa tətbiqdə bağlayın.`,
  en: (customer, since) => `Your visit to «${customer}» has been open since ${since} and is still not closed. Please close it in the app.`,
}

/**
 * The reminder sent to the agent's app (a direct message of «Связь с
 * командой»): in all three languages, the app shows the agent's; the body is
 * the sender's language. The date and time are the tenant's.
 */
export function mtmVisitReminderMessage(input: {
  customerName: string
  checkInAt: string | Date
  timezone: string
  senderLocale: string
}): { body: string; localizations: { ru: string; az: string; en: string } } {
  // Through the shared formatter: the reminder is written in the sender's
  // browser, and Chrome has no Azerbaijani month names — bare Intl wrote
  // «M10 30 22:42» into the agent's chat (2026-10-31).
  const since = (locale: string) => {
    const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
    try {
      return formatDateTime(at(input.checkInAt), locale, { ...options, timeZone: input.timezone })
    } catch {
      // A zone the runtime does not know: UTC rather than no reminder.
      return formatDateTime(at(input.checkInAt), locale, { ...options, timeZone: "UTC" })
    }
  }
  const localizations = {
    ru: REMINDER.ru(input.customerName, since("ru")),
    az: REMINDER.az(input.customerName, since("az")),
    en: REMINDER.en(input.customerName, since("en-GB")),
  }
  const body = input.senderLocale === "ru" || input.senderLocale === "az" ? localizations[input.senderLocale] : localizations.en
  return { body, localizations }
}
