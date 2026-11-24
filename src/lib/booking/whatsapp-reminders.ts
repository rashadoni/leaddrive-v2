/**
 * Reminding a client before their visit, and letting them answer in one tap.
 *
 * The empty chair is the salon's biggest loss, and the cheapest way to keep it
 * full is to ask ahead — by default a day before, then again two hours before,
 * when the answer still leaves time to fill the slot. Both are the salon's to
 * set: each can be moved or switched off entirely
 * (`reminders` in whatsapp-setting.ts), because since 2026-10-01 every
 * delivered reminder beyond Meta's free thousand is money. Each one carries
 * three buttons:
 * coming, move it, cancel. «Cancel» two hours early is not a loss; it is a
 * slot the salon can still sell, which is why cancelling must be as easy as
 * confirming.
 *
 * Meta's 24-hour rule decides HOW the reminder goes out, not whether:
 *   - the client wrote within the last day → ordinary message with buttons;
 *   - otherwise → an approved template, named in the organization's settings.
 * Without an approved template that second case cannot be sent at all, and
 * the booking is left unmarked so the next run tries again rather than
 * swallowing it.
 */
import type { Prisma } from "@prisma/client"
import { bookingDb as prisma } from "./db"
import { sendWhatsAppButtons, sendWhatsAppTemplate, type WhatsAppReplyButton } from "@/lib/whatsapp"
import { orgContext } from "./book"
import { servicePriceLabel } from "./service"
import { clock, dayLabel, type ReplyLanguage } from "./whatsapp-format"
import { readWhatsAppBookingSetting, type ReminderSchedule } from "./whatsapp-setting"

/**
 * Only the digits. A meeting's phone is whatever the client typed — spaces,
 * brackets, a leading plus — while WhatsApp always says bare digits, and the
 * two have to be comparable.
 */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "")
}

/** A tap on a reminder button: `rm:<kind>:<bookingId>`. */
export const REMINDER_PREFIX = "rm:"
export type ReminderAction = "confirm" | "move" | "cancel"

export function reminderButtonId(action: ReminderAction, bookingId: string): string {
  return `${REMINDER_PREFIX}${action}:${bookingId}`
}

export function readReminderButton(id: string): { action: ReminderAction; bookingId: string } | null {
  if (!id.startsWith(REMINDER_PREFIX)) return null
  const [action, bookingId] = id.slice(REMINDER_PREFIX.length).split(":")
  if (!bookingId) return null
  return (["confirm", "move", "cancel"] as const).includes(action as ReminderAction)
    ? { action: action as ReminderAction, bookingId }
    : null
}

/**
 * Which of the two reminders this is. The names are the two columns a meeting
 * carries (`remindedDayAt`, `remindedHourAt`), not the hours: how far ahead
 * each one goes out is the organization's setting, and 24 and 2 are only the
 * defaults it starts from.
 */
export type ReminderKind = "day" | "hour"

export interface ReminderRun {
  kind: ReminderKind
  leadMinutes: number
  openMinutes: number
}

/**
 * How far ahead to look, and how much slack to allow.
 *
 * The slack is what makes a late job still useful, and it cannot be one fixed
 * number once the hours are configurable: six hours of drift on a reminder
 * set for three hours before would fire it as the client walks in. So each
 * window is a share of its own lead — a quarter for the earlier reminder, a
 * half for the later one — capped where it was before this was a setting, so
 * the defaults (24 and 2 hours) produce exactly the old six hours and one.
 */
export function reminderWindow(kind: ReminderKind, hours: number): ReminderRun {
  const leadMinutes = Math.max(1, Math.round(hours * 60))
  const share = kind === "day" ? leadMinutes / 4 : leadMinutes / 2
  const cap = kind === "day" ? 6 * 60 : 60
  // Never below a quarter hour: the job runs on a schedule, and a window
  // narrower than the gap between runs skips meetings silently.
  return { kind, leadMinutes, openMinutes: Math.max(15, Math.min(cap, Math.round(share))) }
}

/**
 * The reminders this organization actually sends, earliest first. An hour of
 * `null` means the salon turned that one off — there is nothing to send and
 * nothing to mark, so the meeting simply never gets it.
 */
export function plannedReminders(schedule: ReminderSchedule): ReminderRun[] {
  const runs: ReminderRun[] = []
  if (schedule.firstHours !== null) runs.push(reminderWindow("day", schedule.firstHours))
  if (schedule.secondHours !== null) runs.push(reminderWindow("hour", schedule.secondHours))
  return runs
}

