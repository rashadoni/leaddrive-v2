/**
 * /api/v1/mtm/locations/share-links — «Ссылка на местоположение», the
 * managers' half: making a link to one employee's position, listing his
 * links and revoking one.
 *
 * A link lets somebody with no account see where a named person is. So what
 * is pinned here is who may make one and for whom, that the organization's
 * switch really stops it, that the link itself is kept nowhere, and that
 * nothing about a link another organization made can be learnt or changed.
 *
 * The real routes behind the real Route & Field wrapper, and the real journal
 * writer. The database is stood in for by small tables that answer the
 * routes' own statements: their filters are applied to the rows, not merely
 * looked at — a statement that forgot the organization, «not revoked» or the
 * employee finds the rows it must not — and a row is refused when it breaks
 * the table's own rules, as the migration words them.
 *
 * What this cannot show is Postgres itself: the policy, the unique index
 * across organizations and the CHECKs are asked of a real database in
 * mtm-contact-categories-postgres.test.ts («links to an employee's position»).
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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

import { GET, POST } from "@/app/api/v1/mtm/locations/share-links/route"
import { DELETE } from "@/app/api/v1/mtm/locations/share-links/[id]/route"
import { GET as OPEN_LINK } from "@/app/api/v1/public/location-share/[token]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { actionLabelKey, actionMeta } from "@/lib/mtm/activity-actions"
import { LOCATION_SHARE_LINK_ALIVE_LIMIT } from "@/lib/mtm/location-share-link"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { resetRateLimit } from "@/lib/rate-limit"

const ORG = "org-1"
const OTHER_ORG = "org-2"
const USER = "user-manager"
// Noon in Baku, the organization's zone as it ships: its midnight is 20:00Z.
const NOW = new Date("2026-10-10T08:00:00.000Z")
const MIDNIGHT = new Date("2026-10-10T20:00:00.000Z")
const HOUR = 60 * 60 * 1000
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

// ─── The tables ─────────────────────────────────────────────────────────────

interface LinkRow {
  id: string
  organizationId: string
  agentId: string
  tokenHash: string
  createdBy: string | null
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
  revokedBy: string | null
  viewCount: number
  lastViewedAt: Date | null
}
type LinkWhere = {
  id?: string
  organizationId?: string
  agentId?: string
  createdAt?: { gte?: Date }
  revokedAt?: null | { not: null }
  expiresAt?: { gt?: Date; lte?: Date }
  lastViewedAt?: null | { lte?: Date }
  tokenHash?: string
  OR?: LinkWhere[]
}
type Select = Record<string, boolean>

/** What is read of a shift and of GPS to say whether a link shows a point right now. */
interface ShiftRow { id: string; organizationId: string; agentId: string; workDate: Date; status: string; startedAt: Date }
interface ShiftEventRow { organizationId: string; agentId: string; workdayId: string; type: string; occurredAt: Date; appliedAt: Date | null }
interface PointRow { organizationId: string; agentId: string; latitude: number; longitude: number; accuracy: number | null; recordedAt: Date }

let links: LinkRow[]
let shifts: ShiftRow[]
let shiftEvents: ShiftEventRow[]
let points: PointRow[]
let agents: Array<{ id: string; organizationId: string; status: string }>
let users: Array<{ id: string; organizationId: string; name: string }>
let switchedOn: Record<string, unknown>
let journal: Array<Record<string, unknown>>
let serial: number

const KNOWN_FILTERS = new Set(["id", "organizationId", "agentId", "createdAt", "revokedAt", "expiresAt", "lastViewedAt", "tokenHash", "OR"])
/** The organization's switch, read again inside a creation with its row held: the one raw read the routes make. */
const SWITCH_ROW_HELD = `SELECT "value" FROM "mtm_settings" WHERE "organizationId" = ? AND "key" = 'locationShareLinksEnabled' FOR SHARE`
/** A raw statement as it was written, its values left out and its line breaks closed up. */
const worded = (sql: readonly string[]) => sql.join("?").replace(/\s+/g, " ").trim()

/** Whether a row is one a statement's own filters leave — applied, not merely inspected. */
function fits(row: LinkRow, where: LinkWhere = {}): boolean {
  // A filter this table does not understand must not pass for «everything».
  for (const key of Object.keys(where)) if (!KNOWN_FILTERS.has(key)) throw new Error(`the table was asked by an unknown filter: ${key}`)
  if (where.id !== undefined && row.id !== where.id) return false
  if (where.organizationId !== undefined && row.organizationId !== where.organizationId) return false
  if (where.agentId !== undefined && row.agentId !== where.agentId) return false
  if (where.createdAt?.gte !== undefined && !(row.createdAt.getTime() >= where.createdAt.gte.getTime())) return false
  if (where.revokedAt === null && row.revokedAt !== null) return false
  if (where.revokedAt !== undefined && where.revokedAt !== null && row.revokedAt === null) return false
  if (where.expiresAt?.gt !== undefined && !(row.expiresAt.getTime() > where.expiresAt.gt.getTime())) return false
  if (where.expiresAt?.lte !== undefined && !(row.expiresAt.getTime() <= where.expiresAt.lte.getTime())) return false
  if (where.lastViewedAt === null && row.lastViewedAt !== null) return false
  if (where.lastViewedAt?.lte !== undefined && !(row.lastViewedAt !== null && row.lastViewedAt.getTime() <= where.lastViewedAt.lte.getTime())) return false
  if (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash) return false
  if (where.OR !== undefined && !where.OR.some((either) => fits(row, either))) return false
  return true
}
const matching = (where?: LinkWhere) => links.filter((row) => fits(row, where))
const projected = (row: LinkRow, select?: Select) => Object.fromEntries(Object.keys(select ?? row).map((key) => [key, row[key as keyof LinkRow]]))
const newestFirst = (left: LinkRow, right: LinkRow) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id)

/** The table's own rules, as the migration words them. */
function refuseBrokenRow(row: LinkRow) {
  if (!/^[0-9a-f]{64}$/.test(row.tokenHash)) throw new Error('violates check constraint "mtm_location_share_links_tokenHash_check"')
  if (!(row.expiresAt.getTime() > row.createdAt.getTime())) throw new Error('violates check constraint "mtm_location_share_links_expiresAt_check"')
  if (row.viewCount < 0) throw new Error('violates check constraint "mtm_location_share_links_viewCount_check"')
  // One hash, one row — across every organization.
  if (links.some((kept) => kept.tokenHash === row.tokenHash)) throw new Error('duplicate key value violates unique constraint "mtm_location_share_links_tokenHash_key"')
  if (!agents.some((agent) => agent.id === row.agentId && agent.organizationId === row.organizationId)) {
    throw new Error('violates foreign key constraint "mtm_location_share_links_organizationId_agentId_fkey"')
  }
}

function seed(id: string, over: Partial<LinkRow> = {}): LinkRow {
  serial += 1
  const row: LinkRow = {
    id, organizationId: ORG, agentId: "agent-1", tokenHash: sha256(`seeded-${id}`),
    createdBy: "user-somebody-else", createdAt: new Date(NOW.getTime() - HOUR + serial * 1000), expiresAt: MIDNIGHT,
    revokedAt: null, revokedBy: null, viewCount: 0, lastViewedAt: null, ...over,
  }
  links.push(row)
  return row
}

// ─── The requests ───────────────────────────────────────────────────────────

const url = (suffix = "") => `http://localhost:3000/api/v1/mtm/locations/share-links${suffix}`
const list = (agentId = "agent-1") => GET(new NextRequest(url(agentId ? `?agentId=${agentId}` : "")))
const make = (body: unknown, cookie?: string) => POST(new NextRequest(url(), {
  method: "POST",
  headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
}))
const revoke = (id: string) => DELETE(new NextRequest(url(`/${id}`), { method: "DELETE" }), { params: Promise.resolve({ id }) })
const forAnHour = { agentId: "agent-1", duration: "1h" }
/** The token out of a link, as its recipient would read it from the address. */
const tokenOf = (link: string) => new URL(link, "http://localhost").pathname.split("/").pop() ?? ""

