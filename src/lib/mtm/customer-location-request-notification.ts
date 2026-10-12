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
}> = {
  ru: {
    title: "Адрес клиента: агент ждёт решения",
    moved: (agent, customer, far) => `${agent} у клиента «${customer}» и сообщает, что точка стоит не там — в ${far} от прежней. Примите новое место или оставьте как было.`,
    noPin: (agent, customer) => `${agent} у клиента «${customer}»: точки на карте не было, агент показал, где клиент. Примите новое место или оставьте как было.`,
  },
  en: {
    title: "Customer address: an agent is waiting for a decision",
    moved: (agent, customer, far) => `${agent} is at «${customer}» and reports that the pin is in the wrong place — ${far} from where it stands. Accept the new place or keep the old one.`,
    noPin: (agent, customer) => `${agent} is at «${customer}»: it had no pin on the map, and the agent has shown where it is. Accept the new place or keep it as it was.`,
  },
  az: {
    title: "Müştəri ünvanı: agent qərar gözləyir",
    moved: (agent, customer, far) => `${agent} «${customer}» müştərisinin yanındadır və nöqtənin yerində olmadığını bildirir — əvvəlkindən ${far} aralıda. Yeni yeri qəbul edin və ya olduğu kimi saxlayın.`,
    noPin: (agent, customer) => `${agent} «${customer}» müştərisinin yanındadır: xəritədə nöqtə yox idi, agent müştərinin yerini göstərdi. Yeni yeri qəbul edin və ya olduğu kimi saxlayın.`,
  },
}

export function locationRequestNotificationLocale(preferredLanguage: string | null | undefined): Locale {
  return locales.includes(preferredLanguage as Locale) ? (preferredLanguage as Locale) : defaultLocale
}

/**
 * The text of one recipient's notification, in that recipient's language.
 * `movedMeters` is null when the customer had no pin at all.
 */
export function locationRequestNotificationText(
  preferredLanguage: string | null | undefined,
  input: { agentName: string; customerName: string; movedMeters: number | null },
): { title: string; message: string } {
  const locale = locationRequestNotificationLocale(preferredLanguage)
  const text = TEXT[locale]
  return {
    title: text.title,
    message: input.movedMeters === null
      ? text.noPin(input.agentName, input.customerName)
      : text.moved(input.agentName, input.customerName, distance(locale, input.movedMeters)),
  }
}
