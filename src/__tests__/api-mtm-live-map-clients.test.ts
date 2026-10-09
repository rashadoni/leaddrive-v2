/**
 * GET /api/v1/mtm/locations/clients — the client base as points for the live
 * map's «Клиенты» layer (owner, 2026-10-09, of the Navixy demo: «бери почти
 * всё, чего у нас нет» — there the places stand on the same map as the
 * vehicles).
 *
 * The real route behind the real Route & Field wrapper. The database is stood
 * in for by a small base of institutions that answers the route's own query —
 * its filters are applied to the rows, not merely looked at — except for the
 * team scope, which is the existing `customerScopeForActor` predicate (tested
 * on its own in api-mtm-field-scope-by-team.test.ts) and is checked here to be
 * the one in the query.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

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

vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mtm/route-permissions")>()),
  resolveMtmRouteActor: vi.fn(),
}))

import { GET } from "@/app/api/v1/mtm/locations/clients/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { customerScopeForActor } from "@/lib/mtm/field-scope"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { resetRateLimit } from "@/lib/rate-limit"

const ORG = "org-1"
const USER = "user-manager"
const request = () => new NextRequest(new URL("http://localhost:3000/api/v1/mtm/locations/clients"))

interface Institution {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  category: string
  objectType: string
  status: string
  geofenceRadius: number | null
  deletedAt: Date | null
  // What only the card holds: none of it may reach the map.
  phone: string
  notes: string
}
const institution = (id: string, over: Partial<Institution> = {}): Institution => ({
  id, name: `Учреждение ${id}`, latitude: 40.4, longitude: 49.85, category: "B", objectType: "PHARMACY", status: "ACTIVE",
  geofenceRadius: null, deletedAt: null, phone: "+000 00 000 00 00", notes: "заметка менеджера", ...over,
})

type Range = { gte?: number; lte?: number }
type Where = {
  organizationId?: string
  deletedAt?: null
  objectType?: { not?: string }
  status?: { in?: string[] }
  latitude?: Range
  longitude?: Range
  AND?: unknown[]
}
const inRange = (value: number | null, range: Range | undefined) =>
  !range || (typeof value === "number" && value >= (range.gte ?? -Infinity) && value <= (range.lte ?? Infinity))
/** The rows the route's own filters leave — applied, not merely inspected. */
const matching = (base: Institution[], where: Where) => base.filter((row) =>
  (where.deletedAt !== null || row.deletedAt === null)
  && (!where.objectType?.not || row.objectType !== where.objectType.not)
  && (!where.status?.in || where.status.in.includes(row.status))
  && inRange(row.latitude, where.latitude)
  && inRange(row.longitude, where.longitude))

let base: Institution[]

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimit(`mtm-live-map-clients:${ORG}:${USER}`)
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: USER, role: "manager", email: "manager@example.com", name: "Manager" })
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "pro", addons: [], features: ["mtm"], modules: { mtm: true } } as never)
  base = [
    institution("a", { category: "VIP", geofenceRadius: 150 }),
    institution("b", { objectType: "CLINIC", latitude: 40.41, longitude: 49.86 }),
    institution("prospect", { status: "PROSPECT" }),
    institution("no-place", { latitude: null, longitude: null }),
    institution("no-place-2", { latitude: null, longitude: null }),
    institution("out-of-range", { latitude: 500, longitude: 49.85 }),
    institution("closed", { status: "INACTIVE" }),
    institution("deleted", { deletedAt: new Date("2026-01-01T00:00:00.000Z") }),
    institution("a-person", { objectType: "DOCTOR" }),
  ]
  vi.mocked(prisma.mtmCustomer.findMany).mockImplementation((async (args: { where: Where; take?: number; select?: Record<string, boolean> }) =>
    matching(base, args.where)
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, args.take ?? base.length)
      .map((row) => Object.fromEntries(Object.keys(args.select ?? row).map((key) => [key, row[key as keyof Institution]])))) as never)
  vi.mocked(prisma.mtmCustomer.count).mockImplementation((async (args: { where: Where }) => matching(base, args.where).length) as never)
})

