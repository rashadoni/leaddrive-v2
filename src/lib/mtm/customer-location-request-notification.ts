import { defaultLocale, locales, type Locale } from "@/i18n/routing"

/**
 * «Клиент здесь»: what a manager is told the moment an agent asks for a
 * customer's pin to be moved.
 *
 * The owner, 2026-10-12, after sending the first request from a phone and
 * finding nothing but a «1» on a tab of the routes page: «уведомление где
 * теперь для менеджера… оно должно быть заметным… агент может быть рядом с
 * клиентом, и чтоб долго не ждать».
 *
 * Pure: the bell (a client component) and the sender both read this file.
 */

/** `Notification.entityType` of the row; mapped to the MTM module in the notification taxonomy. */
export const MTM_LOCATION_REQUEST_NOTIFICATION_ENTITY = "mtm_location_request"
export const MTM_LOCATION_REQUEST_NOTIFICATION_KIND = "mtm.locationRequest.submitted"
/** The queue itself: the request is decided there, on a map, not on a card of its own. */
export const MTM_LOCATION_REQUEST_NOTIFICATION_URL = "/mtm/routes?view=approvals"
/**
 * How long the pop-up stays on a manager's screen. An ordinary one is gone in
 * four seconds; this one waits for a person who may have looked away.
 */
export const MTM_LOCATION_REQUEST_TOAST_MS = 120_000

function distance(locale: Locale, meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} ${locale === "ru" ? "м" : "m"}`
  const km = (Math.round(meters / 100) / 10).toFixed(1)
  return locale === "en" ? `${km} km` : `${km.replace(".", ",")} ${locale === "ru" ? "км" : "km"}`
}

const TEXT: Record<Locale, {
  title: string
  moved: (agent: string, customer: string, far: string) => string
  noPin: (agent: string, customer: string) => string
  // «Заранее» (owner, 2026-11-04): proposed from wherever the agent is, not at the door.
  movedRemote: (agent: string, customer: string, far: string) => string
  noPinRemote: (agent: string, customer: string) => string
  // Only the street address is corrected; the pin stays.
  addressOnly: (agent: string, customer: string, address: string) => string
  addressOnlyRemote: (agent: string, customer: string, address: string) => string
  // Appended when the pin moves and the address is corrected too.
  newAddress: (address: string) => string
  decide: string
}> = {
  ru: {
    title: "Адрес клиента: агент ждёт решения",
    moved: (agent, customer, far) => `${agent} у клиента «${customer}» и сообщает, что точка стоит не там — в ${far} от прежней.`,
    noPin: (agent, customer) => `${agent} у клиента «${customer}»: точки на карте не было, агент показал, где клиент.`,
    movedRemote: (agent, customer, far) => `${agent} заранее, не с места, сообщает, что клиент «${customer}» теперь в ${far} от прежней точки.`,
    noPinRemote: (agent, customer) => `${agent} заранее, не с места, показал на карте, где клиент «${customer}»: точки не было.`,
    addressOnly: (agent, customer, address) => `${agent} у клиента «${customer}» и предлагает исправить адрес: «${address}».`,
    addressOnlyRemote: (agent, customer, address) => `${agent} предлагает исправить адрес клиента «${customer}»: «${address}».`,
    newAddress: (address) => `Новый адрес: «${address}».`,
    decide: "Примите новое место или оставьте как было.",
  },
  en: {
    title: "Customer address: an agent is waiting for a decision",
    moved: (agent, customer, far) => `${agent} is at «${customer}» and reports that the pin is in the wrong place — ${far} from where it stands.`,
    noPin: (agent, customer) => `${agent} is at «${customer}»: it had no pin on the map, and the agent has shown where it is.`,
    movedRemote: (agent, customer, far) => `${agent} reports in advance, not from the spot, that «${customer}» is now ${far} from its pin.`,
    noPinRemote: (agent, customer) => `${agent} has shown on the map, in advance and not from the spot, where «${customer}» is: it had no pin.`,
    addressOnly: (agent, customer, address) => `${agent} is at «${customer}» and proposes a corrected address: «${address}».`,
    addressOnlyRemote: (agent, customer, address) => `${agent} proposes a corrected address for «${customer}»: «${address}».`,
    newAddress: (address) => `New address: «${address}».`,
    decide: "Accept the new place or keep the old one.",
  },
  az: {
    title: "Müştəri ünvanı: agent qərar gözləyir",
    moved: (agent, customer, far) => `${agent} «${customer}» müştərisinin yanındadır və nöqtənin yerində olmadığını bildirir — əvvəlkindən ${far} aralıda.`,
    noPin: (agent, customer) => `${agent} «${customer}» müştərisinin yanındadır: xəritədə nöqtə yox idi, agent müştərinin yerini göstərdi.`,
    movedRemote: (agent, customer, far) => `${agent} əvvəlcədən, yerində olmadan bildirir ki, «${customer}» müştərisi indi əvvəlki nöqtədən ${far} aralıdadır.`,
    noPinRemote: (agent, customer) => `${agent} əvvəlcədən, yerində olmadan «${customer}» müştərisinin yerini xəritədə göstərdi: nöqtə yox idi.`,
    addressOnly: (agent, customer, address) => `${agent} «${customer}» müştərisinin yanındadır və ünvanı düzəltməyi təklif edir: «${address}».`,
    addressOnlyRemote: (agent, customer, address) => `${agent} «${customer}» müştərisinin ünvanını düzəltməyi təklif edir: «${address}».`,
    newAddress: (address) => `Yeni ünvan: «${address}».`,
    decide: "Yeni yeri qəbul edin və ya olduğu kimi saxlayın.",
  },
}

export function locationRequestNotificationLocale(preferredLanguage: string | null | undefined): Locale {
  return locales.includes(preferredLanguage as Locale) ? (preferredLanguage as Locale) : defaultLocale
}

/**
 * The text of one recipient's notification, in that recipient's language.
 * `movedMeters` is null when the customer had no pin at all; 0 when only the
 * address is corrected and the pin stays.
 */
export function locationRequestNotificationText(
  preferredLanguage: string | null | undefined,
  input: {
    agentName: string
    customerName: string
    movedMeters: number | null
    origin?: "ON_SITE" | "REMOTE"
    proposedAddress?: string | null
  },
): { title: string; message: string } {
  const locale = locationRequestNotificationLocale(preferredLanguage)
  const text = TEXT[locale]
  const remote = input.origin === "REMOTE"
  const address = input.proposedAddress?.trim() || null
  let message: string
  if (address && input.movedMeters === 0) {
    message = (remote ? text.addressOnlyRemote : text.addressOnly)(input.agentName, input.customerName, address)
  } else {
    message = input.movedMeters === null
      ? (remote ? text.noPinRemote : text.noPin)(input.agentName, input.customerName)
      : (remote ? text.movedRemote : text.moved)(input.agentName, input.customerName, distance(locale, input.movedMeters))
    if (address) message += ` ${text.newAddress(address)}`
  }
  return { title: text.title, message: `${message} ${text.decide}` }
}