// ─── Who is asking ──────────────────────────────────────────────────────────

const signedIn = (over: Record<string, unknown> = {}) =>
  ({ orgId: ORG, userId: USER, role: "manager", email: "manager@example.com", name: "Nigar Manager", principalType: "session", ...over })

function asCard(role: "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT" | null) {
  vi.mocked(resolveMtmRouteActor).mockResolvedValue((role === null ? null : {
    agentId: role === "ADMIN" ? null : `card-${role.toLowerCase()}`,
    role,
    // A manager's people. Two of the ids are there to prove the statements,
    // not the scope: one is deactivated, one belongs to another organization.
    scopedAgentIds: role === "ADMIN" ? null : ["agent-1", "agent-2", "agent-inactive", "agent-theirs"],
  }) as never)
}

/** Every raw read the routes made, each as the statement and its values. */
const rawReads = () => vi.mocked(prisma.$queryRaw).mock.calls as unknown as Array<[readonly string[], ...unknown[]]>
const linkStatements = () => [
  prisma.mtmLocationShareLink.findMany, prisma.mtmLocationShareLink.findFirst, prisma.mtmLocationShareLink.findUnique,
  prisma.mtmLocationShareLink.count, prisma.mtmLocationShareLink.create, prisma.mtmLocationShareLink.updateMany,
  prisma.mtmLocationShareLink.update, prisma.mtmLocationShareLink.delete, prisma.mtmLocationShareLink.deleteMany,
]
function expectNothingChanged(before: string) {
  for (const statement of [
    prisma.mtmLocationShareLink.create, prisma.mtmLocationShareLink.updateMany, prisma.mtmLocationShareLink.update,
    prisma.mtmLocationShareLink.delete, prisma.mtmLocationShareLink.deleteMany,
  ]) {
    expect(statement).not.toHaveBeenCalled()
  }
  expect(JSON.stringify(links)).toBe(before)
  expect(journal).toEqual([])
}
const resetAllowances = () => {
  for (const userId of [USER, "user-admin", "user-colleague"]) {
    resetRateLimit(`mtm-location-share-links:${ORG}:${userId}`)
    resetRateLimit(`mtm-location-share-links-write:${ORG}:${userId}`)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetAllowances()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test")
  links = []
  shifts = []
  shiftEvents = []
  points = []
  journal = []
  serial = 0
  agents = [
    { id: "agent-1", organizationId: ORG, status: "ACTIVE" },
    { id: "agent-2", organizationId: ORG, status: "ACTIVE" },
    { id: "agent-of-another-manager", organizationId: ORG, status: "ACTIVE" },
    { id: "agent-inactive", organizationId: ORG, status: "INACTIVE" },
    { id: "agent-theirs", organizationId: OTHER_ORG, status: "ACTIVE" },
  ]
  users = [
    { id: USER, organizationId: ORG, name: "Nigar Manager" },
    { id: "user-somebody-else", organizationId: ORG, name: "  Tural Colleague " },
    { id: "user-of-another-organization", organizationId: OTHER_ORG, name: "Should Never Be Read" },
  ]
  // The organization has the links switched on; a test that needs them off says so.
  switchedOn = { [ORG]: true, [OTHER_ORG]: true }
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(signedIn() as never)
  asCard("MANAGER")
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "pro", addons: [], features: ["mtm"], modules: { mtm: true } } as never)

  vi.mocked(prisma.mtmSetting.findMany).mockImplementation((async (args: { where: { organizationId: string } }) =>
    args.where.organizationId in switchedOn ? [{ key: "locationShareLinksEnabled", value: switchedOn[args.where.organizationId] }] : []) as never)
  // The same row as a creation asks for it a second time, behind the
  // employee's lock: by organization and key, held until the transaction
  // ends. The statement's own organization is applied to the table, and a
  // statement this table does not know is refused, not answered «nothing».
  vi.mocked(prisma.$queryRaw).mockImplementation((async (sql: readonly string[], ...values: unknown[]) => {
    if (worded(sql) !== SWITCH_ROW_HELD) throw new Error(`the table was asked what it does not know: ${worded(sql)}`)
    const [organizationId] = values as [string]
    return organizationId in switchedOn ? [{ value: switchedOn[organizationId] }] : []
  }) as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockImplementation((async (args: { where: { id?: string; organizationId?: string; status?: string }; select?: Record<string, unknown> }) => {
    const { id, organizationId, status } = args.where
    const found = agents.find((agent) => agent.id === id && agent.organizationId === organizationId && (status === undefined || agent.status === status))
    if (!found) return null
    // The public answer reads the employee together with his organization; the managers' routes read his id.
    return args.select?.organization
      ? { name: "Shown Courier", organization: { name: "Delivery Example LLC", isActive: true, plan: "pro", addons: [], features: ["mtm"], modules: { mtm: true } } }
      : { id: found.id }
  }) as never)
  // His shift, its journal and his points: small tables that apply the
  // statements' own filters, as the links' table does.
  vi.mocked(prisma.mtmAgentWorkday.findMany).mockImplementation((async (args: {
    where: { organizationId?: string; agentId?: string; OR?: Array<{ status?: { in: string[] }; workDate?: Date }> }
    take?: number
    select?: Select
  }) => shifts
    .filter((day) => day.organizationId === args.where.organizationId && day.agentId === args.where.agentId
      && (args.where.OR ?? []).some((either) => either.status?.in.includes(day.status) || either.workDate?.getTime() === day.workDate.getTime()))
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
    .slice(0, args.take ?? shifts.length)
    .map((day) => Object.fromEntries(Object.keys(args.select ?? day).map((key) => [key, day[key as keyof ShiftRow]])))) as never)
  vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockImplementation((async (args: {
    where: { organizationId?: string; agentId?: string; workdayId?: string; type?: { in: string[] } }
  }) => shiftEvents.filter((event) => event.organizationId === args.where.organizationId && event.agentId === args.where.agentId
    && event.workdayId === args.where.workdayId && (args.where.type?.in.includes(event.type) ?? true))) as never)
  vi.mocked(prisma.mtmAgentLocation.findFirst).mockImplementation((async (args: {
    where: { organizationId?: string; agentId?: string; recordedAt?: { gte: Date; lte: Date }; OR?: Array<{ accuracy: null | { gte: number; lte: number } }> }
  }) => points
    .filter((point) => point.organizationId === args.where.organizationId && point.agentId === args.where.agentId
      && (!args.where.recordedAt || (point.recordedAt.getTime() >= args.where.recordedAt.gte.getTime() && point.recordedAt.getTime() <= args.where.recordedAt.lte.getTime()))
      && (args.where.OR ?? [{ accuracy: null }]).some((either) => either.accuracy === null
        ? point.accuracy === null
        : point.accuracy !== null && point.accuracy >= either.accuracy.gte && point.accuracy <= either.accuracy.lte))
    .sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime())[0] ?? null) as never)
  vi.mocked(prisma.user.findMany).mockImplementation((async (args: { where: { organizationId: string; id: { in: string[] } } }) =>
    users.filter((user) => user.organizationId === args.where.organizationId && args.where.id.in.includes(user.id))
      .map((user) => ({ id: user.id, name: user.name }))) as never)

  vi.mocked(prisma.mtmLocationShareLink.findMany).mockImplementation((async (args: { where?: LinkWhere; take?: number; select?: Select }) =>
    matching(args.where).sort(newestFirst).slice(0, args.take ?? links.length).map((row) => projected(row, args.select))) as never)
  vi.mocked(prisma.mtmLocationShareLink.findFirst).mockImplementation((async (args: { where?: LinkWhere; select?: Select }) => {
    const row = matching(args.where)[0]
    return row ? projected(row, args.select) : null
  }) as never)
  vi.mocked(prisma.mtmLocationShareLink.findUnique).mockImplementation((async (args: { where?: LinkWhere; select?: Select }) => {
    const row = matching(args.where)[0]
    return row ? projected(row, args.select) : null
  }) as never)
  vi.mocked(prisma.mtmLocationShareLink.count).mockImplementation((async (args: { where?: LinkWhere }) => matching(args.where).length) as never)
  vi.mocked(prisma.mtmLocationShareLink.create).mockImplementation((async (args: { data: Partial<LinkRow>; select?: Select }) => {
    const row: LinkRow = {
      // A column the statement did not name gets what the table would give it.
      organizationId: "", agentId: "", tokenHash: "", createdBy: null, createdAt: new Date(), expiresAt: new Date(Number.NaN),
      revokedAt: null, revokedBy: null, viewCount: 0, lastViewedAt: null, ...args.data, id: `link-${links.length + 1}`,
    }
    refuseBrokenRow(row)
    links.push(row)
    return projected(row, args.select)
  }) as never)
  vi.mocked(prisma.mtmLocationShareLink.updateMany).mockImplementation((async (args: { where?: LinkWhere; data: Partial<Omit<LinkRow, "viewCount">> & { viewCount?: { increment: number } } }) => {
    const rows = matching(args.where)
    for (const row of rows) {
      const { viewCount, ...plain } = args.data
      Object.assign(row, plain)
      row.viewCount += viewCount?.increment ?? 0
    }
    return { count: rows.length }
  }) as never)
  vi.mocked(prisma.mtmAuditLog.create).mockImplementation((async (args: { data: Record<string, unknown> }) => {
    journal.push(args.data)
    return { id: `audit-${journal.length}` }
  }) as never)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("a link to an employee's position", () => {
  it("is made by a manager for his employee, handed over once, and then listed without the link itself", async () => {
    const made = await make(forAnHour)
    expect(made.status).toBe(201)
    const body = await made.json()
    expect(body).toEqual({
      success: true,
      data: {
        link: {
          id: "link-1", createdAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + HOUR).toISOString(),
          revokedAt: null, viewCount: 0, lastViewedAt: null, createdByName: "Nigar Manager", alive: true,
        },
        url: expect.stringMatching(/^https:\/\/app\.example\.test\/share\/location\/[a-f0-9]{64}\?lang=ru$/),
      },
    })

    const listed = await list()
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({
      success: true,
      // He has not started a shift: a link to him shows nothing at this moment, and the card is told so.
      data: { links: [body.data.link], access: { enabled: true, canWrite: true }, showsNow: false },
    })
  })

  it("keeps the SHA-256 of the token and the token nowhere — not in a column, not in the journal, not in any later answer", async () => {
    const body = await (await make(forAnHour)).json()
    const token = tokenOf(body.data.url)
    expect(token).toMatch(/^[a-f0-9]{64}$/)
    const hash = sha256(token)

    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ organizationId: ORG, agentId: "agent-1", tokenHash: hash, createdBy: USER, revokedAt: null, viewCount: 0 })
    expect(Object.values(links[0])).not.toContain(token)
    expect(JSON.stringify(links)).not.toContain(token)
    expect(JSON.stringify(journal)).not.toContain(token)
    expect(JSON.stringify(journal)).not.toContain(hash)
    // The answer that hands the link over does not carry the hash beside it.
    expect(JSON.stringify(body)).not.toContain(hash)

    const listedText = await (await list()).text()
    expect(listedText).not.toContain(token)
    expect(listedText).not.toContain(hash)
    expect(listedText).not.toMatch(/token|hash|url/i)
    // And revoking it answers with the id and the moment, nothing that leads back.
    const revokedText = await (await revoke("link-1")).text()
    expect(revokedText).not.toContain(token)
    expect(revokedText).not.toContain(hash)
  })

  it("makes a new token every time: the same request twice is two links, and neither opens the other", async () => {
    const first = tokenOf((await (await make(forAnHour)).json()).data.url)
    const second = tokenOf((await (await make(forAnHour)).json()).data.url)
    expect(second).not.toBe(first)
    expect(links.map((row) => row.tokenHash)).toEqual([sha256(first), sha256(second)])
  })

  it("an administrator makes one for anybody in the organization, with no MTM card of his own", async () => {
    vi.mocked(requireAuth).mockResolvedValue(signedIn({ role: "admin", userId: "user-admin", name: "Admin" }) as never)
    asCard("ADMIN")
    const made = await make({ agentId: "agent-of-another-manager", duration: "day" })
    expect(made.status).toBe(201)
    expect(links[0]).toMatchObject({ agentId: "agent-of-another-manager", createdBy: "user-admin", expiresAt: MIDNIGHT })
  })

  it("is read in the language of the manager who made it, and in Russian when his browser names no language of ours", async () => {
    const langOf = async (cookie?: string) => new URL((await (await make(forAnHour, cookie)).json()).data.url).searchParams.get("lang")
    expect(await langOf("NEXT_LOCALE=az")).toBe("az")
    expect(await langOf("other=1; NEXT_LOCALE=en")).toBe("en")
    expect(await langOf()).toBe("ru")
    expect(await langOf("NEXT_LOCALE=de")).toBe("ru")
    expect(await langOf("NEXT_LOCALE=az%26next%3D%2F%2Fevil.example")).toBe("ru")
  })
})

