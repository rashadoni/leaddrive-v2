import { calculateDistance } from "@/lib/geo-utils"
import type { Locale } from "@/i18n/routing"
import { mtmAppLanguage } from "@/lib/mtm/agent-language"

/**
 * «Агент едет к вам» — the rules, in one place.
 *
 * Like a taxi: when an agent sets off to the next customer of today's route,
 * the bot sends that customer a link — by SMS or WhatsApp, as the company
 * chose — to a page where the customer sees where the agent is and about
 * when he arrives. When the agent checks in at the customer, the page says
 * «представитель на месте» and shows nothing more.
 *
 * The owner: «ссылку отправляет бот… по умолчанию выключено, включает
 * SaaS-клиент» (2026-10-12); «когда агент выехал» and «выбор SMS или
 * WhatsApp» (2026-11-02, on the mock-up).
 *
 * The link is a «ссылка на местоположение» of its own kind
 * (`purpose = 'CUSTOMER_ETA'` in mtm_location_share_links): the same token,
 * the same public answer, the same rule of what a stranger may be shown
 * (locationShareLinkPositionFor) — on shift, not on a break, a fresh point.
 * What is added here is when a link is sent, to whom, in what words, and
 * when it ends.
 *
 * Pure: the job (customer-eta-link-job.ts) and the public answer read and
 * write, this decides. Every function is given `now`.
 */

export const CUSTOMER_ETA_CHANNELS = ["sms", "whatsapp"] as const
export type CustomerEtaChannel = typeof CUSTOMER_ETA_CHANNELS[number]

export function customerEtaChannel(value: unknown): CustomerEtaChannel {
  return value === "whatsapp" ? "whatsapp" : "sms"
}

/**
 * The WhatsApp template the company has to have approved on its own number.
 * A first message to a customer who has not written goes only as a template
 * (Meta's rule), and a template is the company's to create in WhatsApp
 * Manager — category Utility, in the languages az / ru / en (Meta's codes
 * are the same), four body variables in this order: company, agent, time,
 * link. Meta refuses a body that begins or ends with a variable, so the
 * approved texts open with a greeting and close with a sentence:
 *
 *   az: Salam! {{1}} nümayəndəsi {{2}} sizə tərəf yoldadır. Təxmini gəliş
 *       vaxtı: {{3}}. Harada olduğunu buradan izləyin: {{4}} Link nümayəndə
 *       gələnə qədər işləyir.
 *   ru: Здравствуйте! Представитель {{1}} {{2}} едет к вам. Примерное время
 *       прибытия: {{3}}. Где он сейчас: {{4}} Ссылка работает, пока
 *       представитель не приедет.
 *   en: Hello! Your {{1}} representative {{2}} is on the way. Estimated
 *       arrival: {{3}}. See where they are now: {{4}} The link works until
 *       they arrive.
 *
 * Without it Meta refuses, and the link is marked FAILED with Meta's words.
 *
 * Azerbaijani is the one language the template must have; the others are
 * the company's choice. Zeytun keeps only az (the owner, 2026-11-03: «русский
 * шаблон убери обязательно»), so an agent whose app speaks Russian is sent
 * in Azerbaijani — see customerEtaTemplateLanguageMissing.
 */
export const CUSTOMER_ETA_WHATSAPP_TEMPLATE = "mtm_agent_on_the_way"

/** The language every company's template has, and the one a message falls back to. */
export const CUSTOMER_ETA_TEMPLATE_FALLBACK_LOCALE: Locale = "az"

/**
 * Whether Meta refused because the template has no version in the language
 * asked for — (#132001) «Template name does not exist in the translation».
 * Only that refusal is tried again in Azerbaijani: anything else (a wrong
 * number, a paused template, the network) would fail the same way twice, or
 * worse, reach the customer twice.
 */
export function customerEtaTemplateLanguageMissing(error: unknown): boolean {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : ""
  return /\b132001\b|does not exist in the translation/i.test(text)
}

/** What {{3}} says when the roads gave no time. Meta refuses an empty variable. */
const UNKNOWN_TIME: Record<Locale, string> = { az: "dəqiqləşdirilir", ru: "уточняется", en: "to be confirmed" }

