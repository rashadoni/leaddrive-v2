/**
 * /api/v1/mtm/locations/zones — «Свои зоны» of the live map: named areas a
 * manager draws by hand, kept for everybody in the organization who opens the
 * map (owner, 2026-10-09, of the tracking product shown as the model: «бери
 * почти всё, чего у нас нет», then «добей до 100 %»).
 *
 * The real routes behind the real Route & Field wrapper, and the real journal
 * writer. The database is stood in for by a small table that answers the
 * routes' own statements: their filters are applied to the rows, not merely
 * looked at — a statement that forgot the organization or «not removed»
 * finds the rows it must not — and a row is refused when it breaks the
 * table's own shape rule, as the migration words it.
 *
 * What this cannot show is Postgres itself. The table's constraint — and
 * which of Prisma's two nulls leaves a JSON column empty — is asked of a real
 * database in mtm-contact-categories-postgres.test.ts («zones drawn on the
 * live map»); the tenant policy is kept as text by
 * migration-mtm-map-zones.test.ts.
 */
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"

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

import { GET, POST } from "@/app/api/v1/mtm/locations/zones/route"
import { DELETE, PUT } from "@/app/api/v1/mtm/locations/zones/[id]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { actionLabelKey, activityDataSummary } from "@/lib/mtm/activity-actions"
import { LIVE_MAP_ZONE_LIMIT } from "@/lib/mtm/live-map-zones"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { resetRateLimit } from "@/lib/rate-limit"

const ORG = "org-1"
const OTHER_ORG = "org-2"
const USER = "user-manager"

// ─── The table ──────────────────────────────────────────────────────────────

interface ZoneRow {
  id: string
  organizationId: string
  name: string
  kind: string
  color: string | null
  centerLatitude: number | null
  centerLongitude: number | null
  radiusMeters: number | null
  polygon: unknown
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}
type Where = { id?: string; organizationId?: string; deletedAt?: null; createdBy?: string; name?: string; kind?: string; createdAt?: { gte?: Date } }
type Select = Record<string, boolean>
/** What a statement may write: the row's columns, with a JSON column still as Prisma sends it. */
type Written = Partial<Omit<ZoneRow, "polygon">> & { polygon?: unknown }

let table: ZoneRow[]
let journal: Array<Record<string, unknown>>
let clock: number

/** The rows a statement's own filters leave — applied, not merely inspected. */
const matching = (where: Where = {}) => {
  const since = where.createdAt?.gte
  return table.filter((row) =>
    (where.id === undefined || row.id === where.id)
    && (where.organizationId === undefined || row.organizationId === where.organizationId)
    && (where.deletedAt !== null || row.deletedAt === null)
    && (where.createdBy === undefined || row.createdBy === where.createdBy)
    && (where.name === undefined || row.name === where.name)
    && (where.kind === undefined || row.kind === where.kind)
    && (since === undefined || row.createdAt.getTime() >= since.getTime()))
}

/** A row as Prisma hands it back: a stored JSON null reads as null, like an empty column. */
const projected = (row: ZoneRow, select?: Select) =>
  Object.fromEntries(Object.keys(select ?? row).map((key) => {
    const value = row[key as keyof ZoneRow]
    return [key, value === JSON_NULL_VALUE ? null : value]
  }))

/** `findFirst` as the table answers it. */
function readOne(args: { where?: Where; select?: Select }) {
  const row = matching(args.where)[0]
  return row ? projected(row, args.select) : null
}

/**
 * Prisma has two nulls for a JSON column, and they are not the same to
 * Postgres: `DbNull` leaves the column empty, `JsonNull` stores the JSON value
 * `null` — a value, for which `"polygon" IS NULL` is false. A plain `null`
 * is neither: Prisma refuses it for a JSON column before any statement is sent.
 */
const JSON_NULL_VALUE = Symbol("the JSON value null, stored in a jsonb column")
function stored(value: unknown): unknown {
  if (value === null) throw new Error("Argument `polygon` must not be null: use Prisma.DbNull or Prisma.JsonNull")
  if (value === Prisma.DbNull) return null
  if (value === Prisma.JsonNull) return JSON_NULL_VALUE
  return value
}

/**
 * mtm_map_zones_shape_check, as the migration words it. `polygon === null` is
 * «the column IS NULL»; a stored JSON null is not NULL and not an object.
 */
function breaksShapeRule(row: ZoneRow): boolean {
  const { kind, polygon, centerLatitude, centerLongitude, radiusMeters } = row
  const circle = kind === "CIRCLE" && polygon === null
    && centerLatitude !== null && centerLongitude !== null && radiusMeters !== null
    && centerLatitude >= -90 && centerLatitude <= 90 && centerLongitude >= -180 && centerLongitude <= 180
    && radiusMeters >= 25 && radiusMeters <= 100_000
  const outline = kind === "POLYGON" && polygon !== null && typeof polygon === "object" && !Array.isArray(polygon)
    && centerLatitude === null && centerLongitude === null && radiusMeters === null
  return !(circle || outline)
}
function refuseBrokenRow(row: ZoneRow) {
  if (breaksShapeRule(row)) throw new Error('new row for relation "mtm_map_zones" violates check constraint "mtm_map_zones_shape_check"')
}

