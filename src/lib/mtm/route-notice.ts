/**
 * What the agent reads when his route is published or changed (owner,
 * 2026-11-01, step 1 of the plan from the FleetFlow reel: «Сотрудник получит
 * новый порядок в приложении»). Until then the bell said «Route updated —
 * Route for 2026-11-05 was changed.» in English to every agent, and no push
 * came: he learnt of a new order when he happened to open the day.
 *
 * His own language, the day in words and how many visits — never a client's
 * name, since a push shows on a locked screen.
 */
type Locale = "az" | "ru" | "en"

const COPY: Record<Locale, {
  intl: string
  published: (day: string) => string
  updated: (day: string) => string
  visits: (count: number) => string
  open: string
}> = {
  az: {
    intl: "az-AZ",
    published: (day) => `Marşrut hazırdır: ${day}`,
    updated: (day) => `Marşrut dəyişdi: ${day}`,
    visits: (count) => `${count} vizit`,
    open: "Tətbiqdə açın.",
  },
  ru: {
    intl: "ru-RU",
    published: (day) => `Маршрут на ${day} готов`,
    updated: (day) => `Маршрут на ${day} изменён`,
    visits: (count) => {
      const tens = count % 100
      const ones = count % 10
      const word = tens >= 11 && tens <= 14 ? "визитов" : ones === 1 ? "визит" : ones >= 2 && ones <= 4 ? "визита" : "визитов"
      return `${count} ${word}`
    },
    open: "Откройте маршрут в приложении.",
  },
  en: {
    intl: "en-GB",
    published: (day) => `Route for ${day} is ready`,
    updated: (day) => `Route for ${day} changed`,
    visits: (count) => `${count} ${count === 1 ? "visit" : "visits"}`,
    open: "Open it in the app.",
  },
}

export function routeNoticeLocale(value: string | null | undefined): Locale {
  return value === "ru" || value === "en" ? value : "az"
}

/** The route events whose words this module writes; other route notices keep their own. */
export const ROUTE_NOTICE_EVENTS = ["route_published", "route_updated"] as const
export type RouteNoticeEvent = (typeof ROUTE_NOTICE_EVENTS)[number]

export function isRouteNoticeEvent(value: unknown): value is RouteNoticeEvent {
  return typeof value === "string" && (ROUTE_NOTICE_EVENTS as readonly string[]).includes(value)
}

/**
 * «Маршрут на 5 ноября изменён» · «8 визитов. Откройте маршрут в приложении.»
 * `routeDate` is the route's calendar day (a date column: midnight UTC).
 */
export function routeNotice(input: { locale: Locale; event: RouteNoticeEvent; routeDate: Date; visitCount: number }): { title: string; body: string } {
  const copy = COPY[input.locale]
  const day = new Intl.DateTimeFormat(copy.intl, { day: "numeric", month: "long", timeZone: "UTC" }).format(input.routeDate)
  const title = input.event === "route_published" ? copy.published(day) : copy.updated(day)
  const body = input.visitCount > 0 ? `${copy.visits(input.visitCount)}. ${copy.open}` : copy.open
  return { title, body }
}