// ─── When a link is sent ────────────────────────────────────────────────────

/**
 * The agent is «on his way» to a stop only from this long before the time it
 * was planned for: the morning a shift starts with a stop planned for the
 * afternoon is not the moment to tell that customer «едет к вам».
 */
export const CUSTOMER_ETA_PLANNED_LEAD_MINUTES = 90

/** Closer than this the agent is not on his way — he is there. */
export const CUSTOMER_ETA_ARRIVED_METERS = 150

/** A trip longer than this by the roads is not «будет примерно в…»: the time is left out. */
export const CUSTOMER_ETA_MAX_TRIP_SECONDS = 3 * 60 * 60

/** A stop of today's route, as much of it as the choice reads. */
export interface CustomerEtaStop {
  id: string
  orderIndex: number
  status: string
  plannedTime: Date | null
}

/**
 * The stop the agent is driving to now, or null.
 *
 * The first stop still PENDING after the last stop he has been to today —
 * so a stop he passed by without a word does not hold every later customer
 * back for the rest of the day. `lastVisitedOrderIndex` is the orderIndex of
 * the stop of his latest visit on this route today, or null before the first.
 */
export function nextCustomerEtaStop(
  stops: readonly CustomerEtaStop[],
  lastVisitedOrderIndex: number | null,
): CustomerEtaStop | null {
  const after = lastVisitedOrderIndex ?? Number.NEGATIVE_INFINITY
  const pending = stops
    .filter((stop) => stop.status === "PENDING" && stop.orderIndex > after)
    .sort((a, b) => a.orderIndex - b.orderIndex)
  return pending[0] ?? null
}

/**
 * Whether the link for this stop goes out now.
 *
 * The job has already established the rest: the company switched it on, the
 * agent is on shift and not on a break, his phone has just reported where he
 * is (the public page would show him), he has no visit open, and this stop
 * has had no link. What is left is whether this is the moment: not long
 * before the stop was planned for, and not when he is already at the door.
 */
export function customerEtaDue(input: {
  stop: Pick<CustomerEtaStop, "plannedTime">
  agent: { latitude: number; longitude: number }
  customer: { latitude: number; longitude: number }
  now: Date
}): boolean {
  const planned = input.stop.plannedTime instanceof Date ? input.stop.plannedTime.getTime() : Number.NaN
  if (Number.isFinite(planned) && input.now.getTime() < planned - CUSTOMER_ETA_PLANNED_LEAD_MINUTES * 60_000) return false
  const meters = calculateDistance(input.agent.latitude, input.agent.longitude, input.customer.latitude, input.customer.longitude)
  return Number.isFinite(meters) && meters >= CUSTOMER_ETA_ARRIVED_METERS
}

/**
 * When he arrives, from the seconds OSRM gives for the trip: rounded up to
 * the next five minutes — «около 11:40», never a minute promised that the
 * traffic will take back. Null when there is no road answer or the trip is
 * implausibly long.
 */
export function customerEtaArrivesAt(tripSeconds: number | null | undefined, now: Date): Date | null {
  if (typeof tripSeconds !== "number" || !Number.isFinite(tripSeconds) || tripSeconds < 0) return null
  if (tripSeconds > CUSTOMER_ETA_MAX_TRIP_SECONDS) return null
  const step = 5 * 60_000
  return new Date(Math.ceil((now.getTime() + tripSeconds * 1000) / step) * step)
}

// ─── To whom ────────────────────────────────────────────────────────────────

export interface CustomerEtaPhones {
  mobilePhone?: string | null
  whatsappPhone?: string | null
  phone?: string | null
  workPhone?: string | null
}

/**
 * The country a number written without one is in: Azerbaijan for a company
 * on Baku time, where «050 111 22 33» is how a mobile is written. Elsewhere
 * nobody here knows, and such a number is not guessed at.
 */
export function customerEtaCountryCode(timezone: string): string | null {
  return timezone === "Asia/Baku" ? "994" : null
}

