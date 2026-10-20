import { defaultLocale, locales, type Locale } from "@/i18n/routing"

/**
 * «Yeni həkim»: what the people who decide are told the moment an agent asks
 * for a new doctor to be added.
 *
 * The owner, 2026-10-20: «запросы на нового врача от агента не могу найти,
 * куда пришло». The request had waited twelve days: it was saved and showed in
 * the manager's «Təsdiqlər» and above «Müştərilər», but nobody was told it had
 * come.
 *
 * Pure: the bell (a client component), the sender and the phone push read it.
 */

/** `Notification.entityType` of the row; mapped to the MTM module in the notification taxonomy. */
export const MTM_CONTACT_CREATE_REQUEST_NOTIFICATION_ENTITY = "mtm_contact_create_request"
export const MTM_CONTACT_CREATE_REQUEST_NOTIFICATION_KIND = "mtm.contactCreateRequest.submitted"
/** The queue the request is decided in: the top of the clients page. */
export const MTM_CONTACT_CREATE_REQUEST_NOTIFICATION_URL = "/mtm/contacts"

const TEXT: Record<Locale, { title: string; message: (agent: string, doctor: string, clinic: string) => string }> = {
  ru: {
    title: "Новый врач: агент просит добавить",
    message: (agent, doctor, clinic) => `${agent} просит добавить врача «${doctor}»${clinic ? ` (${clinic})` : ""}. Проверьте и одобрите или отклоните.`,
  },
  en: {
    title: "New doctor: an agent asks to add one",
    message: (agent, doctor, clinic) => `${agent} asks to add the doctor «${doctor}»${clinic ? ` (${clinic})` : ""}. Check it and approve or reject.`,
  },
  az: {
    title: "Yeni həkim: agent əlavə etməyi xahiş edir",
    message: (agent, doctor, clinic) => `${agent} «${doctor}» həkimini${clinic ? ` (${clinic})` : ""} əlavə etməyi xahiş edir. Yoxlayın və təsdiq edin və ya rədd edin.`,
  },
}

export function contactCreateRequestNotificationLocale(preferredLanguage: string | null | undefined): Locale {
  return locales.includes(preferredLanguage as Locale) ? (preferredLanguage as Locale) : defaultLocale
}

/** The text of one recipient's notification, in that recipient's language. */
export function contactCreateRequestNotificationText(
  preferredLanguage: string | null | undefined,
  input: { agentName: string; doctorName: string; clinicName: string },
): { title: string; message: string } {
  const text = TEXT[contactCreateRequestNotificationLocale(preferredLanguage)]
  const agent = input.agentName.trim() || "—"
  const doctor = input.doctorName.trim() || "—"
  return { title: text.title, message: text.message(agent, doctor, input.clinicName.trim()) }
}