describe("until when it works", () => {
  const expiryOf = async (duration: string) => {
    const response = await make({ agentId: "agent-1", duration })
    expect(response.status, duration).toBe(201)
    const { link } = (await response.json()).data
    // What the manager is told is what the table holds.
    expect(links[links.length - 1].expiresAt.toISOString()).toBe(link.expiresAt)
    return link.expiresAt as string
  }

  it("is decided by the server from the button pressed: an hour, four hours, or the organization's midnight", async () => {
    expect(await expiryOf("1h")).toBe("2026-10-10T09:00:00.000Z")
    expect(await expiryOf("4h")).toBe("2026-10-10T12:00:00.000Z")
    expect(await expiryOf("day")).toBe(MIDNIGHT.toISOString())
  })

  it("never runs past the organization's midnight, and the answer says the real moment", async () => {
    // 22:30 in Baku.
    vi.setSystemTime(new Date("2026-10-10T18:30:00.000Z"))
    expect(await expiryOf("4h")).toBe(MIDNIGHT.toISOString())
    expect(await expiryOf("1h")).toBe("2026-10-10T19:30:00.000Z")
  })

  it("counts the day in the organization's own zone, and in UTC when the stored zone cannot be read", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "locationShareLinksEnabled", value: true }, { key: "timezone", value: "Europe/London" },
    ] as never)
    // London is an hour ahead of UTC on 10 October.
    expect(await expiryOf("day")).toBe("2026-10-10T23:00:00.000Z")
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "locationShareLinksEnabled", value: true }, { key: "timezone", value: "Mars/Olympus" },
    ] as never)
    expect(await expiryOf("day")).toBe("2026-10-11T00:00:00.000Z")
  })

  it.each([
    ["a moment of expiry of the browser's own", { ...forAnHour, expiresAt: "2027-01-01T00:00:00.000Z" }],
    ["a week", { agentId: "agent-1", duration: "7d" }],
    ["two hours — not one of the three buttons", { agentId: "agent-1", duration: "2h" }],
    ["a number of minutes", { agentId: "agent-1", duration: 60 }],
    ["no duration", { agentId: "agent-1" }],
    ["no employee", { duration: "1h" }],
    ["an employee that is not a name of anything", { agentId: "   ", duration: "1h" }],
    ["somebody else's organization named in the request", { ...forAnHour, organizationId: OTHER_ORG }],
    ["nothing", null],
  ])("refuses %s with 400, and no link is made or journalled", async (_what, body) => {
    const response = await make(body)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "Validation failed" })
    expect(prisma.mtmLocationShareLink.count).not.toHaveBeenCalled()
    expectNothingChanged("[]")
  })

  it("refuses a request that is not JSON at all", async () => {
    const response = await POST(new NextRequest(url(), { method: "POST", body: "{agentId:" }))
    expect(response.status).toBe(400)
    expectNothingChanged("[]")
  })
})

