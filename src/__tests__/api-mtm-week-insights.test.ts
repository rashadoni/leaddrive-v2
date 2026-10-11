import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * The lower row of the MTM home screen, over rows kept in memory and filtered
 * through the queries the handler really sends (see mocks/in-memory-rows).
 * The day is Sunday 11 October 2026, 18:54 in Baku; the organization has two
 * agents, north and south, so a manager's scope can be told from the whole.
 */

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }))

import { GET } from "@/app/api/v1/mtm/week/insights/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { checkRateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"
import { serveRows, type Row } from "./mocks/in-memory-rows"

const ORG = "org-zeytun"
const NOW = new Date("2026-10-11T14:54:00.000Z")
const at = (iso: string) => new Date(iso)
const FAR_FUTURE = null

const AGENTS: Row[] = [
  { id: "north", organizationId: ORG, teamId: "t1", team: { regionId: "r1" } },
  { id: "south", organizationId: ORG, teamId: "t2", team: { regionId: "r2" } },
]

// A clinic with a pin, and one without.
const CLINIC = { latitude: 40.4093, longitude: 49.8671, geofenceRadius: null }
const NEAR = { lat: 40.40975, lng: 49.8671 }

/** An assignment that is in force today, as `activeFieldAssignmentWindow` reads it. */
const assigned = (agentId: string) => [{ agentId, effectiveFrom: at("2026-10-03T00:00:00.000Z"), effectiveTo: FAR_FUTURE, endedAt: null, status: "ACTIVE", deletedAt: null }]

function contact(id: string, agentId: string, specialtyName: string, visits: Row[] = [], extra: Row = {}): Row {
  return { id, organizationId: ORG, deletedAt: null, status: "ACTIVE", category: "B", specialtyName, agentAssignments: assigned(agentId), workplaces: [], visits, ...extra }
}

const visitOf = (agentId: string, iso: string, extra: Row = {}): Row => ({
  id: `v-${agentId}-${iso}`,
  organizationId: ORG,
  agentId,
  deletedAt: null,
  status: "CHECKED_OUT",
  checkInAt: at(iso),
  duration: 20,
  checkInLat: NEAR.lat,
  checkInLng: NEAR.lng,
  checkOutLat: NEAR.lat,
  checkOutLng: NEAR.lng,
  checkInCustomerLat: null,
  checkInCustomerLng: null,
  checkInGeofenceRadius: null,
  customer: { ...CLINIC, name: "Klinika" },
  agent: { name: agentId === "north" ? "Agent North" : "Agent South" },
  photos: [{ id: "p" }],
  ...extra,
})

// This week: Wednesday 7 October 22:14 Baku (13 h 18 min) and Thursday 16:01 (one minute), both by the northern agent.
const LONG = visitOf("north", "2026-10-07T18:14:51.000Z", { duration: 798 })
const SHORT = visitOf("north", "2026-10-08T12:01:08.000Z", { duration: 1 })
// The southern agent: one visit this week far from the clinic and without a photo, one cancelled, one in September.
const AWAY = visitOf("south", "2026-10-09T07:00:00.000Z", { checkInLat: 40.4543, checkOutLat: 40.4543, photos: [] })
const CANCELLED = visitOf("south", "2026-10-09T08:00:00.000Z", { status: "CANCELLED" })
const SEPTEMBER = visitOf("south", "2026-09-20T08:00:00.000Z")

const CONTACTS: Row[] = [
  // Ninety-two gastroenterologists of the northern agent; two were visited this month.
  contact("g1", "north", "Qastroenteroloq", [LONG]),
  contact("g2", "north", "Qastroenteroloq", [SHORT]),
  ...Array.from({ length: 3 }, (_unused, index) => contact(`g-rest-${index}`, "north", "Qastroenteroloq")),
  ...Array.from({ length: 4 }, (_unused, index) => contact(`t-${index}`, "north", "Terapevt")),
  // The southern agent's doctors: one seen in September only, one whose visit was cancelled.
  contact("s1", "south", "Kardioloq", [SEPTEMBER]),
  contact("s2", "south", "Kardioloq", [CANCELLED]),
  contact("s3", "south", "Kardioloq", [AWAY]),
  // Not in anyone's base: merged, deleted, another organization.
  contact("merged", "north", "Terapevt", [], { status: "MERGED" }),
  contact("deleted", "north", "Terapevt", [], { deletedAt: at("2026-10-01T00:00:00.000Z") }),
  contact("foreign", "north", "Terapevt", [], { organizationId: "org-other" }),
]

