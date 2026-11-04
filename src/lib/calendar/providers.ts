/**
 * The calendars a person can connect to the CRM.
 *
 * One host may hold one of each: the salon owner keeps their own Google
 * account and the company's Outlook mailbox, and both must block the same
 * chair. So everything here speaks of a LIST of connected calendars, never of
 * «the» calendar — the single-calendar assumption is what made Outlook
 * impossible to add before.
 *
 * `google` keeps its two historical provider strings: `google-calendar` is an
 * explicit connection, while a bare `google` row may be left over from the
 * removed SSO sign-in and counts only when its scopes prove calendar consent
 * (see isIdentityOnlyGoogleScope).
 */
export type CalendarProvider = "google" | "microsoft"

export const GOOGLE_ACCOUNT_PROVIDERS = ["google-calendar", "google"] as const
export const MICROSOFT_ACCOUNT_PROVIDER = "microsoft-calendar"

export const CALENDAR_ACCOUNT_PROVIDERS: string[] = [...GOOGLE_ACCOUNT_PROVIDERS, MICROSOFT_ACCOUNT_PROVIDER]

/** Which calendar a stored account row belongs to, or null when it is not one. */
export function calendarProviderOf(provider: string): CalendarProvider | null {
  if ((GOOGLE_ACCOUNT_PROVIDERS as readonly string[]).includes(provider)) return "google"
  return provider === MICROSOFT_ACCOUNT_PROVIDER ? "microsoft" : null
}

/**
 * The set of calendars a booking decision was taken against, as one string.
 *
 * A meeting is written only if the host's connected calendars are still
 * exactly the ones whose busy time was read a moment ago — connecting or
 * dropping a calendar between the check and the write would otherwise book
 * over something nobody looked at. Order never matters, so it is sorted.
 */
export function connectedCalendarKey(accounts: { id: string }[]): string {
  return [...accounts.map((account) => account.id)].sort().join("|")
}