function seed(id: string, over: Partial<ZoneRow> = {}): ZoneRow {
  clock += 1000
  const row: ZoneRow = {
    id, organizationId: ORG, name: `Зона ${id}`, kind: "CIRCLE", color: null,
    centerLatitude: 40.4, centerLongitude: 49.85, radiusMeters: 500, polygon: null,
    createdBy: "user-somebody-else", createdAt: new Date(clock), updatedAt: new Date(clock), deletedAt: null, ...over,
  }
  table.push(row)
  return row
}

// ─── The requests ───────────────────────────────────────────────────────────

const url = (id?: string) => `http://localhost:3000/api/v1/mtm/locations/zones${id ? `/${id}` : ""}`
const json = (method: string, body: unknown) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const list = () => GET(new NextRequest(url()))
const draw = (body: unknown) => POST(new NextRequest(url(), json("POST", body)))
const change = (id: string, body: unknown) => PUT(new NextRequest(url(id), json("PUT", body)), { params: Promise.resolve({ id }) })
const remove = (id: string) => DELETE(new NextRequest(url(id), { method: "DELETE" }), { params: Promise.resolve({ id }) })

// An invented block of a hundredth of a degree a side.
const BLOCK_RING = [[49.8, 40.4], [49.81, 40.4], [49.81, 40.41], [49.8, 40.41], [49.8, 40.4]]
const BOW_TIE = [[49.8, 40.4], [49.81, 40.41], [49.8, 40.41], [49.81, 40.4], [49.8, 40.4]]
// Rings around nothing: three corners on one latitude, and a line gone out and back twice (A-B-A-C-A).
const ALONG_A_PARALLEL = [[49.8, 40.4], [49.81, 40.4], [49.82, 40.4], [49.8, 40.4]]
const OUT_AND_BACK = [[49.8, 40.4], [49.81, 40.4], [49.8, 40.4], [49.8, 40.41], [49.8, 40.4]]
const circle = { kind: "CIRCLE", centerLatitude: 40.4, centerLongitude: 49.85, radiusMeters: 1500 }
const outline = { kind: "POLYGON", polygon: { type: "Polygon", coordinates: [BLOCK_RING] } }

// ─── Who is asking ──────────────────────────────────────────────────────────

const signedIn = (over: Record<string, unknown> = {}) =>
  ({ orgId: ORG, userId: USER, role: "manager", email: "manager@example.com", name: "Manager", principalType: "session", ...over })

function asCard(role: "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT" | null) {
  vi.mocked(resolveMtmRouteActor).mockResolvedValue((role === null ? null : {
    agentId: role === "ADMIN" ? null : `card-${role.toLowerCase()}`,
    role,
    scopedAgentIds: role === "ADMIN" ? null : ["agent-1"],
  }) as never)
}

