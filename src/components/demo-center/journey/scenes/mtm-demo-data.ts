/**
 * The Route & Field module's invented field team.
 *
 * A pharmaceutical field team in Baku: a manager, five medical
 * representatives, the clinics and pharmacies they visit and the doctors
 * there. Every person, place and figure is made up for the demo; coordinates
 * are plain points in Baku, not anybody's address. The shapes are the
 * product's own (`import type` only — nothing here reaches a tenant), so the
 * product's MTM components draw them exactly as they draw a live team.
 *
 * One day: a Thursday — the latest one on or before the session's day in
 * Baku. A visitor at night or at the weekend still sees a working day with a
 * working day after it, and the week has three days behind it. The day runs
 * on two clocks: 12:10, while it is under way (today, the plan, the live map,
 * the visits), and the evening, when the manager looks back at its road
 * (`mtm-demo-day.ts`). What either clock shows is one list of facts read at
 * that hour, so every time on every screen agrees. Screens say «nümunə gün».
 */
import type { MtmDashboardAgent } from "@/lib/mtm-types"
import type { VisitReviewData } from "@/app/(dashboard)/mtm/visits/visit-review-panel"
import { evaluateCustomerLocationRequest } from "@/lib/mtm/customer-location-request"
import type { ExplainableKpiFact, ExplainableKpiPlanPoint } from "@/lib/mtm/explainable-kpi"
import type { RouteStop } from "@/components/mtm/live-map"
import type { LiveMapDayStep } from "@/lib/mtm/live-map-day-steps"
import type { MtmPanelAttention } from "@/lib/mtm/panel-attention"
import type { RoutePlannerCandidate } from "@/lib/mtm/route-planner"
import type { VisitPlaceInput } from "@/lib/mtm/visit-place-check"
import type { LiveMapClient } from "@/lib/mtm/live-map-clients"
import { mtmDemoDrivePosition, type MtmDemoDrive } from "./mtm-demo-motion"
import type { MtmDemoRoadId } from "./mtm-demo-roads"

export const MTM_DEMO_TIMEZONE = "Asia/Baku"
/** Baku keeps UTC+4 all year. */
const BAKU_OFFSET_MINUTES = 4 * 60
const MINUTE = 60_000

/** The demo day's date key (YYYY-MM-DD): the latest Thursday on or before the session's day in Baku. */
export function mtmDemoToday(startedAt: string): string {
  const at = new Date(Date.parse(startedAt) + BAKU_OFFSET_MINUTES * MINUTE)
  if (Number.isNaN(at.getTime())) return "2026-10-15"
  const back = (at.getUTCDay() - 4 + 7) % 7
  return addDays(at.toISOString().slice(0, 10), -back)
}

/** An instant on the demo day, given as Baku wall-clock time. */
export function mtmDemoAt(today: string, hhmm: string, dayOffset = 0): string {
  const [hours, minutes] = hhmm.split(":").map(Number)
  const midnight = Date.parse(`${today}T00:00:00.000Z`) + dayOffset * 24 * 60 * MINUTE
  return new Date(midnight + (hours * 60 + minutes - BAKU_OFFSET_MINUTES) * MINUTE).toISOString()
}

/** The demo's «now» while the day is under way: 12:10 in Baku on the demo day. */
export const MTM_DEMO_CLOCK = "12:10"
/** The evening the manager reads the day's road at. */
export const MTM_DEMO_EVENING = "18:40"