describe("whose position", () => {
  it("only an employee of the manager's own: another manager's, a deactivated one, another organization's and nobody at all read the same 404", async () => {
    const answers: string[] = []
    for (const agentId of ["agent-of-another-manager", "agent-inactive", "agent-theirs", "agent-nobody"]) {
      for (const response of [await make({ agentId, duration: "1h" }), await list(agentId)]) {
        expect(response.status, agentId).toBe(404)
        answers.push(await response.text())
      }
    }
    // Byte for byte: the answer does not tell «не ваш» from «нет такого».
    expect(new Set(answers)).toEqual(new Set(['{"error":"Not found","code":"MTM_LOCATION_SHARE_LINK_NOT_FOUND"}']))
    for (const statement of linkStatements()) expect(statement).not.toHaveBeenCalled()
    expectNothingChanged("[]")
  })

  it("reads nothing at all about an employee outside the manager's scope — not even whether he exists", async () => {
    await make({ agentId: "agent-of-another-manager", duration: "1h" })
    await list("agent-of-another-manager")
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    // Asked of his own employee, the same statement names the organization and «active».
    await list("agent-1")
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledWith({ where: { id: "agent-1", organizationId: ORG, status: "ACTIVE", fieldDeletedAt: null }, select: { id: true } })
  })

  it("lists one employee's links and nobody else's: not a colleague's, not another organization's", async () => {
    seed("mine")
    seed("of-the-second-employee", { agentId: "agent-2" })
    seed("of-another-organization", { organizationId: OTHER_ORG, agentId: "agent-theirs" })
    // The same employee id under another organization: the organization is in the statement itself.
    seed("same-id-elsewhere", { organizationId: OTHER_ORG, agentId: "agent-1" })
    const { data } = await (await list("agent-1")).json()
    expect(data.links.map((link: { id: string }) => link.id)).toEqual(["mine"])
    expect((await (await list("agent-2")).json()).data.links.map((link: { id: string }) => link.id)).toEqual(["of-the-second-employee"])
  })

  it("asks for an employee by name: a list for nobody in particular is refused", async () => {
    seed("mine")
    const response = await list("")
    expect(response.status).toBe(400)
    for (const statement of linkStatements()) expect(statement).not.toHaveBeenCalled()
  })
})

describe("what the card is told about each link", () => {
  it("is until when, who made it and how many times it was opened — and nothing that is the organization's or the table's own", async () => {
    seed("opened", { viewCount: 7, lastViewedAt: new Date("2026-10-10T07:55:00.000Z") })
    const { data } = await (await list()).json()
    expect(data.links).toEqual([{
      id: "opened", createdAt: links[0].createdAt.toISOString(), expiresAt: MIDNIGHT.toISOString(), revokedAt: null,
      viewCount: 7, lastViewedAt: "2026-10-10T07:55:00.000Z", createdByName: "Tural Colleague", alive: true,
    }])
    expect(JSON.stringify(data)).not.toMatch(/org-1|organizationId|agentId|createdBy"|revokedBy|user-somebody-else/)
  })

  it("puts the working links first, newest on top, then the last few that no longer work — and says which is which", async () => {
    seed("revoked", { revokedAt: new Date("2026-10-10T07:30:00.000Z"), revokedBy: USER })
    seed("ran-out", { expiresAt: new Date("2026-10-10T07:59:59.000Z") })
    seed("ends-this-instant", { expiresAt: NOW })
    seed("working-older")
    seed("working-newer")
    const { data } = await (await list()).json()
    expect(data.links.map((link: { id: string; alive: boolean }) => [link.id, link.alive])).toEqual([
      ["working-newer", true], ["working-older", true],
      ["ends-this-instant", false], ["ran-out", false], ["revoked", false],
    ])
    expect(data.links[4].revokedAt).toBe("2026-10-10T07:30:00.000Z")
  })

  it("does not grow with the day: of the links that no longer work only the last five are shown, and every working one always is", async () => {
    for (let index = 0; index < 9; index += 1) seed(`past-${index}`, { revokedAt: new Date("2026-10-10T07:45:00.000Z") })
    for (let index = 0; index < LOCATION_SHARE_LINK_ALIVE_LIMIT; index += 1) seed(`working-${index}`)
    const { data } = await (await list()).json()
    const shown = data.links.map((link: { id: string }) => link.id)
    expect(shown.filter((id: string) => id.startsWith("working-"))).toHaveLength(LOCATION_SHARE_LINK_ALIVE_LIMIT)
    expect(shown.filter((id: string) => id.startsWith("past-"))).toEqual(["past-8", "past-7", "past-6", "past-5", "past-4"])
  })

  // Every link ends at the organization's midnight at the latest. Without a
  // bound, one link made on 3 October stood under his card as «Срок истёк:
  // 4 окт.» every day after.
  it("lists the links that no longer work only from the organization's today — yesterday's are not this card's news", async () => {
    // Baku's today began at 20:00Z of the 9th.
    seed("made-yesterday-evening", { createdAt: new Date("2026-10-09T19:59:59.999Z"), expiresAt: new Date("2026-10-09T20:00:00.000Z") })
    seed("revoked-last-week", { createdAt: new Date("2026-10-03T08:00:00.000Z"), expiresAt: new Date("2026-10-03T20:00:00.000Z"), revokedAt: new Date("2026-10-03T09:00:00.000Z") })
    seed("made-at-midnight", { createdAt: new Date("2026-10-09T20:00:00.000Z"), expiresAt: new Date("2026-10-09T21:00:00.000Z") })
    seed("revoked-this-morning", { createdAt: new Date("2026-10-10T05:00:00.000Z"), revokedAt: new Date("2026-10-10T06:00:00.000Z") })
    seed("working")
    const ids = async () => ((await (await list()).json()).data.links as Array<{ id: string }>).map((link) => link.id)
    expect(await ids()).toEqual(["working", "revoked-this-morning", "made-at-midnight"])

    // The day is the organization's own: one that lives by UTC began its 10th at 00:00Z…
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "locationShareLinksEnabled", value: true }, { key: "timezone", value: "UTC" },
    ] as never)
    expect(await ids()).toEqual(["working", "revoked-this-morning"])
    // …and one in Honolulu is still in its 9th at 08:00Z — a day that began at 10:00Z of the 9th.
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "locationShareLinksEnabled", value: true }, { key: "timezone", value: "Pacific/Honolulu" },
    ] as never)
    expect(await ids()).toEqual(["working", "revoked-this-morning", "made-at-midnight", "made-yesterday-evening"])
  })

  it("a working link is listed whenever it was made — the bound is only for the ones that no longer work", async () => {
    // A row from before today that the table still holds as working (it cannot be made by the routes; it must stay revocable).
    seed("old-and-working", { createdAt: new Date("2026-10-08T08:00:00.000Z"), expiresAt: MIDNIGHT })
    const { data } = await (await list()).json()
    expect(data.links.map((link: { id: string; alive: boolean }) => [link.id, link.alive])).toEqual([["old-and-working", true]])
  })

  it("names who made a link only from this organization's people, and leaves the name out when it cannot be read", async () => {
    seed("by-a-stranger", { createdBy: "user-of-another-organization" })
    seed("by-nobody-known", { createdBy: null })
    seed("by-a-colleague")
    const names = async () => Object.fromEntries(((await (await list()).json()).data.links as Array<{ id: string; createdByName: string | null }>)
      .map((link) => [link.id, link.createdByName]))
    expect(await names()).toEqual({ "by-a-colleague": "Tural Colleague", "by-nobody-known": null, "by-a-stranger": null })

    // The names are a courtesy: the list is not worth failing over them.
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(prisma.user.findMany).mockRejectedValueOnce(new Error("users are unavailable") as never)
    expect(await names()).toEqual({ "by-a-colleague": null, "by-nobody-known": null, "by-a-stranger": null })
  })
})