const zoneStatements = () => [
  prisma.mtmMapZone.findMany, prisma.mtmMapZone.findFirst, prisma.mtmMapZone.count,
  prisma.mtmMapZone.create, prisma.mtmMapZone.updateMany, prisma.mtmMapZone.update,
  prisma.mtmMapZone.delete, prisma.mtmMapZone.deleteMany,
]
function expectTableUntouched(before: string) {
  for (const statement of [prisma.mtmMapZone.create, prisma.mtmMapZone.updateMany, prisma.mtmMapZone.update, prisma.mtmMapZone.delete, prisma.mtmMapZone.deleteMany]) {
    expect(statement).not.toHaveBeenCalled()
  }
  expect(JSON.stringify(table)).toBe(before)
  expect(journal).toEqual([])
}

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimit(`mtm-live-map-zones:${ORG}:${USER}`)
  resetRateLimit(`mtm-live-map-zones-write:${ORG}:${USER}`)
  table = []
  journal = []
  clock = Date.parse("2026-10-01T08:00:00.000Z")
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(signedIn() as never)
  asCard("MANAGER")
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "pro", addons: [], features: ["mtm"], modules: { mtm: true } } as never)

  vi.mocked(prisma.mtmMapZone.findMany).mockImplementation((async (args: { where?: Where; take?: number; select?: Select }) =>
    matching(args.where)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
      .slice(0, args.take ?? table.length)
      .map((row) => projected(row, args.select))) as never)
  vi.mocked(prisma.mtmMapZone.findFirst).mockImplementation((async (args: { where?: Where; select?: Select }) => readOne(args)) as never)
  vi.mocked(prisma.mtmMapZone.count).mockImplementation((async (args: { where?: Where }) => matching(args.where).length) as never)
  vi.mocked(prisma.mtmMapZone.create).mockImplementation((async (args: { data: Written; select?: Select }) => {
    clock += 1000
    const row: ZoneRow = {
      // A column the statement did not name gets what the table would give it.
      organizationId: "", name: "", kind: "", color: null, centerLatitude: null, centerLongitude: null, radiusMeters: null,
      createdBy: null, deletedAt: null, ...args.data, polygon: "polygon" in args.data ? stored(args.data.polygon) : null,
      id: `zone-${table.length + 1}`, createdAt: new Date(clock), updatedAt: new Date(clock),
    }
    refuseBrokenRow(row)
    table.push(row)
    return projected(row, args.select)
  }) as never)
  vi.mocked(prisma.mtmMapZone.updateMany).mockImplementation((async (args: { where?: Where; data: Written }) => {
    const rows = matching(args.where)
    for (const row of rows) {
      const next: ZoneRow = { ...row, ...args.data, polygon: "polygon" in args.data ? stored(args.data.polygon) : row.polygon }
      refuseBrokenRow(next)
      clock += 1000
      Object.assign(row, next, { updatedAt: new Date(clock) })
    }
    return { count: rows.length }
  }) as never)
  vi.mocked(prisma.mtmAuditLog.create).mockImplementation((async (args: { data: Record<string, unknown> }) => {
    journal.push(args.data)
    return { id: `audit-${journal.length}` }
  }) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("zones drawn on the live map", () => {
  it("are drawn, listed, renamed, recoloured, redrawn and removed — and the list follows every step", async () => {
    const drawn = await draw({ name: "  Центр  ", color: "teal", ...circle })
    expect(drawn.status).toBe(201)
    const zone = (await drawn.json()).data
    expect(zone).toEqual({ id: "zone-1", name: "Центр", kind: "CIRCLE", color: "teal", centerLatitude: 40.4, centerLongitude: 49.85, radiusMeters: 1500, polygon: null })
    expect((await (await list()).json()).data).toEqual({ zones: [zone], access: { canWrite: true } })

    // A new name leaves the colour and the shape as they were.
    const renamed = await change(zone.id, { name: "Центр города" })
    expect(renamed.status).toBe(200)
    expect((await renamed.json()).data).toEqual({ ...zone, name: "Центр города" })

    // «Без цвета» takes the colour off; the name stays.
    expect((await (await change(zone.id, { color: null })).json()).data).toEqual({ ...zone, name: "Центр города", color: null })
    expect((await (await change(zone.id, { color: "navy" })).json()).data).toMatchObject({ name: "Центр города", color: "navy" })

    // Redrawn as an outline: nothing of the circle is left on the row.
    const redrawn = await change(zone.id, outline)
    expect(redrawn.status).toBe(200)
    expect((await redrawn.json()).data).toEqual({
      id: zone.id, name: "Центр города", kind: "POLYGON", color: "navy",
      centerLatitude: null, centerLongitude: null, radiusMeters: null, polygon: outline.polygon,
    })
    // …and back to a circle: nothing of the outline.
    expect((await (await change(zone.id, { ...circle, radiusMeters: 250 })).json()).data).toMatchObject({ kind: "CIRCLE", radiusMeters: 250, polygon: null })
    expect((await (await list()).json()).data.zones).toHaveLength(1)

    const removed = await remove(zone.id)
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ success: true, data: { id: zone.id } })
    expect((await (await list()).json()).data.zones).toEqual([])
  })

  it("keeps who drew a zone and stores an outline as the ring that was sent", async () => {
    expect((await draw({ name: "Северный участок", ...outline })).status).toBe(201)
    expect(table).toHaveLength(1)
    expect(table[0]).toMatchObject({
      organizationId: ORG, createdBy: USER, name: "Северный участок", kind: "POLYGON", color: null,
      centerLatitude: null, centerLongitude: null, radiusMeters: null, deletedAt: null,
    })
    // The first corner was sent as [longitude 49.8, latitude 40.4] and is stored so.
    expect(table[0].polygon).toEqual({ type: "Polygon", coordinates: [BLOCK_RING] })
  })

  it("give the map of each zone only what it draws — not who drew it, not the organization", async () => {
    seed("a", { color: "pink" })
    const { data } = await (await list()).json()
    expect(Object.keys(data.zones[0]).sort()).toEqual(["centerLatitude", "centerLongitude", "color", "id", "kind", "name", "polygon", "radiusMeters"])
    expect(JSON.stringify(data)).not.toMatch(/user-somebody-else|org-1|createdBy|organizationId|deletedAt/)
  })

  it("belong to the organization: everybody who may open the map sees all of them, whoever drew them, oldest first", async () => {
    seed("first", { createdBy: "user-a" })
    seed("second", { createdBy: "user-b", kind: "POLYGON", centerLatitude: null, centerLongitude: null, radiusMeters: null, polygon: outline.polygon })
    seed("of-another-organization", { organizationId: OTHER_ORG })
    seed("removed", { deletedAt: new Date("2026-10-02T00:00:00.000Z") })
    for (const [card, webRole, canWrite] of [["ADMIN", "admin", true], ["MANAGER", "manager", true], ["SUPERVISOR", "sales", false]] as const) {
      resetRateLimit(`mtm-live-map-zones:${ORG}:${USER}`)
      vi.mocked(requireAuth).mockResolvedValue(signedIn({ role: webRole }) as never)
      asCard(card)
      const response = await list()
      expect(response.status).toBe(200)
      const { data } = await response.json()
      expect(data.zones.map((zone: { id: string }) => zone.id)).toEqual(["first", "second"])
      expect(data.access).toEqual({ canWrite })
    }
  })
})

