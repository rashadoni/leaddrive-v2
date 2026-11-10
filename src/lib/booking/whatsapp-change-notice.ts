/**
 * Telling the client on WhatsApp that their visit moved or is off.
 *
 * Until 2026-11-10 a meeting cancelled or rescheduled by the salon reached the
 * client as one e-mail — and only if they had left an address. A client who
 * booked by phone, or over WhatsApp, where the whole conversation lives, was
 * told nothing and turned up at the old hour.
 *
 * Meta's 24-hour rule decides HOW it goes out, exactly as it does for the
 * reminders next door: the client wrote within the last day → an ordinary
 * message; otherwise → an approved template named in the organization's
 * settings. Without that template this cannot be delivered at all, and the
 * meeting says so on its card rather than looking sent.
 *
 * No buttons here on purpose. A reminder asks a question; this one states a
 * fact the salon has already acted on, and «Gəlirəm» under a cancellation
 * would be cruel. The client answers in the conversation, where a person reads
 * it — and after a move, the reminders start again from scratch (commands.ts).
 */
import { bookingDb as prisma } from "./db"
import { sendWhatsAppTemplate, sendWhatsAppText } from "@/lib/whatsapp"
import { orgContext } from "./book"
import { servicePriceLabel } from "./service"
import { clock, dayLabel, type ReplyLanguage } from "./whatsapp-format"
import { readWhatsAppBookingSetting } from "./whatsapp-setting"
import { phoneDigits } from "./whatsapp-reminders"

export type ChangeKind = "cancelled" | "rescheduled"

/** Why nothing was sent, or that it was. The caller records this on the meeting. */
export type ChangeNoticeOutcome = "sent" | "whatsapp_off" | "no_phone" | "template_missing" | "failed"

const WORDS: Record<ReplyLanguage, Record<ChangeKind, string> & { newTime: string }> = {
  az: {
    cancelled: "Görüşünüz ləğv edildi. İstədiyiniz vaxt yenidən yaza bilərsiniz.",
    rescheduled: "Görüşünüzün vaxtı dəyişdi.",
    newTime: "Yeni vaxt",
  },
  ru: {
    cancelled: "Ваша встреча отменена. Вы можете записаться снова в любое время.",
    rescheduled: "Время вашей встречи изменено.",
    newTime: "Новое время",
  },
  en: {
    cancelled: "Your appointment has been cancelled. You are welcome to book again any time.",
    rescheduled: "Your appointment has been moved.",
    newTime: "New time",
  },
}

export { WORDS as CHANGE_NOTICE_WORDS }

function languageOf(snapshot: unknown): ReplyLanguage {
  const value = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : null
  return value?.locale === "ru" || value?.locale === "en" ? value.locale : "az"
}

/** Whether the client wrote to this organization within Meta's 24 hours. */
async function windowOpen(orgId: string, phone: string, now: Date): Promise<boolean> {
  const inbound = await prisma.channelMessage.findFirst({
    where: {
      organizationId: orgId, channelType: "whatsapp", direction: "inbound",
      createdAt: { gt: new Date(now.getTime() - 24 * 3600_000) },
      metadata: { path: ["waPhone"], equals: phoneDigits(phone) },
    },
    select: { id: true },
  })
  return Boolean(inbound)
}

export interface ChangeNoticeBooking {
  id: string
  startsAt: Date
  phone: string
  name: string
  snapshot: unknown
  bookingPageId: string
  hostUserId: string
}

export async function sendChangeNotice(input: {
  organizationId: string
  booking: ChangeNoticeBooking
  kind: ChangeKind
  now?: Date
}): Promise<ChangeNoticeOutcome> {
  const now = input.now ?? new Date()
  if (!input.booking.phone.trim()) return "no_phone"
  const organization = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { settings: true } })
  const setting = readWhatsAppBookingSetting(organization?.settings)
  // The same gate the reminders use: an organization that does not answer on
  // WhatsApp must not start writing to its clients there because a meeting moved.
  if (setting.mode !== "book") return "whatsapp_off"

  const { timezone } = await orgContext(input.organizationId)
  const language = languageOf(input.booking.snapshot)
  const words = WORDS[language]
  const page = await prisma.bookingPage.findFirst({
    where: { organizationId: input.organizationId, id: input.booking.bookingPageId },
    select: { title: true, price: true, priceCurrency: true },
  })
  const host = await prisma.user.findFirst({ where: { organizationId: input.organizationId, id: input.booking.hostUserId }, select: { name: true } })
  const when = `${dayLabel(input.booking.startsAt.toISOString(), language, timezone)}, ${clock(input.booking.startsAt.toISOString(), timezone)}`
  const price = servicePriceLabel(page === null ? null : { price: page.price === null ? null : String(page.price), priceCurrency: page.priceCurrency }, language)
  const what = [page?.title, host?.name, price].filter(Boolean).join(" · ")
  // A cancellation names the hour that is off; a move names the hour that now
  // stands. Either way the client is told a time, never only «something changed».
  const body = input.kind === "cancelled"
    ? `${words.cancelled}\n${when} — ${what}.`
    : `${words.rescheduled}\n${words.newTime}: ${when} — ${what}.`

  if (await windowOpen(input.organizationId, input.booking.phone, now)) {
    const sent = await sendWhatsAppText({
      to: input.booking.phone, body,
      organizationId: input.organizationId, channelConfigId: setting.channelConfigId,
    })
    return sent.success ? "sent" : "failed"
  }

  // Outside the window only an approved template can reach them. Its wording is
  // Meta's to approve; we fill the client's name, the time and the service.
  const template = input.kind === "cancelled" ? setting.cancelTemplate : setting.changeTemplate
  if (!template) return "template_missing"
  const sent = await sendWhatsAppTemplate({
    to: input.booking.phone, templateName: template, languageCode: language,
    variables: [input.booking.name || "", when, what],
    organizationId: input.organizationId, channelConfigId: setting.channelConfigId,
  })
  return sent.success ? "sent" : "failed"
}