// The outsider's page says «Сейчас местоположение недоступно» and, on purpose,
// not why. The manager who sent the link sees the employee's marker on his
// own map all the same (the managers' map is laxer) and has nothing to go on.
// So the list tells the card whether a link shows a point RIGHT NOW — by the
// very reads and the very rule the public answer uses, not a copy of them.
describe("whether a link shows anything right now", () => {
  const TOKEN = "f".repeat(64)
  const IP = "203.0.113.70"
  const MINUTE = 60 * 1000
  const before = (ms: number) => new Date(NOW.getTime() - ms)
  const TODAY = new Date("2026-10-10T00:00:00.000Z")
  const onShift = (over: Partial<ShiftRow> = {}): ShiftRow => {
    const row = { id: `shift-${shifts.length + 1}`, organizationId: ORG, agentId: "agent-1", workDate: TODAY, status: "STARTED", startedAt: new Date("2026-10-10T05:00:00.000Z"), ...over }
    shifts.push(row)
    return row
  }
  const point = (over: Partial<PointRow> = {}): PointRow => {
    const row = { organizationId: ORG, agentId: "agent-1", latitude: 40.4093, longitude: 49.8671, accuracy: 12, recordedAt: before(3 * MINUTE), ...over }
    points.push(row)
    return row
  }
  const journal = (type: string, occurredAt: Date, of: ShiftRow = shifts[0]) =>
    shiftEvents.push({ organizationId: of.organizationId, agentId: of.agentId, workdayId: of.id, type, occurredAt, appliedAt: occurredAt })
  const stretched = () => vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
    { key: "locationShareLinksEnabled", value: true }, { key: "offlineThresholdSeconds", value: 86_400 }, { key: "locationWindowMinutes", value: 1_440 },
  ] as never)

  /** What the list tells the card. */
  const told = async (agentId = "agent-1") => (await (await list(agentId)).json()).data as { showsNow?: boolean; access: { enabled: boolean } }
  /** What somebody holding a working link to him is answered, at the same moment. */
  const outsiderSees = async () => {
    const response = await OPEN_LINK(
      new NextRequest(`http://localhost:3000/api/v1/public/location-share/${TOKEN}`, { headers: { "x-real-ip": IP } }),
      { params: Promise.resolve({ token: TOKEN }) },
    )
    return (await response.json()).state as string
  }

  beforeEach(() => {
    seed("handed-out", { tokenHash: sha256(TOKEN) })
  })
  afterEach(() => resetRateLimit(`mtm-location-share-link-view:${IP}:${sha256(TOKEN).slice(0, 16)}`))

  const moments: Array<[string, () => void, boolean]> = [
    ["he is on shift and his phone reported three minutes ago", () => { onShift(); point() }, true],
    ["he has not started a shift today", () => { point() }, false],
    ["he is on a break", () => { onShift({ status: "PAUSED" }); point() }, false],
    ["he closed his day", () => { onShift({ status: "COMPLETED" }); point() }, false],
    ["his shift was left open since yesterday — the managers' map still calls it running", () => {
      onShift({ workDate: new Date("2026-10-09T00:00:00.000Z"), startedAt: new Date("2026-10-09T05:00:00.000Z") }); point()
    }, false],
    ["his phone has been silent for eleven minutes — ten is the limit as the settings ship, not fifteen", () => { onShift(); point({ recordedAt: before(11 * MINUTE) }) }, false],
    ["the organization stretched «свежая» to a day and the point is fourteen minutes old", () => { stretched(); onShift(); point({ recordedAt: before(14 * MINUTE) }) }, true],
    ["the organization stretched «свежая» to a day and the point is sixteen minutes old", () => { stretched(); onShift(); point({ recordedAt: before(16 * MINUTE) }) }, false],
    ["the only point is too vague to be a position", () => { onShift(); point({ accuracy: 150 }) }, false],
    ["he is back from a break and the only point is from the break", () => {
      onShift(); journal("PAUSE", before(9 * MINUTE)); journal("RESUME", before(4 * MINUTE)); point({ recordedAt: before(6 * MINUTE) })
    }, false],
    ["he is back from a break and the phone has reported since", () => {
      onShift(); journal("PAUSE", before(9 * MINUTE)); journal("RESUME", before(4 * MINUTE)); point({ recordedAt: before(6 * MINUTE) }); point({ recordedAt: before(2 * MINUTE) })
    }, true],
    ["only a colleague is on shift with a fresh point", () => { onShift({ agentId: "agent-2" }); point({ agentId: "agent-2" }) }, false],
    ["the shift and the point are another organization's employee of the same id", () => { onShift({ organizationId: OTHER_ORG }); point({ organizationId: OTHER_ORG }) }, false],
  ]

  it.each(moments)("when %s, the card is told exactly what the outsider is shown", async (_when, arrange, shown) => {
    arrange()
    expect((await told()).showsNow).toBe(shown)
    expect(await outsiderSees()).toBe(shown ? "AVAILABLE" : "UNAVAILABLE")
  })

  it("is about the employee the card is open on, and is told to a supervisor as well", async () => {
    onShift({ agentId: "agent-2" })
    point({ agentId: "agent-2" })
    expect((await told("agent-1")).showsNow).toBe(false)
    expect((await told("agent-2")).showsNow).toBe(true)
    vi.mocked(requireAuth).mockResolvedValue(signedIn({ role: "sales" }) as never)
    asCard("SUPERVISOR")
    expect((await told("agent-2")).showsNow).toBe(true)
  })

  it("is one function for both answers: neither route keeps reads or a rule of its own", () => {
    const listRoute = readFileSync("src/app/api/v1/mtm/locations/share-links/route.ts", "utf8")
    const publicRoute = readFileSync("src/app/api/v1/public/location-share/[token]/route.ts", "utf8")
    for (const [name, source] of [["the list", listRoute], ["the public answer", publicRoute]] as const) {
      expect(source, name).toContain("readLocationShareLinkPosition(")
      // His shift, its journal, his points and the rule are asked in one place only.
      for (const own of ["mtmAgentWorkday", "mtmAgentWorkdayEvent", "mtmAgentLocation", "locationShareLinkPositionFor", "liveMapWorkdayOf"]) {
        expect(source, `${name}: ${own}`).not.toContain(own)
      }
    }
  })

  it("is left out while the organization has the links switched off — nothing shows then, and nothing of his shift is read", async () => {
    onShift()
    point()
    switchedOn = { [ORG]: false }
    const data = await told()
    expect(data.access.enabled).toBe(false)
    expect(data).not.toHaveProperty("showsNow")
    for (const statement of [prisma.mtmAgentWorkday.findMany, prisma.mtmAgentWorkdayEvent.findMany, prisma.mtmAgentLocation.findFirst]) {
      expect(statement).not.toHaveBeenCalled()
    }
  })

  it("is left out, and the list is answered all the same, when his shift or his points cannot be read — never a guess", async () => {
    onShift()
    point()
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {})
    for (const statement of [prisma.mtmAgentWorkday.findMany, prisma.mtmAgentWorkdayEvent.findMany, prisma.mtmAgentLocation.findFirst]) {
      vi.mocked(statement).mockRejectedValueOnce(new Error("the table is unavailable") as never)
      const response = await list()
      expect(response.status).toBe(200)
      const { data } = await response.json()
      expect(data).not.toHaveProperty("showsNow")
      expect(data.links.map((link: { id: string }) => link.id)).toEqual(["handed-out"])
    }
    expect(warned).toHaveBeenCalledTimes(3)
    // Read again, it is told again.
    expect((await told()).showsNow).toBe(true)
  })

  it("is not asked for an employee the viewer may not see: nothing of his shift is read", async () => {
    onShift({ agentId: "agent-of-another-manager" })
    point({ agentId: "agent-of-another-manager" })
    expect((await list("agent-of-another-manager")).status).toBe(404)
    expect(prisma.mtmAgentWorkday.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgentLocation.findFirst).not.toHaveBeenCalled()
  })
})

