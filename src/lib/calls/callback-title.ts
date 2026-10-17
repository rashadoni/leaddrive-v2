import { locales, type Locale } from "@/i18n/routing"
import { organizationLocale } from "@/lib/ticketing/customer-locale"

/**
 * The title of the task a «Geri zəng» outcome files for the employee who
 * made the call. It was the English word «Callback» for everybody, so an
 * Azerbaijani or Russian team found an English task in its list. It is
 * written in the employee's own language, the organization's when he has
 * none set — the same rule the briefings follow.
 */
export const CALLBACK_TASK_TITLES: Record<Locale, string> = {
  az: "Geri zəng",
  ru: "Перезвонить",
  en: "Call back",
}

export function callbackTaskTitle(input: { preferredLanguage?: string | null; organizationSettings?: unknown }): string {
  const own = (locales as readonly string[]).includes(input.preferredLanguage ?? "") ? (input.preferredLanguage as Locale) : null
  return CALLBACK_TASK_TITLES[own ?? organizationLocale(input.organizationSettings)]
}

/**
 * Whether a task still carries the untouched title a manual callback was
 * filed with — today's in any language, or the English one tasks were filed
 * with before. The call analysis replaces only such a title with its own.
 */
export function isCallbackPlaceholderTitle(title: string): boolean {
  return title === "Callback" || Object.values(CALLBACK_TASK_TITLES).includes(title)
}
