import type { Locale } from "@/i18n/routing"
import { formatInTimezone, timezoneOffsetLabel } from "@/lib/timezone"

/**
 * Every sentence the support module writes about a ticket on its own — the
 * subject of a ticket a chat channel opened, and what the customer receives
 * when an agent changes the ticket — in the three languages of the product.
 *
 * Pure. Which language: `customer-locale.ts` (customer messages) and the
 * organization's language (subjects, read by its team).
 */

// ─── Subjects of tickets that chat channels open ────────────────────────────

/** The category a chat ticket was filed under (`Ticket.category` of the generated ticket). */
export type GeneratedTicketKind = "general" | "complaint" | "technical" | "billing" | "sales" | "ai_escalation"

const WHATSAPP_SUBJECT_PREFIX: Record<Locale, Record<GeneratedTicketKind, string>> = {
  ru: {
    general: "WhatsApp Тикет",
    complaint: "Жалоба WhatsApp",
    technical: "Техподдержка WhatsApp",
    billing: "Финансы/Оплата WhatsApp",
    sales: "Продажи/Запрос WhatsApp",
    ai_escalation: "WhatsApp Эскалация",
  },
  az: {
    general: "WhatsApp müraciəti",
    complaint: "WhatsApp şikayəti",
    technical: "WhatsApp texniki dəstək",
    billing: "WhatsApp maliyyə/ödəniş",
    sales: "WhatsApp satış sorğusu",
    ai_escalation: "WhatsApp eskalasiyası",
  },
  en: {
    general: "WhatsApp ticket",
    complaint: "WhatsApp complaint",
    technical: "WhatsApp tech support",
    billing: "WhatsApp billing/payment",
    sales: "WhatsApp sales inquiry",
    ai_escalation: "WhatsApp escalation",
  },
}

const ASSISTANT_ESCALATION_SUBJECT_PREFIX: Record<Locale, string> = {
  ru: "Da Vinci Эскалация",
  az: "Da Vinci eskalasiyası",
  en: "Da Vinci escalation",
}

/** Prefixes earlier writers used; still in the subjects of old tickets. */
const LEGACY_SUBJECT_PREFIXES = ["AI Escalation", "WhatsApp Escalation"]

const GENERATED_SUBJECT_PREFIXES = new Set<string>([
  ...Object.values(WHATSAPP_SUBJECT_PREFIX).flatMap((byKind) => Object.values(byKind)),
  ...Object.values(ASSISTANT_ESCALATION_SUBJECT_PREFIX),
  ...LEGACY_SUBJECT_PREFIXES,
])

function generatedSubject(prefix: string, message: string): string {
  return `[${prefix}] ${message.trim().slice(0, 80)}`
}

/**
 * The subject of a ticket a WhatsApp message opened: the prefix tells the team
 * at a glance what it is about, in the organization's language.
 */
export function whatsappTicketSubject(locale: Locale, kind: GeneratedTicketKind, message: string): string {
  return generatedSubject(WHATSAPP_SUBJECT_PREFIX[locale][kind], message)
}

export function assistantEscalationSubject(locale: Locale, message: string): string {
  return generatedSubject(ASSISTANT_ESCALATION_SUBJECT_PREFIX[locale], message)
}

/**
 * The subject as the customer is shown it: without the prefix a channel put
 * there for the team. The customer's own words stay; a bracket the customer or
 * an agent typed («[URGENT] …») is not a generated prefix and stays too.
 */
export function customerFacingTicketSubject(subject: string): string {
  const match = subject.match(/^\[([^\]]+)\]\s*([\s\S]*)$/)
  if (!match || !GENERATED_SUBJECT_PREFIXES.has(match[1].trim())) return subject
  return match[2].trim() || subject
}

/** The subject of a ticket a website chat opened before the visitor wrote anything (an agent escalated it). */
export function webChatTicketFallbackSubject(locale: Locale): string {
  switch (locale) {
    case "az":
      return "Sayt çatından müraciət"
    case "en":
      return "Request from the website chat"
    default:
      return "Обращение из чата на сайте"
  }
}

// ─── What the visitor reads in the website chat when it becomes a ticket ───