const CUSTOMERS: Row[] = [
  { id: "c1", organizationId: ORG, deletedAt: null, status: "ACTIVE", category: "B", objectType: "CLINIC", latitude: 40.4, longitude: 49.8, agentAssignments: assigned("north"), routePoints: [], visits: [LONG] },
  { id: "c2", organizationId: ORG, deletedAt: null, status: "ACTIVE", category: "B", objectType: "CLINIC", latitude: null, longitude: null, agentAssignments: assigned("north"), routePoints: [], visits: [] },
  { id: "c3", organizationId: ORG, deletedAt: null, status: "ACTIVE", category: "B", objectType: "PHARMACY", latitude: 40.4, longitude: null, agentAssignments: assigned("south"), routePoints: [], visits: [] },
  { id: "c4", organizationId: ORG, deletedAt: at("2026-10-01T00:00:00.000Z"), status: "ACTIVE", category: "B", objectType: "CLINIC", latitude: null, longitude: null, agentAssignments: [], routePoints: [], visits: [] },
]

// Newest first: the handler asks for that order and the helper keeps the order given.
const VISITS: Row[] = [CANCELLED, AWAY, SHORT, LONG, SEPTEMBER]

type Actor = { agentId: string | null; role: "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT"; scopedAgentIds: string[] | null }
const ADMIN: Actor = { agentId: "adm", role: "ADMIN", scopedAgentIds: null }
const MANAGER_NORTH: Actor = { agentId: "m1", role: "MANAGER", scopedAgentIds: ["north"] }
const MANAGER_SOUTH: Actor = { agentId: "m2", role: "MANAGER", scopedAgentIds: ["south"] }
const FIELD_AGENT: Actor = { agentId: "north", role: "AGENT", scopedAgentIds: ["north"] }

function signIn(actor: Actor) {
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: `user-${actor.agentId}`, role: actor.role === "ADMIN" ? "admin" : "user", email: "u@example.com", name: "U" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(actor as never)
}

async function insights(query = "") {
  const response = await GET(new NextRequest(`http://localhost:3000/api/v1/mtm/week/insights${query}`))
  return { status: response.status, data: (await response.json()).data as import("@/lib/mtm/home-insights").MtmHomeInsights }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(checkRateLimit).mockReturnValue(true)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  serveRows(prisma.mtmAgent, AGENTS)
  serveRows(prisma.mtmContact, CONTACTS)
  serveRows(prisma.mtmCustomer, CUSTOMERS)
  serveRows(prisma.mtmVisit, VISITS)
  serveRows(prisma.mtmCoveragePolicy, [])
})

afterEach(() => {
  vi.useRealTimers()
})

