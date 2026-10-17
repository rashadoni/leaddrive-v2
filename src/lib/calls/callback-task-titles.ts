import type { Locale } from "@/i18n/routing"

/**
 * The title of the task a «Geri zəng» outcome files for the employee who
 * made the call. It was the English word «Callback» for everybody, so an
 * Azerbaijani or Russian team found an English task in its list. It is
 * written in the employee's own language, the organization's when none is
 * set — the same rule the briefings follow. Kept apart from the database
 * lookup so the guided demo can name the task too.
 */
export const CALLBACK_TASK_TITLES: Record<Locale, string> = {
  az: "Geri zəng",
  ru: "Перезвонить",
  en: "Call back",
}