describe("who may not", () => {
  it("is the managers' screen: a field employee and a web user without an MTM card are refused everything, and nothing is read or written", async () => {
    seed("a")
    const before = JSON.stringify(table)
    for (const card of ["AGENT", null] as const) {
      asCard(card)
      for (const response of [await list(), await draw({ name: "Центр", ...circle }), await change("a", { name: "Чужое имя" }), await remove("a")]) {
        expect(response.status).toBe(403)
        expect(await response.json()).toMatchObject({ code: "MTM_MAP_ZONE_MANAGER_REQUIRED" })
      }
    }
    for (const statement of zoneStatements()) expect(statement).not.toHaveBeenCalled()
    expectTableUntouched(before)
  })

  it("a supervisor sees and does not change: every write is refused with its own code and nothing is touched", async () => {
    seed("a")
    const before = JSON.stringify(table)
    vi.mocked(requireAuth).mockResolvedValue(signedIn({ role: "sales" }) as never)
    asCard("SUPERVISOR")
    for (const response of [await draw({ name: "Центр", ...circle }), await change("a", { name: "Другое имя" }), await remove("a")]) {
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: "MTM_MAP_ZONE_READ_ONLY" })
    }
    expect(prisma.mtmMapZone.findFirst).not.toHaveBeenCalled()
    expectTableUntouched(before)
  })

  it("answers who before what: a supervisor sending a zone that is not one is told 403, not 400", async () => {
    asCard("SUPERVISOR")
    const response = await draw({ name: "", kind: "CIRCLE" })
    expect(response.status).toBe(403)
    expectTableUntouched("[]")
  })

  it("an integration key reads the zones and draws none: a zone is drawn by a person at a browser", async () => {
    seed("a")
    const before = JSON.stringify(table)
    // A key acts as the organization's administrator; what it is not is a person.
    for (const provenance of [{ principalType: "api_key" }, { principalType: undefined }]) {
      resetRateLimit(`mtm-live-map-zones:${ORG}:${USER}`)
      vi.mocked(requireAuth).mockResolvedValue(signedIn({ role: "admin", name: "API Key: integration", ...provenance }) as never)
      asCard("ADMIN")
      const read = await list()
      expect(read.status).toBe(200)
      const { data } = await read.json()
      expect(data.zones.map((zone: { id: string }) => zone.id)).toEqual(["a"])
      expect(data.access).toEqual({ canWrite: false })
      for (const response of [await draw({ name: "Центр", ...circle }), await change("a", { name: "Другое имя" }), await remove("a")]) {
        expect(response.status).toBe(403)
        expect(await response.json()).toMatchObject({ code: "MTM_MAP_ZONE_SESSION_REQUIRED" })
      }
    }
    expectTableUntouched(before)
  })

  it("a web role that may only look at Route & Field gets no tools, whatever the MTM card says", async () => {
    vi.mocked(requireAuth).mockResolvedValue(signedIn({ role: "support" }) as never)
    asCard("MANAGER")
    expect((await (await list()).json()).data.access).toEqual({ canWrite: false })
    const response = await draw({ name: "Центр", ...circle })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_MAP_ZONE_READ_ONLY" })
    expectTableUntouched("[]")
  })

  it("is for signed-in people of an organization that has the module", async () => {
    seed("a")
    const before = JSON.stringify(table)
    // A manager, signed in — of an organization that does not have Route & Field.
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "starter", addons: [], features: [], modules: {}, settings: {} } as never)
    for (const response of [await list(), await draw({ name: "Центр", ...circle }), await change("a", { name: "Другое имя" }), await remove("a")]) {
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: "TENANT_CAPABILITY_DISABLED" })
    }
    // Turned away at the door: nobody was even asked what his card in the module says.
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()

    // An organization that has it — and nobody signed in.
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "pro", addons: [], features: ["mtm"], modules: { mtm: true } } as never)
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
    for (const response of [await list(), await draw({ name: "Центр", ...circle }), await change("a", { name: "Другое имя" }), await remove("a")]) {
      expect(response.status).toBe(401)
    }
    for (const statement of zoneStatements()) expect(statement).not.toHaveBeenCalled()
    expectTableUntouched(before)
  })
})