describe("GET /api/v1/mtm/week/insights", () => {
  it("counts the base reached this month, by specialty while the doctors are all in one class", async () => {
    signIn(ADMIN)
    const { status, data } = await insights()
    expect(status).toBe(200)
    expect(data).toMatchObject({ timezone: "Asia/Baku", today: "2026-10-11", monthStart: "2026-10-01", weekStart: "2026-10-05" })
    expect(data.base).toEqual({
      subject: "contacts",
      grouping: "specialty",
      // Twelve active doctors; merged, deleted and another organization's are not anyone's base.
      total: 12,
      // Two by the northern agent and the one seen far from the clinic. A visit in
      // September is not this month; a cancelled visit is not a visit.
      visited: 3,
      groups: [
        { key: "Qastroenteroloq", total: 5, visited: 2 },
        { key: "Terapevt", total: 4, visited: 0 },
        { key: "Kardioloq", total: 3, visited: 1 },
      ],
    })
  })

  it("judges this week's visits: place, photo, too long, too short", async () => {
    signIn(ADMIN)
    const { data } = await insights()
    // Three visits since Monday; the cancelled one and September's are not among them.
    expect(data.quality).toEqual({ visits: 3, atPlace: 2, awayFromPlace: 1, placeUnknown: 0, withPhoto: 2, tooLong: 1, tooShort: 1, longMinutes: 120, shortMinutes: 2 })
  })

  it("lists the last visits with the odd ones flagged, newest first, never a cancelled one", async () => {
    signIn(ADMIN)
    const { data } = await insights()
    expect(data.recentVisits.map((visit) => [visit.agentName, visit.durationMinutes, visit.flag])).toEqual([
      ["Agent South", 20, null],
      ["Agent North", 1, "short"],
      ["Agent North", 798, "long"],
    ])
    expect(data.recentVisits[1]).toMatchObject({ at: "2026-10-08T12:01:08.000Z", customerName: "Klinika" })
  })

  it("names what the organization has not set up, for its administrator only", async () => {
    signIn(ADMIN)
    expect((await insights()).data.setup).toEqual([
      // Two of three active institutions lack a point (one has half a pair); the deleted one is not counted.
      { kind: "customersWithoutPin", count: 2, total: 3 },
      { kind: "contactsUnclassified", count: 12, total: 12 },
      { kind: "noVisitNorms", count: 0, total: 0 },
    ])

    serveRows(prisma.mtmCoveragePolicy, [{ id: "p1", organizationId: ORG }])
    expect((await insights()).data.setup.map((step) => step.kind)).toEqual(["customersWithoutPin", "contactsUnclassified"])

    signIn(MANAGER_NORTH)
    expect((await insights()).data.setup).toEqual([])
    // Nor under a team filter: the strip is about the organization, not a team.
    signIn(ADMIN)
    expect((await insights("?teamId=t1")).data.setup).toEqual([])
  })

  it("narrows the base and the visits to a manager's own agents", async () => {
    signIn(MANAGER_NORTH)
    const north = (await insights()).data
    expect(north.base).toMatchObject({ total: 9, visited: 2 })
    expect(north.base?.groups.map((group) => group.key)).toEqual(["Qastroenteroloq", "Terapevt"])
    expect(north.quality).toMatchObject({ visits: 2, atPlace: 2, awayFromPlace: 0, withPhoto: 2 })
    expect(north.recentVisits.map((visit) => visit.agentName)).toEqual(["Agent North", "Agent North"])

    signIn(MANAGER_SOUTH)
    const south = (await insights()).data
    expect(south.base).toMatchObject({ total: 3, visited: 1 })
    expect(south.quality).toMatchObject({ visits: 1, atPlace: 0, awayFromPlace: 1, withPhoto: 0, tooLong: 0, tooShort: 0 })
    expect(JSON.stringify(south)).not.toContain("Agent North")
  })

  it("follows the screen's team and region filters", async () => {
    signIn(ADMIN)
    expect((await insights("?teamId=t2")).data.base).toMatchObject({ total: 3, visited: 1 })
    expect((await insights("?regionId=r1")).data.quality).toMatchObject({ visits: 2 })
    // A manager cannot reach another team by naming it.
    signIn(MANAGER_NORTH)
    const other = (await insights("?teamId=t2")).data
    expect(other.base).toBeNull()
    expect(other.quality).toBeNull()
    expect(other.recentVisits).toEqual([])
  })

  it("splits by class once the classes tell doctors apart", async () => {
    signIn(ADMIN)
    serveRows(prisma.mtmContact, CONTACTS.map((row, index) => (index < 2 ? { ...row, category: "VIP" } : index < 5 ? { ...row, category: "A" } : row)))
    const { data } = await insights()
    expect(data.base?.grouping).toBe("class")
    expect(data.base?.groups).toEqual([
      { key: "VIP", total: 2, visited: 2 },
      { key: "A", total: 3, visited: 0 },
      { key: "B", total: 7, visited: 1 },
    ])
    // With classes in use the base is no longer «unclassified».
    expect(data.setup.map((step) => step.kind)).not.toContain("contactsUnclassified")
  })

  it("counts institutions for an organization that does not visit doctors", async () => {
    signIn(ADMIN)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "fieldContactsEnabled", value: false }] as never)
    const { data } = await insights()
    expect(data.base).toEqual({
      subject: "customers",
      grouping: "type",
      total: 3,
      visited: 1,
      groups: [{ key: "CLINIC", total: 2, visited: 1 }, { key: "PHARMACY", total: 1, visited: 0 }],
    })
    expect(prisma.mtmContact.groupBy).not.toHaveBeenCalled()
    expect(data.setup.map((step) => step.kind)).toEqual(["customersWithoutPin", "noVisitNorms"])
  })

  it("has no cards for an organization with nothing in it, rather than cards of zeros", async () => {
    signIn(ADMIN)
    serveRows(prisma.mtmContact, [])
    serveRows(prisma.mtmCustomer, [])
    serveRows(prisma.mtmVisit, [])
    const { data } = await insights()
    expect(data).toMatchObject({ base: null, quality: null, setup: [], recentVisits: [] })
  })

  it("gives a field agent an empty answer and reads nothing for them", async () => {
    signIn(FIELD_AGENT)
    const { status, data } = await insights()
    expect(status).toBe(200)
    expect(data).toMatchObject({ base: null, quality: null, setup: [], recentVisits: [] })
    expect(prisma.mtmContact.groupBy).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
  })

  it("refuses a reader without an MTM card, a manager without a scope, and a burst of refreshes", async () => {
    signIn(ADMIN)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(null as never)
    expect((await insights()).status).toBe(403)
    signIn({ agentId: "m9", role: "MANAGER", scopedAgentIds: null })
    expect((await insights()).status).toBe(403)
    signIn(ADMIN)
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const limited = await GET(new NextRequest("http://localhost:3000/api/v1/mtm/week/insights"))
    expect(limited.status).toBe(429)
  })
})
