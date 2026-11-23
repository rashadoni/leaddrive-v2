import { formatInTimezone, isValidTimezone } from "@/lib/timezone"

/**
 * What a manager reads when his agent acts on his own (owner, 2026-11-23: «пусть
 * все без подтверждения менеджера могли маршрут создавать и даже если вне
 * очереди идут куда то… НО чтоб менеджеру приходило уведомление детальное»).
 *
 * Two texts, on purpose. The bell line is the detail: which clients, where,
 * when. The push says who and how many and nothing about the client, because a
 * push can light up a locked phone in front of anybody (see push-notify.ts).
 *
 * The metadata keys stay away from `routeId`, `visitId`, `customerId` and
 * `distanceMeters`: the app reads those as «your route», «your visit is still
 * open», «you are out of zone» and prints its own title over this one.
 */
export type AgentActivityLocale = "az" | "ru" | "en"

export const AGENT_ACTIVITY_EVENTS = [
  "agent_route_published",
  "agent_route_updated",
  "agent_visit_off_route",
  "agent_visit_out_of_order",
] as const
export type AgentActivityEvent = (typeof AGENT_ACTIVITY_EVENTS)[number]

export function isAgentActivityEvent(value: unknown): value is AgentActivityEvent {
  return typeof value === "string" && (AGENT_ACTIVITY_EVENTS as readonly string[]).includes(value)
}

export interface AgentActivityWords {
  title: string
  body: string
  pushBody: string
}

export interface AgentActivityStop {
  customerName: string
  contactName?: string | null
}

/** A route of a whole day still reads as a list; past this the app is the place. */
const LISTED_STOPS = 20

function russianVisits(count: number): string {
  const tens = count % 100
  const ones = count % 10
  const word = tens >= 11 && tens <= 14 ? "визитов" : ones === 1 ? "визит" : ones >= 2 && ones <= 4 ? "визита" : "визитов"
  return `${count} ${word}`
}

const COPY: Record<AgentActivityLocale, {
  intl: string
  published: (agent: string, day: string) => string
  updated: (agent: string, day: string) => string
  offRoute: (agent: string) => string
  outOfOrder: (agent: string) => string
  visits: (count: number) => string
  now: (visits: string) => string
  added: string
  removed: string
  reordered: string
  more: (count: number) => string
  listInApp: string
  at: (time: string) => string
  detailsInApp: string
  away: (meters: number) => string
  expected: string
}> = {
  az: {
    intl: "az-AZ",
    published: (agent, day) => `${agent}: ${day} üçün yeni marşrut`,
    updated: (agent, day) => `${agent}: ${day} marşrutu dəyişdi`,
    offRoute: (agent) => `${agent}: marşrutdan kənar vizit`,
    outOfOrder: (agent) => `${agent}: növbədən kənar vizit`,
    visits: (count) => `${count} vizit`,
    now: (visits) => `İndi ${visits}`,
    added: "Əlavə",
    removed: "Çıxarılıb",
    reordered: "sıra və ya vaxt dəyişib",
    more: (count) => `və daha ${count}`,
    listInApp: "Siyahı tətbiqdədir.",
    at: (time) => `Saat ${time}.`,
    detailsInApp: "Təfərrüat tətbiqdədir.",
    away: (meters) => `müştəridən ${meters} m`,
    expected: "Növbədə idi",
  },
  ru: {
    intl: "ru-RU",
    published: (agent, day) => `${agent}: новый маршрут на ${day}`,
    updated: (agent, day) => `${agent}: маршрут на ${day} изменён`,
    offRoute: (agent) => `${agent}: визит вне маршрута`,
    outOfOrder: (agent) => `${agent}: визит вне очереди`,
    visits: russianVisits,
    now: (visits) => `Теперь ${visits}`,
    added: "Добавлены",
    removed: "Убраны",
    reordered: "изменён порядок или время",
    more: (count) => `и ещё ${count}`,
    listInApp: "Список в приложении.",
    at: (time) => `В ${time}.`,
    detailsInApp: "Подробности в приложении.",
    away: (meters) => `${meters} м от клиента`,
    expected: "По очереди был",
  },
  en: {
    intl: "en-GB",
    published: (agent, day) => `${agent}: new route for ${day}`,
    updated: (agent, day) => `${agent}: route for ${day} changed`,
    offRoute: (agent) => `${agent}: off-route visit`,
    outOfOrder: (agent) => `${agent}: out-of-order visit`,
    visits: (count) => `${count} ${count === 1 ? "visit" : "visits"}`,
    now: (visits) => `Now ${visits}`,
    added: "Added",
    removed: "Removed",
    reordered: "order or time changed",
    more: (count) => `and ${count} more`,
    listInApp: "The list is in the app.",
    at: (time) => `At ${time}.`,
    detailsInApp: "Details in the app.",
    away: (meters) => `${meters} m from the client`,
    expected: "Next in order was",
  },
}

