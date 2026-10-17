import { locales, type Locale } from "@/i18n/routing"
import { formatDate } from "@/lib/format-date"
import { organizationLocale } from "@/lib/ticketing/customer-locale"

/**
 * What the contract jobs say: the renewal alert, the overdue approval, the
 * milestone reminder in the bell, and the signing invitation and reminder
 * a signer gets by e-mail.
 *
 * They were written in English for everybody, so an Azerbaijani or Russian
 * team found «Renewal alert: CTR-0042» in its bell. A scheduled job has no
 * request and no UI locale: the bell speaks the recipient's own language
 * (User.preferredLanguage), the organization's when none is set — the rule
 * the callback task and the escalation notices follow. A signer is outside
 * the CRM and has no language of their own here, so the e-mails speak the
 * organization's.
 */

const TEXT: Record<Locale, {
  renewalTitle: (contract: string) => string
  renewalBody: (days: number, endDate: string) => string
  approvalTitle: (contract: string, stage: string) => string
  approvalBody: (stage: string, contract: string, level: number) => string
  approvalAssigneeTitle: (stage: string) => string
  approvalAssigneeBody: (stage: string, contract: string) => string
  milestoneTitle: (overdue: boolean, label: string) => string
  milestoneBody: (overdue: boolean, label: string, contract: string, due: string) => string
  milestoneOwnerTitle: (label: string) => string
  milestoneOwnerBody: (overdue: boolean, label: string, contract: string, due: string) => string
  signSubject: (subject: string) => string
  signReminderSubject: (subject: string) => string
  signHeading: string
  signHello: (name: string) => string
  signAsked: string
  signReminderAsked: string
  signButton: string
  signCopyLink: string
  signReplacesLink: string
  signPersonal: string
}> = {
  az: {
    renewalTitle: (contract) => `Müqavilənin müddəti bitir: ${contract}`,
    renewalBody: (days, endDate) => `${endDate} tarixində bitir — ${days} gün qalıb.`,
    approvalTitle: (contract, stage) => `Təsdiq gecikir: ${contract} — «${stage}» mərhələsi`,
    approvalBody: (stage, contract, level) => `«${contract}» müqaviləsində «${stage}» mərhələsinin təsdiq vaxtı keçib (eskalasiya səviyyəsi ${level}). Qərar verin.`,
    approvalAssigneeTitle: (stage) => `Qərarınız gözlənilir: «${stage}»`,
    approvalAssigneeBody: (stage, contract) => `«${contract}» müqaviləsində «${stage}» mərhələsi sizin qərarınızı gözləyir, vaxtı keçib.`,
    milestoneTitle: (overdue, label) => `${overdue ? "Mərhələ gecikir" : "Mərhələ yaxınlaşır"}: ${label}`,
    milestoneBody: (overdue, label, contract, due) => `«${contract}» müqaviləsində «${label}» mərhələsi ${overdue ? "gecikir" : "yaxınlaşır"} (son tarix ${due}).`,
    milestoneOwnerTitle: (label) => `Sizə həvalə olunub: ${label}`,
    milestoneOwnerBody: (overdue, label, contract, due) => `«${contract}» müqaviləsində sizə həvalə olunmuş «${label}» mərhələsi ${overdue ? "gecikir" : "yaxınlaşır"}. Son tarix: ${due}.`,
    signSubject: (subject) => `İmzanız gözlənilir: ${subject}`,
    signReminderSubject: (subject) => `Xatırlatma: imzanız gözlənilir — ${subject}`,
    signHeading: "İmzalanacaq sənədiniz var",
    signHello: (name) => `Salam, ${name}!`,
    signAsked: "Sizdən bu sənədi nəzərdən keçirib imzalamaq xahiş olunur:",
    signReminderAsked: "Xatırladırıq: bu sənəd sizin imzanızı gözləyir:",
    signButton: "Sənədə baxıb imzala",
    signCopyLink: "Düymə işləmirsə, bu linki brauzerə köçürün:",
    signReplacesLink: "Bu link əvvəl göndərilən imza linkini əvəz edir — yalnız bu link işləyir.",
    signPersonal: "Bu link yalnız sizin üçündür, başqasına göndərməyin.",
  },
  ru: {
    renewalTitle: (contract) => `Срок договора истекает: ${contract}`,
    renewalBody: (days, endDate) => `Заканчивается ${endDate} — осталось ${days} дн.`,
    approvalTitle: (contract, stage) => `Согласование просрочено: ${contract} — этап «${stage}»`,
    approvalBody: (stage, contract, level) => `Этап «${stage}» по договору «${contract}» просрочен (уровень эскалации ${level}). Примите решение.`,
    approvalAssigneeTitle: (stage) => `Ждёт вашего решения: «${stage}»`,
    approvalAssigneeBody: (stage, contract) => `Этап «${stage}» по договору «${contract}» ждёт вашего решения, срок прошёл.`,
    milestoneTitle: (overdue, label) => `${overdue ? "Этап просрочен" : "Скоро срок этапа"}: ${label}`,
    milestoneBody: (overdue, label, contract, due) => `Этап «${label}» по договору «${contract}» ${overdue ? "просрочен" : "скоро наступает"} (срок ${due}).`,
    milestoneOwnerTitle: (label) => `Поручено вам: ${label}`,
    milestoneOwnerBody: (overdue, label, contract, due) => `Этап «${label}» по договору «${contract}», порученный вам, ${overdue ? "просрочен" : "скоро наступает"}. Срок: ${due}.`,
    signSubject: (subject) => `Ждём вашей подписи: ${subject}`,
    signReminderSubject: (subject) => `Напоминание: ждём вашей подписи — ${subject}`,
    signHeading: "Вам на подпись документ",
    signHello: (name) => `Здравствуйте, ${name}!`,
    signAsked: "Вас просят ознакомиться с документом и подписать его:",
    signReminderAsked: "Напоминаем: этот документ ждёт вашей подписи:",
    signButton: "Открыть и подписать",
    signCopyLink: "Если кнопка не работает, скопируйте ссылку в браузер:",
    signReplacesLink: "Эта ссылка заменяет присланную раньше — работает только она.",
    signPersonal: "Ссылка личная, не пересылайте её.",
  },
  en: {
    renewalTitle: (contract) => `Contract ending: ${contract}`,
    renewalBody: (days, endDate) => `Ends on ${endDate} — ${days} days left.`,
    approvalTitle: (contract, stage) => `Approval overdue: ${contract} — stage «${stage}»`,
    approvalBody: (stage, contract, level) => `Approval stage «${stage}» on contract «${contract}» is overdue (escalation level ${level}). Please decide.`,
    approvalAssigneeTitle: (stage) => `Your decision is needed: «${stage}»`,
    approvalAssigneeBody: (stage, contract) => `Approval stage «${stage}» on contract «${contract}» is waiting for your decision and is overdue.`,
    milestoneTitle: (overdue, label) => `${overdue ? "Milestone overdue" : "Milestone due soon"}: ${label}`,
    milestoneBody: (overdue, label, contract, due) => `Milestone «${label}» on contract «${contract}» is ${overdue ? "overdue" : "due soon"} (due ${due}).`,
    milestoneOwnerTitle: (label) => `Assigned to you: ${label}`,
    milestoneOwnerBody: (overdue, label, contract, due) => `Milestone «${label}» on contract «${contract}», assigned to you, is ${overdue ? "overdue" : "due soon"}. Due: ${due}.`,
    signSubject: (subject) => `Please sign: ${subject}`,
    signReminderSubject: (subject) => `Reminder: please sign — ${subject}`,
    signHeading: "You have a document to sign",
    signHello: (name) => `Hello ${name},`,
    signAsked: "You have been asked to review and sign the following document:",
    signReminderAsked: "A reminder: this document is waiting for your signature:",
    signButton: "Review & sign",
    signCopyLink: "If the button doesn't work, copy this link into your browser:",
    signReplacesLink: "This link replaces any signing link sent before — only this one works.",
    signPersonal: "This link is personal to you; please don't forward it.",
  },
}