describe("who may not", () => {
  it("is the managers' screen: a field employee and a web user without an MTM card are refused everything, and no statement is run", async () => {
    seed("a")
    const before = JSON.stringify(links)
    for (const card of ["AGENT", null] as const) {
      asCard(card)
      for (const response of [await list(), await make(forAnHour), await revoke("a")]) {
        expect(response.status).toBe(403)
        expect(await response.json()).toMatchObject({ code: "MTM_LOCATION_SHARE_LINK_MANAGER_REQUIRED" })
      }
    }
    for (const statement of [...linkStatements(), prisma.mtmAgent.findFirst, prisma.mtmSetting.findMany, prisma.user.findMany]) {
      expect(statement).not.toHaveBeenCalled()
    }
    expectNothingChanged(before)
  })

  it("an integration key gets nothing — not the list either — and its card is not even looked up", async () => {
    seed("a")
    const before = JSON.stringify(links)
    // A key acts as the organization's administrator; what it is not is a person.
    for (const provenance of [{ principalType: "api_key" }, { principalType: undefined }]) {
      vi.mocked(requireAuth).mockResolvedValue(signedIn({ role: "admin", name: "API Key: integration", ...provenance }) as never)
      asCard("ADMIN")
      for (const response of [await list(), await make(forAnHour), await revoke("a")]) {
        expect(response.status).toBe(403)
        expect(await response.json()).toMatchObject({ code: "MTM_LOCATION_SHARE_LINK_SESSION_REQUIRED" })
      }
    }
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    for (const statement of [...linkStatements(), prisma.mtmAgent.findFirst, prisma.mtmSetting.findMany, prisma.user.findMany]) {
      expect(statement).not.toHaveBeenCalled()
    }
    expectNothingChanged(before)
  })

  it("a supervisor sees that a link exists and makes or revokes none: both are refused with their own code and nothing is touched", async () => {
    seed("a")
    const before = JSON.stringify(links)
    vi.mocked(requireAuth).mockResolvedValue(signedIn({ role: "sales" }) as never)
    asCard("SUPERVISOR")
    const { data } = await (await list()).json()
    expect(data.links.map((link: { id: string }) => link.id)).toEqual(["a"])
    expect(data.access).toEqual({ enabled: true, canWrite: false })
    for (const response of [await make(forAnHour), await revoke("a")]) {
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: "MTM_LOCATION_SHARE_LINK_READ_ONLY" })
    }
    expect(prisma.mtmLocationShareLink.findFirst).not.toHaveBeenCalled()
    expectNothingChanged(before)
  })

  it("answers who before what: a supervisor sending nonsense is told 403, not 400", async () => {
    asCard("SUPERVISOR")
    const response = await make({ duration: "forever" })
    expect(response.status).toBe(403)
    expectNothingChanged("[]")
  })

  it("a web role that may only look at Route & Field gets no button, whatever the MTM card says", async () => {
    vi.mocked(requireAuth).mockResolvedValue(signedIn({ role: "support" }) as never)
    asCard("MANAGER")
    expect((await (await list()).json()).data.access).toEqual({ enabled: true, canWrite: false })
    const response = await make(forAnHour)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_LOCATION_SHARE_LINK_READ_ONLY" })
    expectNothingChanged("[]")
  })

  it("is for signed-in people of an organization that has the module", async () => {
    seed("a")
    const before = JSON.stringify(links)
    // A manager, signed in — of an organization that does not have Route & Field.
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "starter", addons: [], features: [], modules: {}, settings: {} } as never)
    for (const response of [await list(), await make(forAnHour), await revoke("a")]) {
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: "TENANT_CAPABILITY_DISABLED" })
    }
    // Turned away at the door: nobody was even asked what his card in the module says.
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()

    // An organization that has it — and nobody signed in.
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "pro", addons: [], features: ["mtm"], modules: { mtm: true } } as never)
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
    for (const response of [await list(), await make(forAnHour), await revoke("a")]) {
      expect(response.status).toBe(401)
    }
    for (const statement of linkStatements()) expect(statement).not.toHaveBeenCalled()
    expectNothingChanged(before)
  })
})

describe("the organization's switch", () => {
  it("is off until somebody switches it on: an organization that never touched the setting makes no link", async () => {
    switchedOn = {}
    const response = await make(forAnHour)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: "The organization has location links switched off",
      code: "MTM_LOCATION_SHARE_LINK_DISABLED",
      setting: "locationShareLinksEnabled",
    })
    for (const statement of [prisma.mtmLocationShareLink.count, prisma.mtmAgent.findFirst]) expect(statement).not.toHaveBeenCalled()
    expectNothingChanged("[]")
  })

  it.each([
    ["switched off", false],
    ["stored as something that is not a yes", "maybe"],
    ["stored as nothing", null],
  ])("%s, no link is made — by a manager or by an administrator", async (_what, value) => {
    switchedOn = { [ORG]: value }
    expect((await make(forAnHour)).status).toBe(403)
    vi.mocked(requireAuth).mockResolvedValue(signedIn({ role: "admin", userId: "user-admin" }) as never)
    asCard("ADMIN")
    const response = await make(forAnHour)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_LOCATION_SHARE_LINK_DISABLED" })
    expectNothingChanged("[]")
  })

  it("is read from this organization's settings, not from another's that has the links on", async () => {
    switchedOn = { [OTHER_ORG]: true }
    expect((await make(forAnHour)).status).toBe(403)
    expect(prisma.mtmSetting.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: ORG } }))
  })

  it("answers «switched off» before it reads what was asked: a manager's nonsense is 403 while it is off", async () => {
    switchedOn = { [ORG]: false }
    const response = await make({ duration: "forever" })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_LOCATION_SHARE_LINK_DISABLED" })
  })

  // The look at the switch at the top of a creation is taken before the wait
  // for the employee's lock. A save that switches the links off during that
  // wait ends every link there is — and this one would be made after it,
  // ended by nobody: dead while off, working again once the switch is back
  // on. So the switch is asked once more behind the lock, with its row held.
  // That the save and the creation then really take turns only Postgres can
  // show (mtm-contact-categories-postgres.test.ts switches off through the
  // real save while a creation waits); here: what a creation does with what
  // it reads the second time.
  it.each([
    ["switched off", false],
    ["set to something that is not a yes", "maybe"],
    ["emptied", null],
    ["taken out of the table altogether", undefined],
  ])("%s while a creation waits for the employee's lock: it is refused as «switched off», and nothing is counted, made or journalled", async (_what, value) => {
    // What the wait for the lock lets happen: by the time it is granted, the organization's row reads differently.
    vi.mocked(prisma.$executeRaw).mockImplementationOnce((async () => {
      if (value === undefined) delete switchedOn[ORG]
      else switchedOn[ORG] = value
      return 0
    }) as never)
    const response = await make(forAnHour)
    expect(response.status).toBe(403)
    // The same answer as a creation that found the links off at the door.
    expect(await response.json()).toEqual({
      error: "The organization has location links switched off",
      code: "MTM_LOCATION_SHARE_LINK_DISABLED",
      setting: "locationShareLinksEnabled",
    })
    // It had got as far as the lock — the first look said «on» — and went no further.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prisma.mtmLocationShareLink.count).not.toHaveBeenCalled()
    expectNothingChanged("[]")
  })

  it("another organization switching its links off during that wait refuses nobody here", async () => {
    vi.mocked(prisma.$executeRaw).mockImplementationOnce((async () => {
      switchedOn[OTHER_ORG] = false
      return 0
    }) as never)
    expect((await make(forAnHour)).status).toBe(201)
    expect(rawReads().map(([, organizationId]) => organizationId)).toEqual([ORG])
  })

  it("still lists and still revokes while it is off — a link made before must not wait for the switch to come back on", async () => {
    await make(forAnHour)
    switchedOn = { [ORG]: false }
    const { data } = await (await list()).json()
    expect(data.access).toEqual({ enabled: false, canWrite: true })
    expect(data.links.map((link: { id: string }) => link.id)).toEqual(["link-1"])
    const revoked = await revoke("link-1")
    expect(revoked.status).toBe(200)
    expect(links[0].revokedAt).toEqual(NOW)
  })
})