export function agentActivityLocale(value: string | null | undefined): AgentActivityLocale {
  return value === "ru" || value === "en" ? value : "az"
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

export function agentActivityStopLabel(stop: AgentActivityStop): string {
  const customer = clean(stop.customerName)
  const contact = clean(stop.contactName)
  return contact ? `${contact} (${customer})` : customer
}

function stopList(locale: AgentActivityLocale, stops: readonly AgentActivityStop[]): string {
  const labels = stops.slice(0, LISTED_STOPS).map(agentActivityStopLabel)
  const rest = stops.length - labels.length
  return rest > 0 ? `${labels.join("; ")}; ${COPY[locale].more(rest)}` : labels.join("; ")
}

function routeDay(locale: AgentActivityLocale, routeDate: Date): string {
  // A route's date is a calendar day stored as midnight UTC.
  return new Intl.DateTimeFormat(COPY[locale].intl, { day: "numeric", month: "long", timeZone: "UTC" }).format(routeDate)
}

export function agentRouteNotice(input: {
  locale: AgentActivityLocale
  event: "agent_route_published" | "agent_route_updated"
  agentName: string
  routeDate: Date
  stops: readonly AgentActivityStop[]
  added?: readonly AgentActivityStop[]
  removed?: readonly AgentActivityStop[]
}): AgentActivityWords {
  const copy = COPY[input.locale]
  const day = routeDay(input.locale, input.routeDate)
  const visits = copy.visits(input.stops.length)
  const pushBody = `${visits}. ${copy.listInApp}`
  if (input.event === "agent_route_published") {
    return {
      title: copy.published(input.agentName, day),
      body: `${visits}: ${stopList(input.locale, input.stops)}`,
      pushBody,
    }
  }
  const changes = [
    input.added?.length ? `${copy.added}: ${stopList(input.locale, input.added)}.` : "",
    input.removed?.length ? `${copy.removed}: ${stopList(input.locale, input.removed)}.` : "",
  ].filter(Boolean)
  return {
    title: copy.updated(input.agentName, day),
    body: changes.length > 0
      ? `${copy.now(visits)}. ${changes.join(" ")}`
      : `${copy.now(visits)}, ${copy.reordered}: ${stopList(input.locale, input.stops)}`,
    pushBody,
  }
}

export function agentVisitNotice(input: {
  locale: AgentActivityLocale
  event: "agent_visit_off_route" | "agent_visit_out_of_order"
  agentName: string
  stop: AgentActivityStop
  address?: string | null
  at: Date
  timezone: string
  /** How far from the client's pin the check-in was, when it was outside the zone. */
  distanceMeters?: number | null
  /** The stop that was next in the route, for a visit out of order. */
  expectedStop?: AgentActivityStop | null
}): AgentActivityWords {
  const copy = COPY[input.locale]
  const zone = isValidTimezone(input.timezone) ? input.timezone : "UTC"
  const time = formatInTimezone(input.at, zone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, copy.intl)
  const parts = [agentActivityStopLabel(input.stop), clean(input.address), time]
  if (input.distanceMeters != null && input.distanceMeters > 0) parts.push(copy.away(Math.round(input.distanceMeters)))
  const where = parts.filter(Boolean).join(" · ")
  return {
    title: input.event === "agent_visit_off_route" ? copy.offRoute(input.agentName) : copy.outOfOrder(input.agentName),
    body: input.expectedStop ? `${where}. ${copy.expected}: ${agentActivityStopLabel(input.expectedStop)}` : where,
    pushBody: `${copy.at(time)} ${copy.detailsInApp}`,
  }
}

/** The push of a queued manager notice; null for every other route notice. */
export function agentActivityPush(
  title: string,
  metadata: unknown,
): { title: string; body: string; event: AgentActivityEvent } | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const { event, pushBody } = metadata as Record<string, unknown>
  if (!isAgentActivityEvent(event) || typeof pushBody !== "string" || !pushBody) return null
  return { title, body: pushBody, event }
}