function asLocale(value: unknown): Locale | null {
  return typeof value === "string" && (locales as readonly string[]).includes(value) ? (value as Locale) : null
}

/** A CRM user's language: their own, else the organization's. */
export function contractRecipientLocale(preferredLanguage: string | null | undefined, organizationSettings: unknown): Locale {
  return asLocale(preferredLanguage) ?? organizationLocale(organizationSettings)
}

/** A date-only field (end date, due date) as people of that language write it. */
export function contractDate(date: Date | null | undefined, locale: Locale): string {
  if (!date) return "—"
  return formatDate(date, locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }) || "—"
}

export function renewalAlertText(locale: Locale, input: { contractNumber: string; title: string | null; company: string | null; endDate: Date | null; daysBeforeExpiry: number }) {
  const text = TEXT[locale]
  const named = [input.title, input.company ? `(${input.company})` : null].filter(Boolean).join(" ")
  return {
    title: text.renewalTitle(input.contractNumber),
    message: [named, text.renewalBody(input.daysBeforeExpiry, contractDate(input.endDate, locale))].filter(Boolean).join(" — "),
  }
}

export function approvalOverdueText(locale: Locale, input: { contractRef: string; contractTitle: string; stage: string; level: number }) {
  const text = TEXT[locale]
  return {
    managers: { title: text.approvalTitle(input.contractRef, input.stage), message: text.approvalBody(input.stage, input.contractTitle, input.level) },
    assignee: { title: text.approvalAssigneeTitle(input.stage), message: text.approvalAssigneeBody(input.stage, input.contractTitle) },
  }
}