describe("what is not a zone", () => {
  it.each([
    ["an outline that does not close", { name: "Участок", kind: "POLYGON", polygon: { type: "Polygon", coordinates: [BLOCK_RING.slice(0, 4)] } }],
    ["an outline that crosses itself", { name: "Участок", kind: "POLYGON", polygon: { type: "Polygon", coordinates: [BOW_TIE] } }],
    ["an outline whose corners all stand on one line", { name: "Участок", kind: "POLYGON", polygon: { type: "Polygon", coordinates: [ALONG_A_PARALLEL] } }],
    ["an outline that goes out and back along itself", { name: "Участок", kind: "POLYGON", polygon: { type: "Polygon", coordinates: [OUT_AND_BACK] } }],
    ["an outline with a hole", { name: "Участок", kind: "POLYGON", polygon: { type: "Polygon", coordinates: [BLOCK_RING, BLOCK_RING] } }],
    ["an outline whose pairs are not numbers", { name: "Участок", kind: "POLYGON", polygon: { type: "Polygon", coordinates: [[null, null, null, null]] } }],
    ["a circle without a radius", { name: "Центр", kind: "CIRCLE", centerLatitude: 40.4, centerLongitude: 49.85 }],
    ["a circle without a centre", { name: "Центр", kind: "CIRCLE", centerLatitude: null, centerLongitude: null, radiusMeters: 500 }],
    ["a circle of a metre", { name: "Центр", ...circle, radiusMeters: 1 }],
    ["a colour that is not one of the palette's", { name: "Центр", color: "#ff0000", ...circle }],
    ["a zone without a name", { name: "   ", ...circle }],
    ["a name with no shape", { name: "Центр" }],
    ["a shape nobody draws", { name: "Центр", kind: "SQUARE", side: 100 }],
  ])("refuses %s with 400, and nothing is kept or journalled", async (_what, body) => {
    const response = await draw(body)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "Validation failed" })
    expect(prisma.mtmMapZone.count).not.toHaveBeenCalled()
    expectTableUntouched("[]")
  })

  it("refuses a request that is not JSON at all", async () => {
    const response = await POST(new NextRequest(url(), { method: "POST", body: "{name:" }))
    expect(response.status).toBe(400)
    expectTableUntouched("[]")
  })

  it("refuses a change that would leave half a shape, and the zone stays as it was", async () => {
    seed("a")
    const before = JSON.stringify(table)
    for (const body of [
      { radiusMeters: 900 },
      // A rename that also carries a radius is refused whole: answering 200
      // with the new name and the old radius would say the circle was resized.
      { name: "Новое имя", radiusMeters: 900 },
      { kind: "CIRCLE", centerLatitude: 40.4, centerLongitude: 49.85 },
      { kind: "POLYGON", polygon: { type: "Polygon", coordinates: [BOW_TIE] } },
      // Redrawn into a line: a ring around nothing is refused on a change as on a drawing.
      { kind: "POLYGON", polygon: { type: "Polygon", coordinates: [ALONG_A_PARALLEL] } },
      { color: "#ff0000" },
      { name: "" },
      {},
    ]) {
      const response = await change("a", body)
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
    expectTableUntouched(before)
  })
})

