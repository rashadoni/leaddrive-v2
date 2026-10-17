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
 * One fixed clock: a Thursday at 12:10 Baku time — the latest one on or
 * before the session's day. A visitor at night or at the weekend still sees a
 * working day in progress with a working day after it, the week has three
 * days behind it, and every time on every screen agrees. Screens say «nümunə
 * gün».
 */
import type { MtmDashboardAgent } from "@/lib/mtm-types"
import type { RouteStop } from "@/components/mtm/live-map"
import type { LiveMapDayStep } from "@/lib/mtm/live-map-day-steps"
import type { MtmPanelAttention } from "@/lib/mtm/panel-attention"
import type { RoutePlannerCandidate } from "@/lib/mtm/route-planner"
import type { VisitPlaceInput } from "@/lib/mtm/visit-place-check"

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

/** The demo's «now»: 12:10 in Baku on the demo day. */
export const MTM_DEMO_CLOCK = "12:10"

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
}

export const MTM_DEMO_AGENTS: readonly MtmDemoAgent[] = [
  {
    id: "agent-elvin", name: "Elvin Qasımov", status: "CHECKED_IN", latitude: 40.40935, longitude: 49.86708,
    visited: 3, total: 6, week: [[6, 6], [6, 6], [6, 6]], lastWeek: [29, 30], forMinutes: 18,
    where: "Şəfa Tibb Mərkəzi", mapColor: "green", team: "center", battery: 78,
  },
  {
    id: "agent-nermin", name: "Nərmin Hüseynli", status: "ON_ROAD", latitude: 40.39320, longitude: 49.85640,
    visited: 4, total: 6, week: [[6, 6], [5, 6], [6, 6]], lastWeek: [27, 30], forMinutes: 6,
    where: "Aptek 24 — Gənclik istiqamətində", mapColor: "blue", team: "center", battery: 64,
  },
  {
    id: "agent-tural", name: "Tural Babayev", status: "STOPPED", latitude: 40.39860, longitude: 49.83470,
    visited: 2, total: 5, week: [[4, 5], [4, 5], [5, 5]], lastWeek: [19, 25], forMinutes: 22,
    where: "Yasamal, vizitdən kənar", mapColor: "amber", team: "center", battery: 51,
  },
  {
    id: "agent-aysu", name: "Aysu Kərimli", status: "LATE", latitude: 40.37490, longitude: 49.83180,
    visited: 1, total: 5, week: [[5, 6], [4, 6], [5, 6]], lastWeek: [23, 30], forMinutes: 35,
    where: "Dəniz Stomatologiyaya gecikir", mapColor: "red", team: "south", battery: 33,
  },
  {
    id: "agent-rauf", name: "Rauf Əhmədli", status: "PAUSED",
    beforeBreak: { latitude: 40.37810, longitude: 49.87230, at: "11:53", pausedAt: "11:55" },
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
 */
export function mtmDemoRosterAgents(today: string): MtmDashboardAgent[] {
  const clock = Date.parse(mtmDemoAt(today, MTM_DEMO_CLOCK))
  return MTM_DEMO_AGENTS.map((agent) => {
    const common = {
      agentId: agent.id,
      name: agent.name,
      isOnline: true,
      lastSeenAt: new Date(clock - MINUTE).toISOString(),
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
    return {
      ...common,
      fieldStatus: agent.status,
      freshness: "ONLINE" as const,
      workdayState: "ACTIVE" as const,
      latitude: agent.latitude,
      longitude: agent.longitude,
      accuracy: 9,
      speed: agent.status === "ON_ROAD" ? 8 : 0,
      recordedAt: new Date(clock - MINUTE).toISOString(),
      openVisitSince: agent.status === "CHECKED_IN" ? new Date(clock - agent.forMinutes * MINUTE).toISOString() : null,
      stationarySince: agent.status === "STOPPED" ? new Date(clock - agent.forMinutes * MINUTE).toISOString() : null,
    }
  })
}

interface MtmDemoPlace {
  readonly id: string
  readonly name: string
  readonly address: string
  readonly latitude: number
  readonly longitude: number
  readonly category: "A" | "B" | "C" | "VIP"
  /** The organization itself is visited (a pharmacy), or the doctors listed. */
  readonly doctors: ReadonlyArray<{ readonly id: string; readonly name: string; readonly specialty: string; readonly visitsThisMonth: number }>
  readonly visitsThisMonth: number
}

/** Clinics and pharmacies of the invented base. Orange on the planner: nobody there seen this month. */
export const MTM_DEMO_PLACES: readonly MtmDemoPlace[] = [
  { id: "pl-nar", name: "Nar Klinika", address: "Yasamal r., Şərifzadə küç. 14", latitude: 40.37840, longitude: 49.84910, category: "A", visitsThisMonth: 0,
    doctors: [{ id: "dr-abbasova", name: "Dr. Leyla Abbasova", specialty: "Kardioloq", visitsThisMonth: 2 }, { id: "dr-mammadov", name: "Dr. Orxan Məmmədov", specialty: "Terapevt", visitsThisMonth: 0 }] },
  { id: "pl-sefa", name: "Şəfa Tibb Mərkəzi", address: "Nərimanov r., Təbriz küç. 52", latitude: 40.40930, longitude: 49.86710, category: "VIP", visitsThisMonth: 0,
    doctors: [{ id: "dr-quliyeva", name: "Dr. Sevinc Quliyeva", specialty: "Endokrinoloq", visitsThisMonth: 1 }, { id: "dr-hasanov", name: "Dr. Kamran Həsənov", specialty: "Nevroloq", visitsThisMonth: 0 }] },
  { id: "pl-respublika", name: "Respublika Diaqnostika", address: "Yasamal r., Ş. Mehdiyev küç. 9", latitude: 40.38600, longitude: 49.82850, category: "B", visitsThisMonth: 0,
    doctors: [{ id: "dr-aliyeva", name: "Dr. Günay Əliyeva", specialty: "Terapevt", visitsThisMonth: 0 }] },
  { id: "pl-usaq", name: "Bakı Uşaq Klinikası", address: "Nəsimi r., Səməd Vurğun küç. 31", latitude: 40.41300, longitude: 49.84100, category: "A", visitsThisMonth: 0,
    doctors: [{ id: "dr-rustamova", name: "Dr. Aynur Rüstəmova", specialty: "Pediatr", visitsThisMonth: 0 }, { id: "dr-nabiyev", name: "Dr. Fərid Nəbiyev", specialty: "Pediatr", visitsThisMonth: 1 }] },
  { id: "pl-xetai", name: "Xətai Tibb Mərkəzi", address: "Xətai r., Babək pr. 18", latitude: 40.38300, longitude: 49.92400, category: "B", visitsThisMonth: 0,
    doctors: [{ id: "dr-ismayilov", name: "Dr. Rəşad İsmayılov", specialty: "Kardioloq", visitsThisMonth: 0 }] },
  { id: "pl-deniz", name: "Dəniz Stomatologiya", address: "Səbail r., Neftçilər pr. 61", latitude: 40.37200, longitude: 49.83700, category: "C", visitsThisMonth: 1,
    doctors: [{ id: "dr-kazimova", name: "Dr. Nigar Kazımova", specialty: "Stomatoloq", visitsThisMonth: 1 }] },
  { id: "pl-aile5", name: "Ailə Poliklinikası №5", address: "Nərimanov r., Ziya Bünyadov pr. 7", latitude: 40.41700, longitude: 49.91500, category: "B", visitsThisMonth: 0,
    doctors: [{ id: "dr-huseynova", name: "Dr. Ülviyyə Hüseynova", specialty: "Ailə həkimi", visitsThisMonth: 0 }] },
  { id: "pl-apt24", name: "Aptek 24 — Gənclik", address: "Nərimanov r., Atatürk pr. 40", latitude: 40.40050, longitude: 49.85100, category: "A", visitsThisMonth: 0, doctors: [] },
  { id: "pl-aptplus", name: "Aptek Plus — 28 May", address: "Nəsimi r., 28 May küç. 3", latitude: 40.37970, longitude: 49.85160, category: "B", visitsThisMonth: 2, doctors: [] },
  { id: "pl-aptderman", name: "Aptek Dərman — Nəsimi", address: "Nəsimi r., Füzuli küç. 66", latitude: 40.39200, longitude: 49.84100, category: "C", visitsThisMonth: 0, doctors: [] },
  { id: "pl-aptsaglam", name: "Aptek Sağlam — Əhmədli", address: "Xətai r., Əhmədli, Q. Qarayev pr. 12", latitude: 40.38700, longitude: 49.95300, category: "C", visitsThisMonth: 0, doctors: [] },
  { id: "pl-yasamal", name: "Yasamal Ailə Klinikası", address: "Yasamal r., İnşaatçılar pr. 21", latitude: 40.39600, longitude: 49.81900, category: "A", visitsThisMonth: 0,
    doctors: [{ id: "dr-cavadova", name: "Dr. Səbinə Cavadova", specialty: "Ginekoloq", visitsThisMonth: 0 }] },
]

/** The planner's candidates — the product's shape: a pharmacy as itself, a clinic as its doctors. */
export function mtmDemoPlannerCandidates(): RoutePlannerCandidate[] {
  return MTM_DEMO_PLACES.flatMap((place): RoutePlannerCandidate[] => {
    const base = { customerId: place.id, placeName: place.name, address: place.address, category: place.category, latitude: place.latitude, longitude: place.longitude, lastVisitAt: null }
    if (place.doctors.length === 0) {
      return [{ ...base, key: place.id, contactId: null, name: place.name, specialtyName: null, monthlyVisitCount: place.visitsThisMonth }]
    }
    return place.doctors.map((doctor) => ({
      ...base,
      key: `${place.id}:${doctor.id}`,
      contactId: doctor.id,
      name: doctor.name,
      specialtyName: doctor.specialty,
      monthlyVisitCount: doctor.visitsThisMonth,
    }))
  })
}

/** Who the planner plans for: the agent with no route for the next working day («Qərar gözləyir»). */
export const MTM_DEMO_PLAN_AGENT = "agent-aysu"

const ELVIN_DAY: ReadonlyArray<{ place: string; planned: string; checkIn?: string; checkOut?: string }> = [
  { place: "pl-nar", planned: "09:30", checkIn: "09:34", checkOut: "09:58" },
  { place: "pl-aptplus", planned: "10:30", checkIn: "10:36", checkOut: "10:51" },
  { place: "pl-respublika", planned: "11:00", checkIn: "11:08", checkOut: "11:29" },
  { place: "pl-sefa", planned: "12:00", checkIn: "11:52" },
  { place: "pl-usaq", planned: "13:30" },
  { place: "pl-aptderman", planned: "14:30" },
]

function placeOf(id: string): MtmDemoPlace {
  return MTM_DEMO_PLACES.find((place) => place.id === id)!
}

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
      { kind: "customerLocationRequests", count: 1, date: today, people: ["Nərmin Hüseynli"], peopleCount: 1, types: [], since: mtmDemoAt(today, "11:56") },
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
    presentation: { title: "Kardioloji xətt — 2026", slides: 6, minutes: 7 },
    signature: "/icons/demo-mtm/visit-signature.svg",
    note: "Həkim yeni preparat üçün nümunə istədi; növbəti vizitdə klinik məlumatları gətirmək.",
  }
}

/** A visit the agent began yesterday and never closed. */
export function mtmDemoLeftOpen(today: string) {
  return { agentId: "agent-tural", agent: "Tural Babayev", place: "Xətai Tibb Mərkəzi", doctor: "Dr. Rəşad İsmayılov", since: mtmDemoAt(today, "16:40", -1) }
}

/** «Клиент здесь»: Nərmin at the pharmacy, whose pin sits on the wrong side of the avenue. */
export function mtmDemoPlaceRequest(today: string) {
  const place = placeOf("pl-apt24")
  return {
    agent: "Nərmin Hüseynli",
    customer: place.name,
    address: place.address,
    sentAt: mtmDemoAt(today, "11:56"),
    previous: { latitude: place.latitude, longitude: place.longitude },
    proposed: { latitude: 40.40238, longitude: 49.85322 },
    agentFix: { latitude: 40.40242, longitude: 49.85317, accuracyMeters: 12 },
    /** Straight-line metres between the old pin and the proposed one. */
    movedMeters: 280,
    agentToProposedMeters: 6,
    comment: "Aptek prospektin o biri tərəfindədir, giriş Atatürk pr. 40-dan.",
  }
}