/**
 * The bot line the website chat shows once its ticket exists. It states the one
 * thing that is confirmed — the ticket and its number — and nothing about who
 * will answer or when: until 2026-10-17 it said «An agent will contact you
 * shortly», in English for every organization, which is exactly the promise
 * `omnichannel-commitment-rules.ts` forbids the AI replies of the same chat.
 */
export function webChatEscalationNotice(locale: Locale, ticketNumber: string): string {
  switch (locale) {
    case "az":
      return `Müraciətiniz ${ticketNumber} nömrəsi ilə qeydə alındı. Bu məsələ ilə bağlı bizə yazsanız, həmin nömrəni göstərin.`
    case "en":
      return `Your request has been registered as ticket ${ticketNumber}. Please quote this number if you contact us about it.`
    default:
      return `Ваше обращение зарегистрировано под номером ${ticketNumber}. Укажите этот номер, если будете писать нам по этому вопросу.`
  }
}

// ─── What the customer receives when the ticket is resolved ────────────────

export function closureRequestWhatsAppText(locale: Locale, input: { ticketNumber: string; confirmationUrl: string }): string {
  const { ticketNumber, confirmationUrl } = input
  switch (locale) {
    case "az":
      return `Müraciətiniz ${ticketNumber} həll olunmuş kimi qeyd edildi. Bağlanmasını təsdiqləyin və ya dəstəyə qaytarın: ${confirmationUrl}`
    case "en":
      return `Your ticket ${ticketNumber} has been marked as resolved. Confirm it can be closed, or send it back to support: ${confirmationUrl}`
    default:
      return `Ваш тикет ${ticketNumber} отмечен как решён. Подтвердите закрытие или верните в работу: ${confirmationUrl}`
  }
}

const CLOSURE_EMAIL_TEXT: Record<Locale, {
  subject: (ticketNumber: string) => string
  intro: string
  ifSolved: string
  ifSolvedText: string
  action: string
  autoClose: (when: string) => string
  link: string
  subjectLabel: string
}> = {
  ru: {
    subject: (n) => `Подтвердите закрытие тикета ${n}`,
    intro: "Мы отметили обращение как решенное:",
    ifSolved: "Если вопрос решен, подтвердите закрытие. Если проблема осталась, верните тикет в работу по той же ссылке.",
    ifSolvedText: "Если вопрос решен, подтвердите закрытие. Если проблема осталась, верните тикет в работу по ссылке:",
    action: "Открыть подтверждение",
    autoClose: (when) => `Если ответа не будет, тикет закроется автоматически: ${when}.`,
    link: "Ссылка",
    subjectLabel: "Тема",
  },
  az: {
    subject: (n) => `${n} müraciətinin bağlanmasını təsdiqləyin`,
    intro: "Müraciətinizi həll olunmuş kimi qeyd etdik:",
    ifSolved: "Məsələ həll olunubsa, bağlanmanı təsdiqləyin. Problem qalırsa, eyni keçidlə müraciəti dəstəyə qaytarın.",
    ifSolvedText: "Məsələ həll olunubsa, bağlanmanı təsdiqləyin. Problem qalırsa, müraciəti bu keçidlə dəstəyə qaytarın:",
    action: "Təsdiqi aç",
    autoClose: (when) => `Cavab verməsəniz, müraciət avtomatik bağlanacaq: ${when}.`,
    link: "Keçid",
    subjectLabel: "Mövzu",
  },
  en: {
    subject: (n) => `Confirm that ticket ${n} can be closed`,
    intro: "We have marked your request as resolved:",
    ifSolved: "If the issue is solved, confirm the closure. If the problem remains, send the ticket back to support using the same link.",
    ifSolvedText: "If the issue is solved, confirm the closure. If the problem remains, send the ticket back to support using this link:",
    action: "Open confirmation",
    autoClose: (when) => `If we do not hear from you, the ticket will close automatically on ${when}.`,
    link: "Link",
    subjectLabel: "Subject",
  },
}

const DATE_LOCALE: Record<Locale, string> = { ru: "ru-RU", az: "az", en: "en-GB" }