describe("a zone that is not this organization's, or is no longer there", () => {
  it("another organization's zone does not exist here: not listed, 404 on a change and on removal, and its row is not touched", async () => {
    seed("theirs", { organizationId: OTHER_ORG, name: "Чужая зона" })
    const before = JSON.stringify(table)
    expect((await (await list()).json()).data.zones).toEqual([])
    for (const response of [await change("theirs", { name: "Теперь наша" }), await remove("theirs")]) {
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ code: "MTM_MAP_ZONE_NOT_FOUND" })
    }
    expectTableUntouched(before)
  })

  it("a removed zone is gone: not listed, and changing or removing it again answers 404", async () => {
    seed("a")
    expect((await remove("a")).status).toBe(200)
    const after = JSON.stringify(table)
    journal = []
    vi.mocked(prisma.mtmMapZone.updateMany).mockClear()
    for (const response of [await change("a", { name: "Вернуть" }), await remove("a")]) {
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ code: "MTM_MAP_ZONE_NOT_FOUND" })
    }
    expect((await (await list()).json()).data.zones).toEqual([])
    expectTableUntouched(after)
  })

  it("a zone removed by somebody else while it was being renamed answers 404, and no change is journalled", async () => {
    const row = seed("a")
    // Found — and removed by another manager before the statement that writes.
    vi.mocked(prisma.mtmMapZone.findFirst).mockImplementationOnce((async (args: { where?: Where; select?: Select }) => {
      const result = readOne(args)
      row.deletedAt = new Date("2026-10-03T00:00:00.000Z")
      return result
    }) as never)
    const response = await change("a", { name: "Опоздал" })
    expect(response.status).toBe(404)
    expect(row.name).toBe("Зона a")
    expect(journal).toEqual([])
  })

  it("a zone two people remove at the same moment is removed once: the second is told 404 and journals nothing", async () => {
    const row = seed("a")
    const firstRemoval = new Date("2026-10-03T00:00:00.000Z")
    vi.mocked(prisma.mtmMapZone.findFirst).mockImplementationOnce((async (args: { where?: Where; select?: Select }) => {
      const result = readOne(args)
      row.deletedAt = firstRemoval
      return result
    }) as never)
    const response = await remove("a")
    expect(response.status).toBe(404)
    // The moment of the first removal is not overwritten by the second.
    expect(row.deletedAt).toBe(firstRemoval)
    expect(journal).toEqual([])
  })

  it("an id that was never a zone answers 404", async () => {
    expect((await change("no-such-zone", { name: "Имя" })).status).toBe(404)
    expect((await remove("no-such-zone")).status).toBe(404)
    expect(journal).toEqual([])
  })
})

describe("the same zone sent again", () => {
  // The answer to a drawing can be lost on its way back after the row was
  // written. The form then says «нет связи, попробуйте ещё раз» — and the
  // second press of «Сохранить» used to keep the zone twice.
  const drawnCreates = () => journal.filter((entry) => entry.action === "MAP_ZONE_CREATE")
  const listed = async () => (await (await list()).json()).data.zones as Array<{ id: string }>

  beforeEach(() => {
    // The route asks the clock what «a moment ago» is: the table's clock and the route's are one here.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(clock))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ["a circle", { name: "Центр", color: "teal", ...circle }],
    ["an outline", { name: "Северный участок", ...outline }],
  ])("by the same person a moment later is the same zone: %s is answered again, and nothing is written a second time", async (_what, body) => {
    const first = await draw(body)
    expect(first.status).toBe(201)
    const zone = (await first.json()).data
    const before = JSON.stringify(table)

    // Half a minute later, the same press of «Сохранить» once more.
    vi.setSystemTime(Date.now() + 30_000)
    const second = await draw(body)
    // Not «created»: it was there already. The page draws what is answered either way.
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ success: true, data: zone })
    expect(prisma.mtmMapZone.create).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(table)).toBe(before)
    expect(await listed()).toEqual([zone])
    expect(drawnCreates()).toHaveLength(1)
  })

  it("is the same zone however the name was spaced, and with «Без цвета» said either way", async () => {
    const zone = (await (await draw({ name: "Центр", ...circle })).json()).data
    for (const body of [{ name: "  Центр ", ...circle }, { name: "Центр", color: null, ...circle }, { name: "Центр", color: "", ...circle }]) {
      const again = await draw(body)
      expect(again.status).toBe(200)
      expect((await again.json()).data).toEqual(zone)
    }
    expect(table).toHaveLength(1)
    expect(drawnCreates()).toHaveLength(1)
  })

  it.each([
    ["another name", { name: "Центр города", color: "teal", ...circle }],
    ["another colour", { name: "Центр", color: "navy", ...circle }],
    ["no colour", { name: "Центр", ...circle }],
    ["another radius", { name: "Центр", color: "teal", ...circle, radiusMeters: 1501 }],
    ["another centre", { name: "Центр", color: "teal", ...circle, centerLongitude: 49.8501 }],
    ["an outline instead of the circle", { name: "Центр", color: "teal", ...outline }],
  ])("a drawing with %s is another zone, kept and journalled as its own", async (_what, body) => {
    const first = (await (await draw({ name: "Центр", color: "teal", ...circle })).json()).data
    const other = await draw(body)
    expect(other.status).toBe(201)
    expect((await other.json()).data.id).not.toBe(first.id)
    expect(await listed()).toHaveLength(2)
    expect(drawnCreates().map((entry) => entry.entityId)).toEqual(["zone-1", "zone-2"])
  })

  it("an outline one corner different is another zone", async () => {
    const first = (await (await draw({ name: "Участок", ...outline })).json()).data
    const moved = BLOCK_RING.map((pair, index) => (index === 2 ? [49.8101, 40.41] : pair))
    const other = await draw({ name: "Участок", kind: "POLYGON", polygon: { type: "Polygon", coordinates: [moved] } })
    expect(other.status).toBe(201)
    expect((await other.json()).data.id).not.toBe(first.id)
    expect(table.map((row) => row.polygon)).toEqual([outline.polygon, { type: "Polygon", coordinates: [moved] }])
  })

  it("is somebody else's zone when a colleague draws the same circle, and another organization's when it is drawn there", async () => {
    const body = { name: "Центр", color: "teal", ...circle }
    const mine = (await (await draw(body)).json()).data

    vi.mocked(requireAuth).mockResolvedValue(signedIn({ userId: "user-colleague" }) as never)
    const colleague = await draw(body)
    expect(colleague.status).toBe(201)
    const theirs = (await colleague.json()).data
    expect(theirs.id).not.toBe(mine.id)

    vi.mocked(requireAuth).mockResolvedValue(signedIn({ orgId: OTHER_ORG }) as never)
    const elsewhere = await draw(body)
    expect(elsewhere.status).toBe(201)
    // The same person, the same drawing — in another organization it is a zone of that organization.
    expect(table.map((row) => [row.organizationId, row.createdBy])).toEqual([[ORG, USER], [ORG, "user-colleague"], [OTHER_ORG, USER]])
    expect(drawnCreates()).toHaveLength(3)
    // And the answer never names a zone of another organization.
    expect((await elsewhere.json()).data.id).not.toBe(mine.id)
  })

  it("is a new zone once the moment has passed: the same circle drawn three minutes later is drawn", async () => {
    const body = { name: "Центр", ...circle }
    const first = (await (await draw(body)).json()).data
    vi.setSystemTime(Date.now() + 3 * 60_000)
    const later = await draw(body)
    expect(later.status).toBe(201)
    expect((await later.json()).data.id).not.toBe(first.id)
    expect(drawnCreates()).toHaveLength(2)
  })

  it("is drawn again after it was removed: a removed zone does not answer for a new one", async () => {
    const body = { name: "Центр", ...circle }
    const first = (await (await draw(body)).json()).data
    expect((await remove(first.id)).status).toBe(200)
    const again = await draw(body)
    expect(again.status).toBe(201)
    const zone = (await again.json()).data
    expect(zone.id).not.toBe(first.id)
    expect(await listed()).toEqual([zone])
  })

  it(`is still that zone when it was the last one the organization may keep: the repeat is answered, not refused with «${LIVE_MAP_ZONE_LIMIT} зон»`, async () => {
    for (let index = 0; index < LIVE_MAP_ZONE_LIMIT - 1; index += 1) seed(`kept-${String(index).padStart(3, "0")}`)
    vi.setSystemTime(new Date(clock))
    const body = { name: "Пятисотая", ...circle }
    const first = await draw(body)
    expect(first.status).toBe(201)
    const zone = (await first.json()).data
    const again = await draw(body)
    expect(again.status).toBe(200)
    expect((await again.json()).data).toEqual(zone)
    // Anything else is one zone too many.
    expect((await draw({ name: "Пятьсот первая", ...circle })).status).toBe(409)
    expect(table.filter((row) => row.deletedAt === null)).toHaveLength(LIVE_MAP_ZONE_LIMIT)
  })
})