const WORDS = {
  // Neither line names an hour: how far ahead each reminder goes out is the
  // salon's setting now, and «tomorrow» on a reminder set for three hours
  // before is a lie. The exact day and time follow on the next line anyway.
  az: {
    day: "Yazılışınızı xatırladırıq.", hour: "Tezliklə sizi gözləyirik.",
    confirm: "Gəlirəm", move: "Vaxtı dəyişmək", cancel: "Ləğv etmək",
    footer: "Bir düyməyə toxunun", thanks: "Gözləyirik ✅",
    cancelled: "Yazılışınız ləğv edildi. İstədiyiniz vaxt yenidən yaza bilərsiniz.",
  },
  ru: {
    day: "Напоминаем о вашей записи.", hour: "Скоро ждём вас.",
    confirm: "Приду", move: "Перенести", cancel: "Отменить",
    footer: "Нажмите кнопку", thanks: "Ждём вас ✅",
    cancelled: "Запись отменена. Напишите, когда будет удобно записаться снова.",
  },
  en: {
    day: "A reminder about your visit.", hour: "We're expecting you soon.",
    confirm: "Coming", move: "Reschedule", cancel: "Cancel",
    footer: "Tap a button", thanks: "See you ✅",
    cancelled: "Your booking is cancelled. Write to us whenever you'd like another time.",
  },
} as const

export interface ReminderBooking {
  id: string
  startsAt: Date
  phone: string
  name: string
  snapshot: Prisma.JsonValue | null
  bookingPageId: string
}

function languageOf(snapshot: Prisma.JsonValue | null): ReplyLanguage {
  const value = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : null
  return value?.locale === "ru" || value?.locale === "en" ? value.locale : "az"
}

/**
 * Is the client's last inbound message recent enough for an ordinary reply?
 * Meta allows free-form text for 24 hours after it; outside that only an
 * approved template may be sent.
 */
async function windowOpen(orgId: string, phone: string, now: Date): Promise<boolean> {
  const digits = phoneDigits(phone)
  const since = new Date(now.getTime() - 24 * 3600_000)
  const inbound = await prisma.channelMessage.findFirst({
    where: {
      organizationId: orgId, channelType: "whatsapp", direction: "inbound",
      // Imported history opens no Cloud API window (lib/whatsapp-history-import).
      historyImportedAt: null,
      createdAt: { gt: since },
      metadata: { path: ["waPhone"], equals: digits },
    },
    select: { id: true },
  })
  return Boolean(inbound)
}

export type ReminderOutcome = "sent" | "template_missing" | "failed"

/**
 * One reminder for one meeting. Returns what happened so the caller can mark
 * the booking only when the client actually has it — a reminder recorded but
 * never delivered is worse than none, because nobody chases it.
 */
export async function sendReminder(input: {
  organizationId: string
  booking: ReminderBooking
  kind: ReminderKind
  now?: Date
}): Promise<ReminderOutcome> {
  const now = input.now ?? new Date()
  const organization = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { settings: true } })
  const setting = readWhatsAppBookingSetting(organization?.settings)
  const { timezone } = await orgContext(input.organizationId)
  const language = languageOf(input.booking.snapshot)
  const words = WORDS[language]
  const page = await prisma.bookingPage.findFirst({
    where: { organizationId: input.organizationId, id: input.booking.bookingPageId },
    select: { title: true, price: true, priceCurrency: true },
  })
  const host = await prisma.booking.findFirst({ where: { id: input.booking.id }, select: { hostUser: { select: { name: true } } } })
  const when = `${dayLabel(input.booking.startsAt.toISOString(), language, timezone)}, ${clock(input.booking.startsAt.toISOString(), timezone)}`
  const price = servicePriceLabel(page === null ? null : { price: page.price === null ? null : String(page.price), priceCurrency: page.priceCurrency }, language)
  const what = [page?.title, host?.hostUser?.name, price].filter(Boolean).join(" · ")
  const buttons: WhatsAppReplyButton[] = (["confirm", "move", "cancel"] as const)
    .map((action) => ({ id: reminderButtonId(action, input.booking.id), title: words[action] }))

  if (await windowOpen(input.organizationId, input.booking.phone, now)) {
    const sent = await sendWhatsAppButtons({
      to: input.booking.phone, body: `${words[input.kind]}\n${when} — ${what}.`, footer: words.footer, buttons,
      organizationId: input.organizationId, channelConfigId: setting.channelConfigId,
      extraMetadata: { bookingReminder: input.kind, bookingId: input.booking.id },
    })
    return sent.success ? "sent" : "failed"
  }

  // Outside the window only an approved template can reach them, and its
  // buttons are part of the template Meta approved — we only fill the text.
  const template = setting.reminderTemplate
  if (!template) return "template_missing"
  const sent = await sendWhatsAppTemplate({
    to: input.booking.phone, templateName: template, languageCode: language,
    variables: [input.booking.name || "", when, what],
    organizationId: input.organizationId, channelConfigId: setting.channelConfigId,
  })
  return sent.success ? "sent" : "failed"
}

/** The thank-you after «coming», and the word after a cancellation. */
export function reminderReply(language: ReplyLanguage, action: "confirm" | "cancel"): string {
  return action === "confirm" ? WORDS[language].thanks : WORDS[language].cancelled
}

export { WORDS as REMINDER_WORDS }