/**
 * A phone number as a provider takes it — «+» and 8–15 digits — or null.
 * «00…» is the international prefix; «0…» is the national one and becomes
 * the company's country code when it is known. A number that cannot be
 * placed in a country is no number: a message to a guessed one goes to
 * somebody else.
 */
export function customerEtaPhone(value: unknown, countryCode: string | null = null): string | null {
  if (typeof value !== "string") return null
  const written = value.replace(/[\s\-().]/g, "")
  let international: string | null = null
  if (/^\+\d+$/.test(written)) international = written.slice(1)
  else if (/^00\d+$/.test(written)) international = written.slice(2)
  else if (countryCode && /^0\d+$/.test(written)) international = countryCode + written.slice(1)
  else if (countryCode && /^\d+$/.test(written) && written.startsWith(countryCode)) international = written
  return international && /^[1-9]\d{7,14}$/.test(international) ? `+${international}` : null
}

/**
 * The number the message goes to: the stop's contact first (the person the
 * agent is coming to see), then the customer's own phone. For WhatsApp the
 * contact's WhatsApp number comes first; for SMS a mobile.
 */
export function customerEtaRecipient(
  channel: CustomerEtaChannel,
  contact: CustomerEtaPhones | null | undefined,
  customer: { phone?: string | null } | null | undefined,
  countryCode: string | null = null,
): string | null {
  const order = channel === "whatsapp"
    ? [contact?.whatsappPhone, contact?.mobilePhone, contact?.phone, contact?.workPhone, customer?.phone]
    : [contact?.mobilePhone, contact?.whatsappPhone, contact?.phone, contact?.workPhone, customer?.phone]
  for (const candidate of order) {
    const phone = customerEtaPhone(candidate, countryCode)
    if (phone) return phone
  }
  return null
}

// ─── In what words ──────────────────────────────────────────────────────────

/**
 * The customer's language is not known; the agent's is, and the agent speaks
 * with this customer in it. Azerbaijani when the agent's is not one of ours.
 */
export function customerEtaLanguage(agentLanguage: string | null | undefined): Locale {
  return mtmAppLanguage(agentLanguage) ?? "az"
}

const MESSAGES: Record<Locale, { withTime: string; withoutTime: string }> = {
  az: {
    withTime: "{organization}: nümayəndəniz {agent} sizə tərəf yoldadır, təxminən {time} çatacaq. Harada olduğunu buradan görün: {url}",
    withoutTime: "{organization}: nümayəndəniz {agent} sizə tərəf yoldadır. Harada olduğunu buradan görün: {url}",
  },
  ru: {
    withTime: "{organization}: ваш представитель {agent} едет к вам, будет примерно в {time}. Где он сейчас: {url}",
    withoutTime: "{organization}: ваш представитель {agent} едет к вам. Где он сейчас: {url}",
  },
  en: {
    withTime: "{organization}: your representative {agent} is on the way and should arrive around {time}. See where they are: {url}",
    withoutTime: "{organization}: your representative {agent} is on the way. See where they are: {url}",
  },
}

/** The SMS text. `time` is already printed in the company's zone, or null. */
export function customerEtaSmsText(locale: Locale, input: { organization: string; agent: string; time: string | null; url: string }): string {
  const words = MESSAGES[locale] ?? MESSAGES.az
  const template = input.time ? words.withTime : words.withoutTime
  return template
    .replace("{organization}", input.organization.trim())
    .replace("{agent}", input.agent.trim())
    .replace("{time}", input.time ?? "")
    .replace("{url}", input.url)
}

/** The template's four variables, in its order; no time is said in words. */
export function customerEtaWhatsAppVariables(locale: Locale, input: { organization: string; agent: string; time: string | null; url: string }): string[] {
  return [input.organization.trim(), input.agent.trim(), input.time ?? UNKNOWN_TIME[locale] ?? UNKNOWN_TIME.az, input.url]
}

/**
 * What the link's row may keep of a failure: the provider's words, cut short,
 * with every run of digits that could be a phone number taken out.
 */
export function customerEtaFailure(error: unknown): string {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : "failed"
  return text.replace(/\+?\d[\d\s-]{6,}\d/g, "…").slice(0, 200) || "failed"
}
