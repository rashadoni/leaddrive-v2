import { defaultLocale, locales, type Locale } from "@/i18n/routing"

// What a manager reads in the bell when an escalation rule fires. The scheduled
// job has no request and therefore no UI locale, so the text is written in the
// recipient's own language (User.preferredLanguage), falling back to the app
// default — the same rule the weekly digest and portal emails follow.

export type EscalationTrigger = "first_response_breach" | "resolution_breach" | "resolution_warning"

const TEXT: Record<Locale, {
  title: (level: number, ticketNumber: string) => string
  reasons: Record<EscalationTrigger, string>
  otherReason: string
  rule: (name: string) => string
}> = {
  ru: {
    title: (level, ticketNumber) => `Эскалация SLA, уровень ${level}: ${ticketNumber}`,
    reasons: {
      first_response_breach: "нарушен срок первого ответа",
      resolution_breach: "нарушен срок решения",
      resolution_warning: "срок решения скоро истечёт",
    },
    otherReason: "сработало правило эскалации",
    rule: (name) => `Правило: ${name}`,
  },
  en: {
    title: (level, ticketNumber) => `SLA escalation, level ${level}: ${ticketNumber}`,
    reasons: {
      first_response_breach: "the first response is overdue",
      resolution_breach: "the resolution is overdue",
      resolution_warning: "the resolution deadline is approaching",
    },
    otherReason: "an escalation rule fired",
    rule: (name) => `Rule: ${name}`,
  },
  az: {
    title: (level, ticketNumber) => `SLA eskalasiyası, səviyyə ${level}: ${ticketNumber}`,
    reasons: {
      first_response_breach: "ilk cavab müddəti pozulub",
      resolution_breach: "həll müddəti pozulub",
      resolution_warning: "həll müddəti yaxınlaşır",
    },
    otherReason: "eskalasiya qaydası işə düşdü",
    rule: (name) => `Qayda: ${name}`,
  },
}

export function escalationNotificationLocale(preferredLanguage: string | null | undefined): Locale {
  return locales.includes(preferredLanguage as Locale) ? (preferredLanguage as Locale) : defaultLocale
}

export function escalationNotificationText(
  preferredLanguage: string | null | undefined,
  input: { level: number; ticketNumber: string; subject: string; triggerType: string; ruleName: string },
): { title: string; message: string } {
  const text = TEXT[escalationNotificationLocale(preferredLanguage)]
  const reason = text.reasons[input.triggerType as EscalationTrigger] ?? text.otherReason
  return {
    title: text.title(input.level, input.ticketNumber),
    message: `«${input.subject}» — ${reason}. ${text.rule(input.ruleName)}`,
  }
}