describe("revoking", () => {
  it("marks the link instead of deleting it, says who did and when, and the list then shows it as one that no longer works", async () => {
    seed("a")
    vi.setSystemTime(new Date("2026-10-10T08:20:00.000Z"))
    const response = await revoke("a")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { id: "a", revokedAt: "2026-10-10T08:20:00.000Z" } })
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ id: "a", revokedAt: new Date("2026-10-10T08:20:00.000Z"), revokedBy: USER, expiresAt: MIDNIGHT })
    expect(prisma.mtmLocationShareLink.delete).not.toHaveBeenCalled()
    expect(prisma.mtmLocationShareLink.deleteMany).not.toHaveBeenCalled()
    const { data } = await (await list()).json()
    expect(data.links).toEqual([expect.objectContaining({ id: "a", alive: false, revokedAt: "2026-10-10T08:20:00.000Z" })])
  })

  it("another organization's link does not exist here: 404, and its row is not touched", async () => {
    seed("theirs", { organizationId: OTHER_ORG, agentId: "agent-theirs" })
    // Even under an employee id this manager does have in his scope.
    seed("theirs-same-employee-id", { organizationId: OTHER_ORG, agentId: "agent-1" })
    const before = JSON.stringify(links)
    for (const id of ["theirs", "theirs-same-employee-id"]) {
      const response = await revoke(id)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: "Not found", code: "MTM_LOCATION_SHARE_LINK_NOT_FOUND" })
    }
    expectNothingChanged(before)
  })

  it("a link to an employee outside the manager's scope reads as if it were not there; an administrator revokes it", async () => {
    seed("of-another-manager", { agentId: "agent-of-another-manager" })
    const before = JSON.stringify(links)
    expect((await revoke("of-another-manager")).status).toBe(404)
    expectNothingChanged(before)

    vi.mocked(requireAuth).mockResolvedValue(signedIn({ role: "admin", userId: "user-admin" }) as never)
    asCard("ADMIN")
    expect((await revoke("of-another-manager")).status).toBe(200)
    expect(links[0]).toMatchObject({ revokedAt: NOW, revokedBy: "user-admin" })
  })

  it("is done once: revoking again, and revoking what never was a link, answer 404 and journal nothing", async () => {
    seed("a")
    expect((await revoke("a")).status).toBe(200)
    const after = JSON.stringify(links)
    journal = []
    vi.mocked(prisma.mtmLocationShareLink.updateMany).mockClear()
    for (const id of ["a", "no-such-link"]) {
      const response = await revoke(id)
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ code: "MTM_LOCATION_SHARE_LINK_NOT_FOUND" })
    }
    expectNothingChanged(after)
  })

  it("a link two people revoke at the same moment is revoked once: the second is told 404, journals nothing, and the first mark stands", async () => {
    const row = seed("a")
    const firstRevocation = new Date("2026-10-10T07:59:00.000Z")
    vi.mocked(prisma.mtmLocationShareLink.findFirst).mockImplementationOnce((async (args: { where?: LinkWhere; select?: Select }) => {
      const found = matching(args.where)[0]
      // Found — and revoked by a colleague before the statement that writes.
      row.revokedAt = firstRevocation
      row.revokedBy = "user-colleague"
      return found ? projected(found, args.select) : null
    }) as never)
    const response = await revoke("a")
    expect(response.status).toBe(404)
    expect(row).toMatchObject({ revokedAt: firstRevocation, revokedBy: "user-colleague" })
    expect(journal).toEqual([])
  })

  it("stops a link whose time has already run out as well — a late press of «Отозвать» is not an error", async () => {
    seed("ran-out", { expiresAt: new Date("2026-10-10T07:59:00.000Z") })
    expect((await revoke("ran-out")).status).toBe(200)
    expect(links[0].revokedAt).toEqual(NOW)
  })
})

