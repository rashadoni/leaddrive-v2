import { locales, type Locale } from "@/i18n/routing"
import { organizationLocale } from "@/lib/ticketing/customer-locale"
import { CALLBACK_TASK_TITLES } from "@/lib/calls/callback-task-titles"

export { CALLBACK_TASK_TITLES }

/** In the employee's own language, the organization's when none is set. */
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