export function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T12:00:00.000Z`) + days * 24 * 60 * MINUTE).toISOString().slice(0, 10)
}

export const MTM_DEMO_MANAGER = "Səbinə Rzayeva"

export type MtmDemoAgentStatus = "CHECKED_IN" | "ON_ROAD" | "STOPPED" | "LATE" | "PAUSED"

export interface MtmDemoAgent {
  readonly id: string
  readonly name: string
  readonly status: MtmDemoAgentStatus
  /** Absent on a break: where somebody spends it is not recorded (owner's rule). */
  readonly latitude?: number
  readonly longitude?: number
  /** A visit opened on an earlier day and never closed: the product lets no new one start until it is (MTM_VISIT_ALREADY_ACTIVE). */
  readonly openVisit?: { readonly place: string; readonly at: string; readonly dayOffset: number }
  /** On a break: the phone's last point before it (Baku time) and when the break began. Nothing is recorded after. */
  readonly beforeBreak?: { readonly latitude: number; readonly longitude: number; readonly at: string; readonly pausedAt: string }
  readonly team: "center" | "south"
  /** Phone battery, %. */
  readonly battery: number
  /** Today's route: stops done, stops planned. */
  readonly visited: number
  readonly total: number
  /** Monday to Wednesday of this week: points done / planned. Today (Thursday) is `visited` / `total`. */
  readonly week: ReadonlyArray<readonly [number, number]>
  /** Last week, Monday to Friday: points done / planned. */
  readonly lastWeek: readonly [number, number]
  /** Minutes the status has lasted (in a visit, standing, late). */
  readonly forMinutes: number
  readonly where: string
  readonly mapColor: string
  /** On the way: the street he drives along, and when (Baku time). His point on the map follows it. */
  readonly drive?: { readonly road: MtmDemoRoadId; readonly departs: string; readonly arrives: string }
}

export const MTM_DEMO_AGENTS: readonly MtmDemoAgent[] = [
  {
    id: "agent-elvin", name: "Elvin Qasımov", status: "CHECKED_IN", latitude: 40.40935, longitude: 49.86708,
    visited: 3, total: 6, week: [[6, 6], [6, 6], [6, 6]], lastWeek: [29, 30], forMinutes: 18,
    where: "Şəfa Tibb Mərkəzi", mapColor: "green", team: "center", battery: 78,
  },
  {
    // Left Aptek 24 at 12:04, on her way to Aptek Sağlam in Əhmədli (due 12:40).
    id: "agent-nermin", name: "Nərmin Hüseynli", status: "ON_ROAD",
    drive: { road: "apt24ToSaglam", departs: "12:04", arrives: "12:36" },
    visited: 4, total: 6, week: [[6, 6], [5, 6], [6, 6]], lastWeek: [27, 30], forMinutes: 6,
    where: "Aptek Sağlam — Əhmədli istiqamətində", mapColor: "blue", team: "center", battery: 64,
  },
  {
    // Yesterday's visit at Xətai Tibb Mərkəzi is still open, so today he cannot check in anywhere.
    id: "agent-tural", name: "Tural Babayev", status: "CHECKED_IN", latitude: 40.39860, longitude: 49.83470,
    openVisit: { place: "pl-xetai", at: "16:40", dayOffset: -1 },
    visited: 0, total: 5, week: [[4, 5], [4, 5], [5, 5]], lastWeek: [19, 25], forMinutes: 22,
    where: "Xətai Tibb Mərkəzi — dünəndən açıq vizit", mapColor: "amber", team: "center", battery: 51,
  },
  {
    // Her route is under way (one stop of five), so the product never calls her «late» — that is a
    // published route still untouched after the organization's hour (`deriveMtmLiveFieldStatus`).
    // She has stood near Dəniz Stomatologiya since 11:35, the time she was due there: «Dayanıb».
    id: "agent-aysu", name: "Aysu Kərimli", status: "STOPPED", latitude: 40.37490, longitude: 49.83180,
    visited: 1, total: 5, week: [[5, 6], [4, 6], [5, 6]], lastWeek: [23, 30], forMinutes: 35,
    where: "Dəniz Stomatologiya yaxınlığında dayanıb", mapColor: "red", team: "south", battery: 33,
  },
  {
    id: "agent-rauf", name: "Rauf Əhmədli", status: "PAUSED",
    beforeBreak: { latitude: 40.41690, longitude: 49.91470, at: "11:53", pausedAt: "11:55" },
    visited: 3, total: 6, week: [[6, 6], [6, 6], [5, 6]], lastWeek: [28, 30], forMinutes: 15,
    where: "", mapColor: "violet", team: "south", battery: 46,
  },
]

/** This week so far, today included: the finished days and today's route as it stands. */
export function mtmDemoWeekSoFar(agent: MtmDemoAgent): { done: number; planned: number; days: Array<readonly [number, number]> } {
  const days = [...agent.week, [agent.visited, agent.total] as const]
  return { done: days.reduce((sum, [done]) => sum + done, 0), planned: days.reduce((sum, [, planned]) => sum + planned, 0), days }
}

const MTM_DEMO_TEAMS = {
  center: { teamId: "team-center", teamName: "Bakı — Mərkəz" },
  south: { teamId: "team-south", teamName: "Bakı — Cənub" },
} as const

/**
 * The live map's roster, in the shape the product's live-map API answers
 * with (`MtmDashboardAgent`). The statuses are what the server derives
 * (`deriveMtmLiveFieldStatus`): somebody on a break sends no points, so his
 * signal goes stale and the row reads «GPS aktiv deyil», his workday
 * «dayandırılıb», and the only coordinate there is is the one from before the
 * break — which the page draws grey as «the phone's last signal, not where he
 * is now».
 *
 * `atMs` is the moment the roster answers for: the live map asks again every
 * thirty seconds, so the phones' last signals move on with it, and somebody on
 * the way is further along his street.
 */
export function mtmDemoRosterAgents(today: string, atMs = Date.parse(mtmDemoAt(today, MTM_DEMO_CLOCK))): MtmDashboardAgent[] {
  const clock = atMs
  // How long a status has lasted is counted from the sample's noon; later answers do not move its start.
  const noon = Date.parse(mtmDemoAt(today, MTM_DEMO_CLOCK))
  return MTM_DEMO_AGENTS.map((agent) => {
    const common = {
      agentId: agent.id,
      name: agent.name,
      // The server learns of the app only from the points it stores (`lastSeenAt`), and a phone on a
      // break stores none: past five minutes of it the app reads «Şəbəkədə deyil» too.
      isOnline: !agent.beforeBreak,
      lastSeenAt: agent.beforeBreak ? mtmDemoAt(today, agent.beforeBreak.at) : new Date(clock - MINUTE).toISOString(),
      ...MTM_DEMO_TEAMS[agent.team],
      managerId: "manager-sebine",
      managerName: MTM_DEMO_MANAGER,
      tags: [],
      mapColor: agent.mapColor,
      battery: agent.battery,
      routeCompletion: Math.round((agent.visited / agent.total) * 100),
      routeVisited: agent.visited,
      routeTotal: agent.total,
      workdayDate: today,
      workdayStartedAt: mtmDemoAt(today, "09:02"),
      locationState: "AVAILABLE" as const,
    }
    if (agent.status === "PAUSED") {
      const before = agent.beforeBreak!
      return {
        ...common,
        fieldStatus: "OFFLINE",
        freshness: "STALE" as const,
        workdayState: "PAUSED" as const,
        workdayPausedAt: mtmDemoAt(today, before.pausedAt),
        latitude: before.latitude,
        longitude: before.longitude,
        accuracy: 12,
        recordedAt: mtmDemoAt(today, before.at),
      }
    }
    const position = agent.drive ? mtmDemoDrivePosition(mtmDemoAgentDrive(today, agent)!, clock - MINUTE) : { latitude: agent.latitude, longitude: agent.longitude }
    return {
      ...common,
      fieldStatus: agent.status,
      freshness: "ONLINE" as const,
      workdayState: "ACTIVE" as const,
      latitude: position.latitude,
      longitude: position.longitude,
      accuracy: 9,
      speed: agent.status === "ON_ROAD" ? 8 : 0,
      recordedAt: new Date(clock - MINUTE).toISOString(),
      openVisitSince: agent.status !== "CHECKED_IN" ? null
        : agent.openVisit ? mtmDemoAt(today, agent.openVisit.at, agent.openVisit.dayOffset)
          : new Date(noon - agent.forMinutes * MINUTE).toISOString(),
      stationarySince: agent.status === "STOPPED" ? new Date(noon - agent.forMinutes * MINUTE).toISOString() : null,
    }
  })
}

/** Somebody's drive as instants on the demo day. */
export function mtmDemoAgentDrive(today: string, agent: MtmDemoAgent): MtmDemoDrive | null {
  if (!agent.drive) return null
  return { road: agent.drive.road, departsMs: Date.parse(mtmDemoAt(today, agent.drive.departs)), arrivesMs: Date.parse(mtmDemoAt(today, agent.drive.arrives)) }
}

export interface MtmDemoPlace {
  readonly id: string
  readonly name: string
  readonly address: string
  readonly latitude: number
  readonly longitude: number
  readonly category: "A" | "B" | "C" | "VIP"
  /**
   * The organization itself is visited (a pharmacy), or the doctors listed.
   * `earlierThisMonth` counts the checked-out visits of this month before
   * today; today's own visits (`HOME_DAY`) are added to it wherever the
   * month is counted (`mtmDemoPlannerCandidates`), as the product counts them.
   */
  readonly doctors: ReadonlyArray<{ readonly id: string; readonly name: string; readonly specialty: string; readonly earlierThisMonth: number }>
  readonly earlierThisMonth: number
}

/** Clinics and pharmacies of the invented base. Orange on the planner: nobody there seen this month, today included. */
export const MTM_DEMO_PLACES: readonly MtmDemoPlace[] = [
  { id: "pl-nar", name: "Nar Klinika", address: "Yasamal r., Şərifzadə küç. 14", latitude: 40.37840, longitude: 49.84910, category: "A", earlierThisMonth: 0,
    doctors: [{ id: "dr-abbasova", name: "Dr. Leyla Abbasova", specialty: "Kardioloq", earlierThisMonth: 1 }, { id: "dr-mammadov", name: "Dr. Orxan Məmmədov", specialty: "Terapevt", earlierThisMonth: 0 }] },
  { id: "pl-sefa", name: "Şəfa Tibb Mərkəzi", address: "Nərimanov r., Təbriz küç. 52", latitude: 40.40930, longitude: 49.86710, category: "VIP", earlierThisMonth: 0,
    doctors: [{ id: "dr-quliyeva", name: "Dr. Sevinc Quliyeva", specialty: "Endokrinoloq", earlierThisMonth: 1 }, { id: "dr-hasanov", name: "Dr. Kamran Həsənov", specialty: "Nevroloq", earlierThisMonth: 0 }] },
  // This morning Rauf saw Dr. Məlikov and Elvin Dr. Səmədova here; Dr. Əliyeva is still to be seen this month.
  { id: "pl-respublika", name: "Respublika Diaqnostika", address: "Yasamal r., Ş. Mehdiyev küç. 9", latitude: 40.38600, longitude: 49.82850, category: "B", earlierThisMonth: 0,
    doctors: [
      { id: "dr-aliyeva", name: "Dr. Günay Əliyeva", specialty: "Terapevt", earlierThisMonth: 0 },
      { id: "dr-melikov", name: "Dr. Elçin Məlikov", specialty: "Uroloq", earlierThisMonth: 0 },
      { id: "dr-semedova", name: "Dr. Arzu Səmədova", specialty: "Kardioloq", earlierThisMonth: 0 },
    ] },
  { id: "pl-usaq", name: "Bakı Uşaq Klinikası", address: "Nəsimi r., Səməd Vurğun küç. 31", latitude: 40.41300, longitude: 49.84100, category: "A", earlierThisMonth: 0,
    doctors: [{ id: "dr-rustamova", name: "Dr. Aynur Rüstəmova", specialty: "Pediatr", earlierThisMonth: 0 }, { id: "dr-nabiyev", name: "Dr. Fərid Nəbiyev", specialty: "Pediatr", earlierThisMonth: 1 }] },
  { id: "pl-xetai", name: "Xətai Tibb Mərkəzi", address: "Xətai r., Babək pr. 18", latitude: 40.38300, longitude: 49.92400, category: "B", earlierThisMonth: 0,
    doctors: [{ id: "dr-ismayilov", name: "Dr. Rəşad İsmayılov", specialty: "Kardioloq", earlierThisMonth: 0 }] },
  { id: "pl-deniz", name: "Dəniz Stomatologiya", address: "Səbail r., Neftçilər pr. 61", latitude: 40.37200, longitude: 49.83700, category: "C", earlierThisMonth: 0,
    doctors: [{ id: "dr-kazimova", name: "Dr. Nigar Kazımova", specialty: "Stomatoloq", earlierThisMonth: 1 }] },
  { id: "pl-aile5", name: "Ailə Poliklinikası №5", address: "Nərimanov r., Ziya Bünyadov pr. 7", latitude: 40.41700, longitude: 49.91500, category: "B", earlierThisMonth: 0,
    doctors: [{ id: "dr-huseynova", name: "Dr. Ülviyyə Hüseynova", specialty: "Ailə həkimi", earlierThisMonth: 0 }, { id: "dr-qedirov", name: "Dr. Ramil Qədirov", specialty: "Ailə həkimi", earlierThisMonth: 0 }] },
  { id: "pl-apt24", name: "Aptek 24 — Gənclik", address: "Nərimanov r., Atatürk pr. 40", latitude: 40.40050, longitude: 49.85100, category: "A", earlierThisMonth: 0, doctors: [] },
  { id: "pl-aptplus", name: "Aptek Plus — 28 May", address: "Nəsimi r., 28 May küç. 3", latitude: 40.37970, longitude: 49.85160, category: "B", earlierThisMonth: 0, doctors: [] },
  { id: "pl-aptderman", name: "Aptek Dərman — Nəsimi", address: "Nəsimi r., Füzuli küç. 66", latitude: 40.39200, longitude: 49.84100, category: "C", earlierThisMonth: 0, doctors: [] },
  { id: "pl-aptsaglam", name: "Aptek Sağlam — Əhmədli", address: "Xətai r., Əhmədli, Q. Qarayev pr. 12", latitude: 40.38700, longitude: 49.95300, category: "C", earlierThisMonth: 0, doctors: [] },
  // Nərmin saw Dr. Vəliyev here this morning and Rauf Dr. Orucova; Dr. Cavadova is still to be seen.
  { id: "pl-yasamal", name: "Yasamal Ailə Klinikası", address: "Yasamal r., İnşaatçılar pr. 21", latitude: 40.39600, longitude: 49.81900, category: "A", earlierThisMonth: 0,
    doctors: [
      { id: "dr-cavadova", name: "Dr. Səbinə Cavadova", specialty: "Ginekoloq", earlierThisMonth: 0 },
      { id: "dr-veliyev", name: "Dr. Kənan Vəliyev", specialty: "Pediatr", earlierThisMonth: 0 },
      { id: "dr-orucova", name: "Dr. Lamiyə Orucova", specialty: "Terapevt", earlierThisMonth: 0 },
    ] },
]

/** Where Aptek 24 really is: Nərmin's «Müştəri buradadır» (`mtmDemoPlaceRequest`). */
const APT24_PROPOSED = { latitude: 40.40238, longitude: 49.85322 } as const

/**
 * The base as it stands: once the manager approved Nərmin's request, Aptek 24
 * is where she showed it to be, on every screen after.
 */
function placesAsOf(placeApproved: boolean): readonly MtmDemoPlace[] {
  return placeApproved ? MTM_DEMO_PLACES.map((place) => (place.id === "pl-apt24" ? { ...place, ...APT24_PROPOSED } : place)) : MTM_DEMO_PLACES
}

/**
 * The client base on the live map's «Müştərilər» layer, in the shape its
 * answer has (`LiveMapClient`): every clinic and pharmacy, its class, its zone.
 */
export function mtmDemoMapClients(placeApproved = false): LiveMapClient[] {
  return placesAsOf(placeApproved).map((place) => ({
    id: place.id,
    name: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    category: place.category,
    objectType: place.doctors.length === 0 ? "PHARMACY" : "CLINIC",
    geofenceRadius: 100,
  }))
}

/**
 * The planner's candidates — the product's shape: a pharmacy as itself, a
 * clinic as its doctors. The month is counted as the product's candidates
 * answer counts it (`/api/v1/mtm/routes/candidates?period=MONTH`): every
 * checked-out visit this month by any agent — a pharmacy's visits, a doctor's
 * own — so the visits of this very morning count too. Aptek 24, where Nərmin
 * was at 11:50, is no longer «not visited this month».
 */
export function mtmDemoPlannerCandidates(placeApproved = false): RoutePlannerCandidate[] {
  const today = mtmDemoCheckedOutToday()
  const seenToday = (placeId: string, contactId: string | null) => today.filter((visit) => visit.place === placeId && (contactId === null || visit.contact === contactId)).length
  return placesAsOf(placeApproved).flatMap((place): RoutePlannerCandidate[] => {
    const base = { customerId: place.id, placeName: place.name, address: place.address, category: place.category, latitude: place.latitude, longitude: place.longitude, lastVisitAt: null }
    if (place.doctors.length === 0) {
      return [{ ...base, key: place.id, contactId: null, name: place.name, specialtyName: null, monthlyVisitCount: place.earlierThisMonth + seenToday(place.id, null) }]
    }
    return place.doctors.map((doctor) => ({
      ...base,
      key: `${place.id}:${doctor.id}`,
      contactId: doctor.id,
      name: doctor.name,
      specialtyName: doctor.specialty,
      monthlyVisitCount: doctor.earlierThisMonth + seenToday(place.id, doctor.id),
    }))
  })
}

/** Today's visits checked out by the demo's clock, with whom (a clinic's doctor). */
function mtmDemoCheckedOutToday(): Array<{ place: string; contact: string | null }> {
  return Object.values(HOME_DAY).flatMap((day) => day.visits.filter((visit) => visit.checkOut).map((visit) => ({ place: visit.place, contact: visit.contact ?? null })))
}

/** Who the planner plans for: the agent with no route for the next working day («Qərar gözləyir»). */
export const MTM_DEMO_PLAN_AGENT = "agent-aysu"

/**
 * Elvin's whole day as it happened (Baku time). A screen reads it at its own
 * clock (`elvinDayAt`): at 12:10 he is in Şəfa since 11:52 and the afternoon
 * is still a plan; in the evening every stop is done.
 */
export const MTM_DEMO_ELVIN_DAY: ReadonlyArray<{ readonly place: string; readonly contact?: string; readonly planned: string; readonly checkIn: string; readonly checkOut: string }> = [
  { place: "pl-nar", contact: "dr-abbasova", planned: "09:30", checkIn: "09:34", checkOut: "09:58" },
  { place: "pl-aptplus", planned: "10:00", checkIn: "10:07", checkOut: "10:51" },
  { place: "pl-respublika", contact: "dr-semedova", planned: "11:00", checkIn: "11:08", checkOut: "11:29" },
  { place: "pl-sefa", contact: "dr-quliyeva", planned: "12:00", checkIn: "11:52", checkOut: "12:24" },
  { place: "pl-usaq", contact: "dr-nabiyev", planned: "13:30", checkIn: "13:24", checkOut: "13:52" },
  { place: "pl-aptderman", planned: "14:30", checkIn: "14:08", checkOut: "14:31" },
]

/** The day as it stands at `clock`: what has not happened yet is not there. */
function elvinDayAt(clock: string): ReadonlyArray<{ place: string; contact?: string; planned: string; checkIn?: string; checkOut?: string }> {
  return MTM_DEMO_ELVIN_DAY.map((stop) => ({
    place: stop.place,
    contact: stop.contact,
    planned: stop.planned,
    checkIn: stop.checkIn <= clock ? stop.checkIn : undefined,
    checkOut: stop.checkOut <= clock ? stop.checkOut : undefined,
  }))
}

const ELVIN_DAY = elvinDayAt(MTM_DEMO_CLOCK)

export function mtmDemoPlace(id: string): MtmDemoPlace {
  return MTM_DEMO_PLACES.find((place) => place.id === id)!
}
const placeOf = mtmDemoPlace

/** Elvin's day on the live map: the product's route-stop shape. */
export function mtmDemoElvinRoute(today: string): RouteStop[] {
  return ELVIN_DAY.map((stop, index) => {
    const place = placeOf(stop.place)
    const status: RouteStop["status"] = stop.checkOut ? "VISITED" : stop.checkIn ? "NEXT" : "PENDING"
    return {
      orderIndex: index,
      status,
      latitude: place.latitude,
      longitude: place.longitude,
      name: place.name,
      address: place.address,
      plannedTime: stop.planned,
      checkInAt: stop.checkIn ? mtmDemoAt(today, stop.checkIn) : null,
      checkOutAt: stop.checkOut ? mtmDemoAt(today, stop.checkOut) : null,
      zoneRadiusMeters: 100,
    }
  })
}

/** The same day, step by step, as «День по шагам» lists it. */
export function mtmDemoElvinSteps(today: string): LiveMapDayStep[] {
  let nextTaken = false
  return ELVIN_DAY.map((stop, index) => {
    const place = placeOf(stop.place)
    const minutes = stop.checkIn && stop.checkOut
      ? (Date.parse(mtmDemoAt(today, stop.checkOut)) - Date.parse(mtmDemoAt(today, stop.checkIn))) / MINUTE
      : null
    let state: LiveMapDayStep["state"]
    if (stop.checkIn && !stop.checkOut) state = "IN_VISIT"
    else if (stop.checkOut) state = "VISITED"
    else if (!nextTaken) {
      state = "NEXT"
      nextTaken = true
    } else state = "PLANNED"
    return {
      pointId: `elvin-${index}`,
      orderIndex: index,
      sequence: index + 1,
      name: place.name,
      state,
      onMap: true,
      plannedTime: mtmDemoAt(today, stop.planned),
      checkInAt: stop.checkIn ? mtmDemoAt(today, stop.checkIn) : null,
      checkOutAt: stop.checkOut ? mtmDemoAt(today, stop.checkOut) : null,
      durationMinutes: minutes,
      startedLateMinutes: null,
      overdueMinutes: null,
      visitId: null,
    }
  })
}

/** «Ждёт решения» on the home screen: the product's shape. */
export function mtmDemoAttention(today: string): MtmPanelAttention {
  const monday = addDays(today, -((new Date(`${today}T12:00:00.000Z`).getUTCDay() + 6) % 7))
  const week = Array.from({ length: 7 }, (_, index) => ({ date: addDays(monday, index), isWorkingDay: index < 5 }))
  return {
    timezone: MTM_DEMO_TIMEZONE,
    today,
    generatedAt: mtmDemoAt(today, MTM_DEMO_CLOCK),
    todayIsWorkingDay: true,
    week,
    items: [
      { kind: "customerLocationRequests", count: 1, date: today, people: ["Nərmin Hüseynli"], peopleCount: 1, types: [], since: mtmDemoPlaceRequest(today).sentAt },
      { kind: "contactCreateRequests", count: 2, date: addDays(today, -1), people: ["Tural Babayev", "Aysu Kərimli"], peopleCount: 2, types: [] },
      { kind: "photosPendingReview", count: 7, date: today, people: ["Elvin Qasımov", "Nərmin Hüseynli"], peopleCount: 3, types: [] },
    ],
    nextWorkday: { date: addDays(today, 1), agents: 5, withoutRoute: 1, agentId: MTM_DEMO_PLAN_AGENT, people: ["Aysu Kərimli"] },
  }
}

/** The visit whose proof the module shows: Elvin at Nar Klinika this morning. */
export function mtmDemoVisit(today: string) {
  const place = placeOf("pl-nar")
  const input: VisitPlaceInput = {
    status: "CHECKED_OUT",
    // 38 m and 41 m from the clinic's pin, inside its 100 m zone.
    checkInLat: 40.37874, checkInLng: 49.84905,
    checkOutLat: 40.37877, checkOutLng: 49.84918,
    checkInCustomerLat: place.latitude, checkInCustomerLng: place.longitude, checkInGeofenceRadius: 100,
  }
  return {
    agent: "Elvin Qasımov",
    place: place.name,
    address: place.address,
    doctor: "Dr. Leyla Abbasova",
    specialty: "Kardioloq",
    checkInAt: mtmDemoAt(today, "09:34"),
    checkOutAt: mtmDemoAt(today, "09:58"),
    placeInput: input,
    photos: [
      { id: "ph-1", url: "/icons/demo-mtm/visit-shelf.svg", createdAt: mtmDemoAt(today, "09:41") },
      { id: "ph-2", url: "/icons/demo-mtm/visit-stand.svg", createdAt: mtmDemoAt(today, "09:44") },
      { id: "ph-3", url: "/icons/demo-mtm/visit-samples.svg", createdAt: mtmDemoAt(today, "09:52") },
    ],
    presentation: { title: "Kardioloji xətt — 2026" },
    note: "Həkim yeni preparat üçün nümunə istədi; növbəti vizitdə klinik məlumatları gətirmək.",
  }
}

/** The product's own signature evidence: one stroke path of the commands the card draws (M, L, Q, C). */
const DEMO_SIGNATURE_PATH = "M34 72 C 48 30, 62 30, 66 60 C 70 80, 84 88, 96 50 C 104 26, 112 30, 118 58 C 124 82, 138 74, 146 52 C 152 36, 160 40, 166 60 C 172 80, 190 66, 204 48 C 214 36, 226 42, 236 56 C 246 70, 262 64, 286 44"

/**
 * Elvin's first visit of the day, in the shape the visit review API
 * answers with, for the product's own review card (`VisitReviewView`).
 * What it records is what the product records: that the presentation file was
 * opened and which pages, not that the doctor looked at it.
 */
export function mtmDemoVisitReview(today: string): VisitReviewData {
  const visit = mtmDemoVisit(today)
  const place = placeOf("pl-nar")
  const at = (hhmm: string) => mtmDemoAt(today, hhmm)
  return {
    visit: {
      id: "visit-elvin-nar",
      agentId: "agent-elvin",
      status: "CHECKED_OUT",
      checkInAt: visit.checkInAt,
      checkOutAt: visit.checkOutAt,
      duration: 24,
      checkInLat: visit.placeInput.checkInLat ?? null,
      checkInLng: visit.placeInput.checkInLng ?? null,
      checkOutLat: visit.placeInput.checkOutLat ?? null,
      checkOutLng: visit.placeInput.checkOutLng ?? null,
      checkInCustomerLat: place.latitude,
      checkInCustomerLng: place.longitude,
      checkInGeofenceRadius: 100,
      locationRequest: null,
      notes: visit.note,
      outcome: "SUCCESSFUL",
      potential: "HIGH",
      resultNotes: "Nümunələr verildi; klinik məlumatlar növbəti vizitdə.",
      nextActionDueAt: mtmDemoAt(addDays(today, 7), "10:00"),
      agent: { id: "agent-elvin", name: visit.agent },
      customer: { id: place.id, name: place.name, address: place.address, city: "Bakı", latitude: place.latitude, longitude: place.longitude, geofenceRadius: 100 },
      contact: { id: "dr-abbasova", displayName: visit.doctor },
      route: { id: "route-elvin", name: null, date: today },
      routePoint: { id: "rp-elvin-1", orderIndex: 0 },
      requirementSnapshot: {
        requirements: [
          { id: "req-photo", actionKey: "PHOTO", mode: "REQUIRED", minCount: 1 },
          { id: "req-presentation", actionKey: "PRESENTATION", mode: "OPTIONAL", minCount: 1 },
          { id: "req-signature", actionKey: "SIGNATURE", mode: "REQUIRED", minCount: 1 },
        ],
      },
      actionResults: [
        { id: "ar-photo", actionKey: "PHOTO", status: "COMPLETED", evidence: null, completedAt: at("09:52") },
        { id: "ar-presentation", actionKey: "PRESENTATION", status: "COMPLETED", evidence: null, completedAt: at("09:51") },
        { id: "ar-signature", actionKey: "SIGNATURE", status: "COMPLETED", evidence: { svgPath: DEMO_SIGNATURE_PATH, widthPx: 320, heightPx: 110, signerName: visit.doctor, signedAt: at("09:56") }, completedAt: at("09:56") },
      ],
      presentationSessions: [{
        id: "ps-kardio",
        openedAt: at("09:44"),
        lastViewedAt: at("09:51"),
        closedAt: at("09:51"),
        activeDurationSeconds: 7 * 60,
        openLat: 40.37872, openLng: 49.84907, closeLat: 40.37874, closeLng: 49.84909,
        pageCount: 12,
        lastPage: 6,
        pagesViewed: [1, 2, 3, 4, 5, 6],
        pageEvents: null,
        presentationVersion: "2026.1",
        product: { id: "prod-kardio", name: "Kardioloji xətt", group: { id: "group-kardio", name: "Kardiologiya" } },
        document: { id: "doc-kardio", title: visit.presentation.title, fileName: "kardioloji-xett-2026.pdf", mimeType: "application/pdf" },
      }],
      photos: visit.photos.map((photo) => ({ id: photo.id, url: photo.url, thumbnailUrl: null, status: "PENDING_REVIEW", createdAt: photo.createdAt })),
      photoCount: visit.photos.length,
    },
    geofenceRadius: 100,
    openTasks: { count: 1, items: [{ id: "task-kardio", title: "Klinik məlumatları Dr. Leyla Abbasovaya aparmaq", priority: "MEDIUM", dueDate: mtmDemoAt(addDays(today, 7), "10:00") }] },
    timezone: MTM_DEMO_TIMEZONE,
    viewer: { canExecute: false },
  }
}

/** A visit the agent began yesterday and never closed. */
export function mtmDemoLeftOpen(today: string) {
  return { agentId: "agent-tural", agent: "Tural Babayev", place: "Xətai Tibb Mərkəzi", doctor: "Dr. Rəşad İsmayılov", since: mtmDemoAt(today, "16:40", -1) }
}

/**
 * «Клиент здесь»: at the pharmacy's door Nərmin found its pin on the wrong
 * side of the avenue, so at 11:48 she sent where it really is, and at 11:50
 * checked in there. The product lets such a check-in in and ties it to the
 * waiting request only when the request was there first
 * (`waitingLocationRequestCovers`, src/lib/mtm/check-in-geofence.ts): that is
 * what makes the card's «Agent artıq bu yerdən vizit qeyd edib» and its
 * re-count on «Təsdiqlə» true. The distances are the product's own check
 * (`evaluateCustomerLocationRequest`), not typed in.
 */
export function mtmDemoPlaceRequest(today: string) {
  const place = placeOf("pl-apt24")
  const sentAt = mtmDemoAt(today, "11:48")
  const proposed = { ...APT24_PROPOSED }
  const agentFix = { latitude: 40.40242, longitude: 49.85317, accuracyMeters: 12 }
  const verdict = evaluateCustomerLocationRequest(
    { proposed, agent: { ...agentFix, fixAgeSeconds: 20 } },
    { latitude: place.latitude, longitude: place.longitude },
    new Date(sentAt),
  )
  if (!verdict.ok) throw new Error(`demo request refused: ${verdict.problem}`)
  return {
    agent: "Nərmin Hüseynli",
    customer: place.name,
    address: place.address,
    sentAt,
    previous: { latitude: place.latitude, longitude: place.longitude },
    proposed,
    agentFix,
    /** Straight-line metres between the old pin and the proposed one. */
    movedMeters: verdict.facts.movedMeters ?? 0,
    agentToProposedMeters: verdict.facts.agentToProposedMeters,
    /** She checked in from this very spot after sending it: approving re-counts that visit inside the zone. */
    checkedInFromHereAt: mtmDemoAt(today, HOME_DAY["agent-nermin"].visits.find((visit) => visit.place === place.id)!.checkIn),
    outsideVisitsHere90Days: 2,
    comment: "Aptek prospektin o biri tərəfindədir, giriş Atatürk pr. 40-dan.",
  }
}

/**
 * Each agent's day on «Bu gün»: the stops done and where he goes next (Baku
 * time). At a clinic a visit is to one of its doctors (`contact`), as the
 * planner's month counts it.
 */
const HOME_DAY: Record<string, { visits: ReadonlyArray<{ place: string; contact?: string; checkIn: string; checkOut?: string }>; next?: { place: string; planned: string } }> = {
  "agent-elvin": { visits: ELVIN_DAY.filter((stop) => stop.checkIn).map((stop) => ({ place: stop.place, contact: stop.contact, checkIn: stop.checkIn!, checkOut: stop.checkOut })) },
  "agent-nermin": {
    visits: [
      { place: "pl-yasamal", contact: "dr-veliyev", checkIn: "09:20", checkOut: "09:41" },
      { place: "pl-aile5", contact: "dr-huseynova", checkIn: "10:05", checkOut: "10:26" },
      { place: "pl-xetai", contact: "dr-ismayilov", checkIn: "10:50", checkOut: "11:12" },
      // At the door at 11:48 she sent «Müştəri buradadır» (mtmDemoPlaceRequest); the check-in, 280 m
      // from the old pin, was let in two minutes later because it was made at the place she named.
      { place: "pl-apt24", checkIn: "11:50", checkOut: "12:02" },
    ],
    next: { place: "pl-aptsaglam", planned: "12:40" },
  },
  // No visit today: yesterday's is still open (mtmDemoLeftOpen).
  "agent-tural": { visits: [], next: { place: "pl-usaq", planned: "09:30" } },
  "agent-aysu": { visits: [{ place: "pl-aptplus", checkIn: "09:50", checkOut: "10:12" }], next: { place: "pl-deniz", planned: "11:35" } },
  "agent-rauf": {
    visits: [
      { place: "pl-respublika", contact: "dr-melikov", checkIn: "09:25", checkOut: "09:49" },
      { place: "pl-yasamal", contact: "dr-orucova", checkIn: "10:30", checkOut: "10:52" },
      { place: "pl-aile5", contact: "dr-qedirov", checkIn: "11:31", checkOut: "11:50" },
    ],
    next: { place: "pl-xetai", planned: "12:40" },
  },
}

/**
 * «Bu gün» in the shapes the product's three answers have: today's team
 * rows, the week's plan points and visits (the same facts «Nəticələr»
 * counts), and the lower row's base and visit quality. The figures on the
 * screen are the product's own arithmetic over them
 * (`src/lib/mtm/home-dashboard.ts`).
 */
export function mtmDemoHome(today: string) {
  const clock = Date.parse(mtmDemoAt(today, MTM_DEMO_CLOCK))
  const monday = addDays(today, -((new Date(`${today}T12:00:00.000Z`).getUTCDay() + 6) % 7))
  const rows = MTM_DEMO_AGENTS.map((agent) => {
    const day = HOME_DAY[agent.id]
    const visits = day.visits.map((visit) => ({
      customerName: placeOf(visit.place).name,
      status: visit.checkOut ? "CHECKED_OUT" : "CHECKED_IN",
      checkInAt: mtmDemoAt(today, visit.checkIn),
      checkOutAt: visit.checkOut ? mtmDemoAt(today, visit.checkOut) : null,
    }))
    return {
      agentId: agent.id,
      name: agent.name,
      teamName: MTM_DEMO_TEAMS[agent.team].teamName,
      lastGpsAt: agent.beforeBreak ? mtmDemoAt(today, agent.beforeBreak.at) : new Date(clock - MINUTE).toISOString(),
      route: { visited: agent.visited, total: agent.total },
      visits,
      visitCount: visits.length,
      openAlerts: 0,
      workday: agent.beforeBreak
        ? { kind: "paused" as const, since: mtmDemoAt(today, agent.beforeBreak.pausedAt) }
        : { kind: "working" as const, since: mtmDemoAt(today, "09:02") },
      nextStop: day.next && !visits.some((visit) => visit.status === "CHECKED_IN")
        ? { customerName: placeOf(day.next.place).name, plannedAt: mtmDemoAt(today, day.next.planned) }
        : null,
    }
  })

  // The week's plan points and visits, Monday to today, as «Результаты» counts them.
  const planPoints: Array<{ agentId: string; date: string; completed: boolean }> = []
  const factVisits: Array<{ agentId: string; date: string; gpsConfirmed: boolean }> = []
  for (const agent of MTM_DEMO_AGENTS) {
    const days = mtmDemoWeekSoFar(agent).days
    days.forEach(([done, planned], index) => {
      const date = addDays(monday, index)
      for (let point = 0; point < planned; point += 1) planPoints.push({ agentId: agent.id, date, completed: point < done })
      for (let visit = 0; visit < done; visit += 1) factVisits.push({ agentId: agent.id, date, gpsConfirmed: visit !== 1 || agent.id !== "agent-tural" })
    })
  }
  // The same days of last week (Monday to Thursday), for «than last week».
  const previous = MTM_DEMO_AGENTS.reduce((sum, agent) => ({
    planned: sum.planned + Math.round((agent.lastWeek[1] * 4) / 5),
    done: sum.done + Math.round((agent.lastWeek[0] * 4) / 5),
  }), { planned: 0, done: 0 })

  const recentVisits = rows
    .flatMap((row) => row.visits.map((visit) => ({
      id: `${row.agentId}:${visit.checkInAt}`,
      at: visit.checkInAt!,
      customerName: visit.customerName,
      agentName: row.name,
      durationMinutes: visit.checkOutAt ? Math.round((Date.parse(visit.checkOutAt) - Date.parse(visit.checkInAt!)) / MINUTE) : null,
      flag: null,
    })))
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 5)

  return {
    rows,
    facts: { planPoints, visits: factVisits },
    previous,
    recentVisits,
    monthStart: `${today.slice(0, 8)}01`,
    base: {
      subject: "contacts" as const,
      byClass: [
        { key: "VIP", total: 12, visited: 11 },
        { key: "A", total: 46, visited: 34 },
        { key: "B", total: 71, visited: 39 },
        { key: "C", total: 58, visited: 16 },
      ],
      secondary: [],
      classOrder: ["VIP", "A", "B", "C", "D"],
    },
    quality: { visits: 64, atPlace: 58, awayFromPlace: 4, placeUnknown: 2, withPhoto: 55, tooLong: 2, tooShort: 1, longMinutes: 60, shortMinutes: 2 },
  }
}

export interface MtmDemoHistoryVisit {
  readonly id: string
  readonly agentId: string
  readonly agent: string
  readonly customer: string
  readonly address: string
  readonly status: "CHECKED_IN" | "CHECKED_OUT"
  /** The clinic's doctor the visit was to; null at a pharmacy. */
  readonly contactId: string | null
  readonly checkInAt: string
  readonly checkOutAt: string | null
  readonly duration: number | null
  readonly place: VisitPlaceInput
  /** «Ünvan yoxlanılır»: the agent reported this customer's pin as wrong, from this visit's spot. */
  readonly locationRequest: "SUBMITTED" | null
}

/** A point a few dozen metres from a pin, inside its 100 m zone: where the phone checked in, the `seed`-th visit of the day. */
export function mtmDemoNearPlace(place: MtmDemoPlace, seed: number): { latitude: number; longitude: number } {
  return { latitude: place.latitude + 0.00022 + (seed % 3) * 0.00006, longitude: place.longitude - 0.00018 + (seed % 2) * 0.0001 }
}

/** Today's visits, newest first, as «Ziyarət tarixçəsi» lists them — the same days «Bu gün» counts. */
export function mtmDemoVisitHistory(today: string): MtmDemoHistoryVisit[] {
  const request = mtmDemoPlaceRequest(today)
  return MTM_DEMO_AGENTS.flatMap((agent) => HOME_DAY[agent.id].visits.map((visit, index) => {
    const place = placeOf(visit.place)
    // Nərmin's Aptek 24 visit was checked in where the pharmacy really is, 280 m from its pin.
    const reported = agent.id === "agent-nermin" && visit.place === "pl-apt24"
    // Elvin's first visit is the one «Vizitlər» opens: the same fixes as its review card.
    const reviewed = agent.id === "agent-elvin" && visit.place === "pl-nar" ? mtmDemoVisit(today).placeInput : null
    const fix = reported ? request.agentFix : reviewed ? { latitude: reviewed.checkInLat!, longitude: reviewed.checkInLng! } : mtmDemoNearPlace(place, index)
    const checkInAt = mtmDemoAt(today, visit.checkIn)
    const checkOutAt = visit.checkOut ? mtmDemoAt(today, visit.checkOut) : null
    return {
      id: `visit-${agent.id}-${index}`,
      agentId: agent.id,
      agent: agent.name,
      customer: place.name,
      address: place.address,
      status: checkOutAt ? "CHECKED_OUT" as const : "CHECKED_IN" as const,
      contactId: visit.contact ?? null,
      checkInAt,
      checkOutAt,
      duration: checkOutAt ? Math.round((Date.parse(checkOutAt) - Date.parse(checkInAt)) / MINUTE) : null,
      place: {
        status: checkOutAt ? "CHECKED_OUT" : "CHECKED_IN",
        checkInLat: fix.latitude, checkInLng: fix.longitude,
        checkOutLat: checkOutAt ? fix.latitude + 0.00003 : null, checkOutLng: checkOutAt ? fix.longitude + 0.00002 : null,
        checkInCustomerLat: place.latitude, checkInCustomerLng: place.longitude, checkInGeofenceRadius: 100,
      },
      locationRequest: reported ? "SUBMITTED" as const : null,
    }
  })).sort((left, right) => right.checkInAt.localeCompare(left.checkInAt))
}

/**
 * The plan points and visits of the last five weeks, in the shapes the
 * product's KPI registry counts (`buildExplainableKpi`), so «Nəticələr» shows
 * the product's own numbers for whichever period is picked. This week and
 * today are the days «Bu gün» shows; last week adds up to each agent's
 * `lastWeek`; earlier weeks follow the same habits.
 */
export function mtmDemoKpiFacts(today: string): { planPoints: ExplainableKpiPlanPoint[]; visits: ExplainableKpiFact[] } {
  const monday = addDays(today, -((new Date(`${today}T12:00:00.000Z`).getUTCDay() + 6) % 7))
  const lastMonday = addDays(monday, -7)
  const planPoints: ExplainableKpiPlanPoint[] = []
  const visits: ExplainableKpiFact[] = []
  for (const agent of MTM_DEMO_AGENTS) {
    for (let back = 35; back >= 0; back -= 1) {
      const date = addDays(today, -back)
      const weekday = (new Date(`${date}T12:00:00.000Z`).getUTCDay() + 6) % 7
      if (weekday > 4) continue
      let planned: number
      let done: number
      if (date === today) {
        planned = agent.total
        done = agent.visited
      } else if (date >= monday) {
        ;[done, planned] = agent.week[weekday]
      } else if (date >= lastMonday) {
        // Last week's totals spread over its five days, the remainder on the first ones.
        planned = Math.floor(agent.lastWeek[1] / 5) + (weekday < agent.lastWeek[1] % 5 ? 1 : 0)
        const missed = agent.lastWeek[1] - agent.lastWeek[0]
        done = planned - (weekday < missed ? 1 : 0) - (weekday + 5 < missed ? 1 : 0)
      } else {
        planned = agent.total
        const ratio = agent.lastWeek[0] / agent.lastWeek[1]
        done = Math.max(0, Math.min(planned, Math.round(planned * ratio + ((back * 7 + agent.id.length) % 3 === 0 ? -1 : 0))))
      }
      for (let index = 0; index < planned; index += 1) {
        const place = MTM_DEMO_PLACES[(index + back + agent.id.length) % MTM_DEMO_PLACES.length]
        const id = `${agent.id}:${date}:${index}`
        const completed = index < done
        planPoints.push({ routePointId: `rp-${id}`, routeId: `route-${agent.id}:${date}`, agentId: agent.id, agentName: agent.name, customerId: place.id, customerName: place.name, contactId: null, date, visitType: "INDEPENDENT", brandIds: [], completed })
        if (completed) {
          // One visit in fifteen lacks the check-out fix; the rest carry both.
          const gpsConfirmed = (back + index + agent.id.length) % 15 !== 0
          visits.push({ visitId: `v-${id}`, agentId: agent.id, agentName: agent.name, customerId: place.id, customerName: place.name, contactId: null, routePointId: `rp-${id}`, date, visitType: "INDEPENDENT", brandIds: [], completed: true, gpsConfirmed })
        }
      }
    }
  }
  return { planPoints, visits }
}