describe("GET /api/v1/mtm/locations/clients", () => {
  it("returns the institutions that have a place — and of each only what a pin needs", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.clients).toEqual([
      { id: "a", name: "Учреждение a", latitude: 40.4, longitude: 49.85, category: "VIP", objectType: "PHARMACY", geofenceRadius: 150 },
      { id: "b", name: "Учреждение b", latitude: 40.41, longitude: 49.86, category: "B", objectType: "CLINIC", geofenceRadius: null },
      { id: "prospect", name: "Учреждение prospect", latitude: 40.4, longitude: 49.85, category: "B", objectType: "PHARMACY", geofenceRadius: null },
    ])
    // Nothing of the card travels: no phone, no notes.
    expect(JSON.stringify(data)).not.toMatch(/phone|notes|заметка|\+000/)
  })

  it("says what the layer does not show: how many there are in all and how many have no usable place", async () => {
    const { data } = await (await GET(request())).json()
    // In scope: a, b, prospect, the two without a place and the one with a latitude of 500.
    expect(data.total).toBe(6)
    expect(data.withoutCoordinates).toBe(3)
    expect(data.truncated).toBe(false)
  })

  it("leaves out closed and deleted institutions and the people kept in the same table", async () => {
    const { data } = await (await GET(request())).json()
    const ids = data.clients.map((client: { id: string }) => client.id)
    for (const hidden of ["closed", "deleted", "a-person", "out-of-range", "no-place"]) expect(ids).not.toContain(hidden)
  })

  it("an administrator sees the organization; a manager or supervisor the institutions of the employees he sees", async () => {
    await GET(request())
    const adminWhere = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0]?.[0]?.where as Where
    expect(adminWhere.organizationId).toBe(ORG)
    expect(adminWhere.AND).toBeUndefined()

    vi.mocked(prisma.mtmCustomer.findMany).mockClear()
    vi.mocked(prisma.mtmCustomer.count).mockClear()
    resetRateLimit(`mtm-live-map-clients:${ORG}:${USER}`)
    const supervisor = { agentId: "sup-1", role: "SUPERVISOR", scopedAgentIds: ["agent-1", "agent-2"] }
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(supervisor as never)
    await GET(request())
    const where = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0]?.[0]?.where as Where
    // The very predicate the institutions list of a field actor uses, for the organization's «today».
    const [scope] = where.AND as [ReturnType<typeof customerScopeForActor>]
    const today = (scope as { OR: Array<{ agentAssignments?: { some: { effectiveFrom: { lte: Date } } } }> }).OR[0].agentAssignments!.some.effectiveFrom.lte
    expect(scope).toEqual(customerScopeForActor(supervisor as never, today))
    expect(JSON.stringify(scope)).toContain("agent-1")
    // The totals are counted inside the same scope: «N из M» never counts another team's institutions.
    for (const [call] of vi.mocked(prisma.mtmCustomer.count).mock.calls) {
      expect((call as { where: Where }).where.AND).toEqual(where.AND)
    }
  })

  it("is the managers' screen: a field agent is refused, and so is a web user without an MTM card", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] } as never)
    expect((await GET(request())).status).toBe(403)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(null as never)
    expect((await GET(request())).status).toBe(403)
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
  })

  it("is for signed-in people of an organization that has the module", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
    expect((await GET(request())).status).toBe(401)
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
  })

  it("cuts a base larger than one answer holds and says so", async () => {
    base = Array.from({ length: 10_050 }, (_unused, index) => institution(String(index).padStart(5, "0")))
    const { data } = await (await GET(request())).json()
    expect(data.clients).toHaveLength(10_000)
    expect(data.truncated).toBe(true)
    expect(data.total).toBe(10_050)
  })

  it("is asked for when the layer is switched on, not on the map's timer: a handful a minute", async () => {
    let last = 200
    for (let turn = 0; turn < 7; turn += 1) last = (await GET(request())).status
    expect(last).toBe(429)
  })
})