export function milestoneReminderText(locale: Locale, input: { label: string; contractTitle: string; dueAt: Date; overdue: boolean }) {
  const text = TEXT[locale]
  const due = contractDate(input.dueAt, locale)
  return {
    managers: { title: text.milestoneTitle(input.overdue, input.label), message: text.milestoneBody(input.overdue, input.label, input.contractTitle, due) },
    owner: { title: text.milestoneOwnerTitle(input.label), message: text.milestoneOwnerBody(input.overdue, input.label, input.contractTitle, due) },
  }
}

function htmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** The signing invitation, or its reminder with the re-issued link. */
export function signingEmail(locale: Locale, input: { kind: "invitation" | "reminder"; fullName: string; subject: string; message?: string | null; signingLink: string }) {
  const text = TEXT[locale]
  const reminder = input.kind === "reminder"
  const subject = htmlEscape(input.subject)
  const link = htmlEscape(input.signingLink)
  const note = input.message ? `<p style="color:#555">${htmlEscape(input.message)}</p>` : ""
  return {
    subject: reminder ? text.signReminderSubject(input.subject) : text.signSubject(input.subject),
    html: `<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><title>${htmlEscape(text.signHeading)}</title></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a2e">${htmlEscape(text.signHeading)}</h2>
  <p>${htmlEscape(text.signHello(input.fullName))}</p>
  <p>${htmlEscape(reminder ? text.signReminderAsked : text.signAsked)}</p>
  <p><strong>${subject}</strong></p>
  ${note}
  <p style="margin:32px 0">
    <a href="${link}"
       style="background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">
      ${htmlEscape(text.signButton)}
    </a>
  </p>
  <p style="color:#888;font-size:12px">
    ${htmlEscape(text.signCopyLink)}<br>
    <a href="${link}" style="color:#4f46e5;word-break:break-all">${link}</a>
  </p>${reminder ? `\n  <p style="color:#888;font-size:12px">${htmlEscape(text.signReplacesLink)}</p>` : ""}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#aaa;font-size:11px">${htmlEscape(text.signPersonal)}</p>
</body>
</html>`,
  }
}