describe("the journal", () => {
  it("removing marks the row instead of deleting it, and the journal says who removed what", async () => {
    const row = seed("a", { name: "Склад", color: "lime" })
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-10T09:15:00.000Z"))
    try {
      expect((await remove("a")).status).toBe(200)
    } finally {
      vi.useRealTimers()
    }
    expect(table).toHaveLength(1)
    expect(row.deletedAt).toEqual(new Date("2026-10-10T09:15:00.000Z"))
    expect(prisma.mtmMapZone.delete).not.toHaveBeenCalled()
    expect(prisma.mtmMapZone.deleteMany).not.toHaveBeenCalled()
    expect(journal).toEqual([expect.objectContaining({
      organizationId: ORG, agentId: null, actorUserId: USER,
      action: "MAP_ZONE_DELETE", entity: "map_zone", entityId: "a", metadataKind: "map_zone_change",
      oldData: expect.objectContaining({ id: "a", name: "Склад", color: "lime", kind: "CIRCLE", radiusMeters: 500 }),
      newData: expect.objectContaining({ id: "a", name: "Склад", deletedAt: "2026-10-10T09:15:00.000Z" }),
    })])
  })

  it("reads each of the three in words, in every language, and says which zone — never a bare «Действие»", async () => {
    const zone = (await (await draw({ name: "Склад", ...circle })).json()).data
    await change(zone.id, { name: "Склад на севере" })
    await remove(zone.id)
    expect(journal.map((entry) => entry.action)).toEqual(["MAP_ZONE_CREATE", "MAP_ZONE_UPDATE", "MAP_ZONE_DELETE"])
    // The page's own two functions, given the rows the routes really wrote.
    const details = journal.map((entry) => activityDataSummary({ action: String(entry.action), newData: entry.newData }, (key) => key))
    expect(details).toEqual(["Склад", "Склад на севере", "Склад на севере"])
    for (const entry of journal) {
      const key = actionLabelKey(String(entry.action))
      expect(key).toBe(`action.${entry.action}`)
      for (const locale of ["ru", "en", "az"]) {
        const label = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmActivity.action[String(entry.action)]
        expect(label, `${locale}: ${key}`).toEqual(expect.any(String))
      }
    }
  })

  it("every drawing and every change is written with the person who made it and the zone before and after", async () => {
    const zone = (await (await draw({ name: "Центр", ...circle })).json()).data
    await change(zone.id, { name: "Центр города", color: "purple" })
    expect(journal.map((entry) => [entry.action, entry.entityId, entry.actorUserId, entry.organizationId])).toEqual([
      ["MAP_ZONE_CREATE", zone.id, USER, ORG],
      ["MAP_ZONE_UPDATE", zone.id, USER, ORG],
    ])
    expect(journal[0].newData).toEqual(zone)
    expect(journal[0].oldData).toBeUndefined()
    expect(journal[1].oldData).toEqual(zone)
    expect(journal[1].newData).toEqual({ ...zone, name: "Центр города", color: "purple" })
  })

  it("a journal that cannot be written does not undo or fail the change", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(prisma.mtmAuditLog.create).mockRejectedValue(new Error("journal is down") as never)
    const drawn = await draw({ name: "Центр", ...circle })
    expect(drawn.status).toBe(201)
    expect(table).toHaveLength(1)
    expect((await remove("zone-1")).status).toBe(200)
    expect(table[0].deletedAt).not.toBeNull()
  })
})