describe("how many, and how often", () => {
  it(`lets an employee have ${LOCATION_SHARE_LINK_ALIVE_LIMIT} working links: the next is refused, and one that stops working makes room`, async () => {
    for (let index = 0; index < LOCATION_SHARE_LINK_ALIVE_LIMIT; index += 1) seed(`working-${index}`)
    // What does not count: links that no longer work, a colleague's, another organization's.
    for (let index = 0; index < 10; index += 1) seed(`revoked-${index}`, { revokedAt: new Date("2026-10-10T07:00:00.000Z") })
    for (let index = 0; index < 10; index += 1) seed(`ran-out-${index}`, { expiresAt: NOW })
    for (let index = 0; index < LOCATION_SHARE_LINK_ALIVE_LIMIT - 1; index += 1) seed(`second-employee-${index}`, { agentId: "agent-2" })
    for (let index = 0; index < 10; index += 1) seed(`theirs-${index}`, { organizationId: OTHER_ORG, agentId: "agent-1" })
    const before = JSON.stringify(links)

    const refused = await make(forAnHour)
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({
      error: `An employee can have at most ${LOCATION_SHARE_LINK_ALIVE_LIMIT} working location links at once`,
      code: "MTM_LOCATION_SHARE_LINK_LIMIT_REACHED",
      limit: LOCATION_SHARE_LINK_ALIVE_LIMIT,
    })
    expectNothingChanged(before)

    // Counted per employee: the second one has a link to spare while the first has none…
    expect((await make({ agentId: "agent-2", duration: "1h" })).status).toBe(201)
    // …and that was his last.
    expect((await make({ agentId: "agent-2", duration: "1h" })).status).toBe(409)

    expect((await revoke("working-0")).status).toBe(200)
    expect((await make(forAnHour)).status).toBe(201)
    expect((await make(forAnHour)).status).toBe(409)
  })

  // Requests that arrive together each counted four working links before
  // any of them had made the fifth; 8–12 of 12 got in. What holds them to one
  // at a time is Postgres (mtm-contact-categories-postgres.test.ts fires them
  // at a real database); what is pinned here is that the route asks for it:
  // the employee's lock first, then the organization's switch once more,
  // then the count, then the row — all four on the transaction's own
  // connection, where the lock is held.
  it("counts and makes behind a lock on the employee, taken first and inside one transaction", async () => {
    const order = (statement: unknown) => vi.mocked(statement as never as ReturnType<typeof vi.fn>).mock.invocationCallOrder
    expect((await make(forAnHour)).status).toBe(201)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const [lock] = order(prisma.$executeRaw)
    const [switchAgain] = order(prisma.$queryRaw)
    const [count] = order(prisma.mtmLocationShareLink.count)
    const [create] = order(prisma.mtmLocationShareLink.create)
    const [transaction] = order(prisma.$transaction)
    expect([transaction, lock, switchAgain, count, create].every((turn) => Number.isInteger(turn))).toBe(true)
    expect([transaction, lock, switchAgain, count, create]).toEqual([...[transaction, lock, switchAgain, count, create]].sort((left, right) => left - right))
    // `$executeRaw`: the lock function returns void, which `$queryRaw` cannot read (P2010 — every request would die here).
    // The one statement that does go through `$queryRaw` is the switch's row, and it returns a row.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(rawReads().map(([sql]) => worded(sql))).toEqual([SWITCH_ROW_HELD])

    const lockOf = (call: number) => {
      const [sql, key] = vi.mocked(prisma.$executeRaw).mock.calls[call] as unknown as [readonly string[], string]
      expect(sql.join("?")).toBe("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))")
      return key
    }
    // One lock per employee per organization: his colleague's links wait for nobody of his.
    expect(lockOf(0)).toBe(`mtm-location-share-link:${ORG}:agent-1`)
    expect((await make({ agentId: "agent-2", duration: "1h" })).status).toBe(201)
    expect(lockOf(1)).toBe(`mtm-location-share-link:${ORG}:agent-2`)
  })

  // The lock is held, and the switch's row with it, on the transaction's
  // connection and on no other. A statement asked of `prisma` instead of the
  // transaction's client runs elsewhere: the count would not wait its turn,
  // and the row of the switch would be let go the moment it was read.
  it("asks all four through the transaction's own client, and none of them past it", async () => {
    const through: string[] = []
    const recording = <T extends object>(target: T, prefix: string): T => new Proxy(target, {
      get(owner, name, receiver) {
        const value: unknown = Reflect.get(owner, name, receiver)
        if (typeof name !== "string") return value
        if (typeof value === "function") {
          return (...args: unknown[]) => {
            through.push(`${prefix}${name}`)
            return (value as (...given: unknown[]) => unknown)(...args)
          }
        }
        return value !== null && typeof value === "object" ? recording(value, `${prefix}${name}.`) : value
      },
    })
    vi.mocked(prisma.$transaction).mockImplementationOnce((async (work: (tx: unknown) => Promise<unknown>) => work(recording(prisma as object, ""))) as never)
    expect((await make(forAnHour)).status).toBe(201)
    expect(through).toEqual(["$executeRaw", "$queryRaw", "mtmLocationShareLink.count", "mtmLocationShareLink.create"])
    for (const statement of [prisma.$executeRaw, prisma.$queryRaw, prisma.mtmLocationShareLink.count, prisma.mtmLocationShareLink.create]) {
      expect(statement).toHaveBeenCalledTimes(1)
    }
  })

  it("at the limit nothing is made inside that transaction either, and nothing is journalled", async () => {
    for (let index = 0; index < LOCATION_SHARE_LINK_ALIVE_LIMIT; index += 1) seed(`working-${index}`)
    const before = JSON.stringify(links)
    expect((await make(forAnHour)).status).toBe(409)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expectNothingChanged(before)
  })

  it("the fifth link is made and the sixth is not", async () => {
    for (let turn = 1; turn <= LOCATION_SHARE_LINK_ALIVE_LIMIT; turn += 1) expect((await make(forAnHour)).status, `link ${turn}`).toBe(201)
    expect((await make(forAnHour)).status).toBe(409)
    expect(links).toHaveLength(LOCATION_SHARE_LINK_ALIVE_LIMIT)
    // Time passes, the hour is up: the links stopped working by themselves, and there is room again.
    vi.setSystemTime(new Date(NOW.getTime() + HOUR))
    expect((await make(forAnHour)).status).toBe(201)
  })

  it("the list is asked for when a card is opened, not on the map's timer: sixty a minute", async () => {
    let last: Response | null = null
    for (let turn = 0; turn < 61; turn += 1) last = await list()
    expect(last?.status).toBe(429)
    expect(last?.headers.get("retry-after")).toBe("60")
    expect(await last?.json()).toMatchObject({ code: "MTM_LOCATION_SHARE_LINK_RATE_LIMITED", retryAfterSeconds: 60 })
    // Making is counted apart from looking.
    expect((await make(forAnHour)).status).toBe(201)
  })

  it("links are made at a person's pace: the thirty-first change in a minute waits, whichever kind it is", async () => {
    for (let turn = 0; turn < 15; turn += 1) {
      expect((await make(forAnHour)).status, `make ${turn}`).toBe(201)
      expect((await revoke(`link-${turn + 1}`)).status, `revoke ${turn}`).toBe(200)
    }
    const before = JSON.stringify(links)
    journal = []
    vi.mocked(prisma.mtmLocationShareLink.create).mockClear()
    vi.mocked(prisma.mtmLocationShareLink.updateMany).mockClear()
    for (const response of [await make(forAnHour), await revoke("link-15")]) {
      expect(response.status).toBe(429)
      expect(response.headers.get("retry-after")).toBe("60")
    }
    expectNothingChanged(before)
    // Looking is counted apart from changing, and a colleague has his own allowance.
    expect((await list()).status).toBe(200)
    vi.mocked(requireAuth).mockResolvedValue(signedIn({ userId: "user-colleague" }) as never)
    expect((await make(forAnHour)).status).toBe(201)
  })

  it("a database that fails is answered with a code and no detail of the failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const failure = new Error('relation "mtm_location_share_links" does not exist')
    vi.mocked(prisma.mtmLocationShareLink.findMany).mockRejectedValueOnce(failure as never)
    const read = await list()
    expect(read.status).toBe(500)
    expect(await read.json()).toEqual({ error: "Failed to load location links", code: "MTM_LOCATION_SHARE_LINK_FAILED" })

    vi.mocked(prisma.mtmLocationShareLink.create).mockRejectedValueOnce(failure as never)
    const made = await make(forAnHour)
    expect(made.status).toBe(500)
    expect(await made.json()).toEqual({ error: "Failed to make the location link", code: "MTM_LOCATION_SHARE_LINK_FAILED" })
    // No link was handed over for a row that was not kept.
    expect(links).toEqual([])
    expect(journal).toEqual([])
  })
})

describe("the journal", () => {
  it("says who let an outsider see whom, and who took it back — the row is about the employee, so his managers find it", async () => {
    const made = (await (await make({ agentId: "agent-2", duration: "4h" })).json()).data.link
    vi.setSystemTime(new Date("2026-10-10T08:30:00.000Z"))
    await revoke(made.id)
    expect(journal).toEqual([
      expect.objectContaining({
        organizationId: ORG, agentId: "agent-2", actorUserId: USER,
        action: "LOCATION_SHARE_LINK_CREATE", entity: "location_share_link", entityId: made.id, metadataKind: "location_share_link",
        newData: { duration: "4h", expiresAt: "2026-10-10T12:00:00.000Z" },
      }),
      expect.objectContaining({
        organizationId: ORG, agentId: "agent-2", actorUserId: USER,
        action: "LOCATION_SHARE_LINK_REVOKE", entity: "location_share_link", entityId: made.id, metadataKind: "location_share_link",
        newData: { expiresAt: "2026-10-10T12:00:00.000Z", revokedAt: "2026-10-10T08:30:00.000Z" },
      }),
    ])
  })

  it("reads both in words, in every language, with an icon of their own — never a bare «Действие»", async () => {
    const made = (await (await make(forAnHour)).json()).data.link
    await revoke(made.id)
    expect(journal.map((entry) => entry.action)).toEqual(["LOCATION_SHARE_LINK_CREATE", "LOCATION_SHARE_LINK_REVOKE"])
    const fallbackIcon = actionMeta("AN_ACTION_NOBODY_REGISTERED").icon
    const labels = new Set<string>()
    for (const entry of journal) {
      const key = actionLabelKey(String(entry.action))
      expect(key).toBe(`action.${entry.action}`)
      expect(actionMeta(String(entry.action)).icon).not.toBe(fallbackIcon)
      for (const locale of ["ru", "en", "az"]) {
        const label = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmActivity.action[String(entry.action)]
        expect(label, `${locale}: ${key}`).toEqual(expect.any(String))
        labels.add(`${locale}:${label}`)
      }
    }
    // Six different sentences: making and revoking do not read alike in any language.
    expect(labels.size).toBe(6)
  })

  it("is not a feed of views: neither action is one the journal hides as a viewer's event", async () => {
    // The activity feed leaves out every action ending in _READ or _VIEW (activity/_constants.ts).
    for (const action of ["LOCATION_SHARE_LINK_CREATE", "LOCATION_SHARE_LINK_REVOKE"]) expect(action).not.toMatch(/_(READ|VIEW)$/)
  })

  it("a journal that cannot be written does not undo or fail the change", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(prisma.mtmAuditLog.create).mockRejectedValue(new Error("journal is down") as never)
    const made = await make(forAnHour)
    expect(made.status).toBe(201)
    expect((await made.json()).data.url).toMatch(/\/share\/location\/[a-f0-9]{64}\?lang=ru$/)
    expect(links).toHaveLength(1)
    expect((await revoke("link-1")).status).toBe(200)
    expect(links[0].revokedAt).not.toBeNull()
  })
})