/** "24.10.2026, 12:00 (GMT+4)" — the clock named, since the reader may live in another zone. */
export function customerDateTime(locale: Locale, at: Date, timezone: string | null): string {
  const zone = timezone || "UTC"
  const when = formatInTimezone(at, zone, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }, DATE_LOCALE[locale])
  return `${when} (${timezoneOffsetLabel(zone, at)})`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function closureRequestEmail(locale: Locale, input: {
  ticketNumber: string | null
  subject: string
  dueAt: Date
  timezone: string | null
  confirmationUrl: string
}): { subject: string; html: string; text: string } {
  const copy = CLOSURE_EMAIL_TEXT[locale]
  const ticketNumber = input.ticketNumber || "ticket"
  const ticketSubject = customerFacingTicketSubject(input.subject)
  const dueAt = customerDateTime(locale, input.dueAt, input.timezone)
  const safeUrl = escapeHtml(input.confirmationUrl)
  const heading = copy.subject(ticketNumber)

  const html = `
<!doctype html><html lang="${locale}"><body style="font-family:system-ui,Segoe UI,Arial;margin:0;padding:24px;background:#f6f7f9;color:#111827">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
    <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${escapeHtml(heading)}</h1>
    <p style="margin:0 0 16px;color:#4b5563;line-height:1.5">${escapeHtml(copy.intro)}</p>
    <p style="margin:0 0 20px;font-weight:600">${escapeHtml(ticketSubject)}</p>
    <p style="margin:0 0 20px;color:#4b5563;line-height:1.5">${escapeHtml(copy.ifSolved)}</p>
    <p style="margin:24px 0">
      <a href="${safeUrl}" style="background:#2563eb;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">${escapeHtml(copy.action)}</a>
    </p>
    <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5">${escapeHtml(copy.autoClose(dueAt))}</p>
    <p style="margin:18px 0 0;color:#9ca3af;font-size:12px;line-height:1.5">${escapeHtml(copy.link)}: <a href="${safeUrl}" style="color:#6b7280">${safeUrl}</a></p>
  </div>
</body></html>`

  const text = [
    heading,
    "",
    `${copy.subjectLabel}: ${ticketSubject}`,
    "",
    copy.ifSolvedText,
    input.confirmationUrl,
    "",
    copy.autoClose(dueAt),
  ].join("\n")

  return { subject: heading, html, text }
}

// ─── What the customer receives when the ticket's status changes ───────────

const STATUS_TEXT: Record<Locale, Record<string, (ticketNumber: string) => string>> = {
  ru: {
    in_progress: (n) => `Ваш тикет ${n} взят в работу.`,
    waiting: (n) => `По тикету ${n} нам нужно больше информации. Пожалуйста, ответьте с подробностями.`,
    resolved: (n) => `Ваш тикет ${n} решён. Спасибо за обращение.`,
    closed: (n) => `Ваш тикет ${n} закрыт.`,
    escalated: (n) => `Ваш тикет ${n} передан специалисту.`,
    reopened: (n) => `Ваш тикет ${n} снова открыт.`,
  },
  az: {
    in_progress: (n) => `Müraciətiniz ${n} üzərində iş başlanıb.`,
    waiting: (n) => `${n} müraciəti üzrə bizə əlavə məlumat lazımdır. Zəhmət olmasa, ətraflı cavab yazın.`,
    resolved: (n) => `Müraciətiniz ${n} həll olundu. Bizə müraciət etdiyiniz üçün təşəkkür edirik.`,
    closed: (n) => `Müraciətiniz ${n} bağlandı.`,
    escalated: (n) => `Müraciətiniz ${n} mütəxəssisə ötürüldü.`,
    reopened: (n) => `Müraciətiniz ${n} yenidən açıldı.`,
  },
  en: {
    in_progress: (n) => `Your ticket ${n} is now being processed.`,
    waiting: (n) => `We need more info on your ticket ${n}. Please reply with details.`,
    resolved: (n) => `Your ticket ${n} has been resolved. Thank you for contacting us.`,
    closed: (n) => `Your ticket ${n} has been closed.`,
    escalated: (n) => `Your ticket ${n} has been escalated to a specialist.`,
    reopened: (n) => `Your ticket ${n} has been reopened.`,
  },
}

/**
 * The plain WhatsApp text for a status change, used when the organization has
 * no Meta template for it. Null for a status the customer is not told about.
 */
export function ticketStatusWhatsAppText(locale: Locale, status: string, ticketNumber: string): string | null {
  const byStatus = STATUS_TEXT[locale]
  return Object.hasOwn(byStatus, status) ? byStatus[status](ticketNumber) : null
}