describe("how many, and how often", () => {
  it(`keeps at most ${LIVE_MAP_ZONE_LIMIT} zones: the next one is refused, and removing one makes room again`, async () => {
    for (let index = 0; index < LIVE_MAP_ZONE_LIMIT; index += 1) seed(`kept-${String(index).padStart(3, "0")}`)
    // Removed zones and other organizations' zones do not count.
    for (let index = 0; index < 20; index += 1) seed(`removed-${index}`, { deletedAt: new Date("2026-10-02T00:00:00.000Z") })
    for (let index = 0; index < 20; index += 1) seed(`theirs-${index}`, { organizationId: OTHER_ORG })
    const kept = () => table.filter((row) => row.organizationId === ORG && row.deletedAt === null).length

    const refused = await draw({ name: "Пятьсот первая", ...circle })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ code: "MTM_MAP_ZONE_LIMIT_REACHED", limit: LIVE_MAP_ZONE_LIMIT })
    expect(prisma.mtmMapZone.create).not.toHaveBeenCalled()
    expect(kept()).toBe(LIVE_MAP_ZONE_LIMIT)
    expect(journal).toEqual([])
    // The whole of it is listed: the limit is what one answer holds.
    expect((await (await list()).json()).data.zones).toHaveLength(LIVE_MAP_ZONE_LIMIT)

    expect((await remove("kept-000")).status).toBe(200)
    expect((await draw({ name: "Пятисотая заново", ...circle })).status).toBe(201)
    expect(kept()).toBe(LIVE_MAP_ZONE_LIMIT)
  })

  it("the list is asked for when the layer is opened, not on the map's timer: thirty a minute", async () => {
    let last: Response | null = null
    for (let turn = 0; turn < 31; turn += 1) last = await list()
    expect(last?.status).toBe(429)
    expect(last?.headers.get("retry-after")).toBe("60")
    expect(await last?.json()).toMatchObject({ code: "MTM_MAP_ZONE_RATE_LIMITED" })
  })

  it("changes come at a person's pace: the sixty-first in a minute waits, whichever kind it is", async () => {
    seed("a")
    for (let turn = 0; turn < 20; turn += 1) {
      expect((await change("a", { name: `Имя ${turn}` })).status).toBe(200)
      expect((await draw({ name: `Зона ${turn}`, ...circle })).status).toBe(201)
      expect((await remove(`zone-${turn + 2}`)).status).toBe(200)
    }
    const before = JSON.stringify(table)
    for (const response of [await change("a", { name: "Ещё одно" }), await draw({ name: "Ещё одна", ...circle }), await remove("a")]) {
      expect(response.status).toBe(429)
      expect(response.headers.get("retry-after")).toBe("60")
    }
    expect(JSON.stringify(table)).toBe(before)
    // Looking is counted apart from changing.
    expect((await list()).status).toBe(200)
  })

  it("a database that fails is answered with a code and no detail of the failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(prisma.mtmMapZone.findMany).mockRejectedValueOnce(new Error('relation "mtm_map_zones" does not exist') as never)
    const response = await list()
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: "Failed to load zones", code: "MTM_MAP_ZONE_FAILED" })
  })
})
