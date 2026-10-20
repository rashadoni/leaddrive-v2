/**
 * Presentations: who sees each one, and deleting one (owner, 2026-10-21:
 * «нет удаления презентации и ещё нет выбора презентации… я хочу выбрать
 * несколько презентаций и указать, для какого агента будут видны») — read off
 * the tables after the real handlers ran on a real Postgres.
 *
 * What is asked is what the tables hold and what a phone is then given:
 *   - the migration copies today's visibility exactly (a tick on a group or a
 *     group above it, along active groups only), so nobody gains or loses a
 *     presentation on the day it runs;
 *   - «Save» gives the ticked agents every chosen presentation and takes them
 *     from the unticked, and a refused request writes nothing;
 *   - a deleted presentation leaves the catalog and every phone, while its
 *     showings — and the visit that names it — stay;
 *   - a name freed by a deletion can be used again, a live one cannot.
 * A mocked Prisma answers these queries with whatever the test hands it, so it
 * cannot show any of that.
 *
 * The stand-ins: who is calling (the mobile token, the web session) and the
 * tenant's plan, nothing else.
 *
 * Set MTM_PRODUCT_VIEWERS_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   MTM_PRODUCT_VIEWERS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («MTM presentation viewers database gate»), where
 * `MTM_PRODUCT_VIEWERS_DB_GATE=required` turns a missing URL into a failure so
 * the gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_PRODUCT_VIEWERS_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_PRODUCT_VIEWERS_DB_GATE === "required") {
  throw new Error("MTM_PRODUCT_VIEWERS_TEST_DATABASE_URL is required by the MTM presentation viewers database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_PRODUCT_VIEWERS_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_product_viewers_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database exists (dynamic imports below).
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

/** Whose phone is calling; null means the request comes from a browser. */
const caller = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
/** Who sits at the browser. */
const browser = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  const mock = makeMobileAuthMock()
  mock.resolveMobileAuth.mockImplementation(async () => caller.current)
  // Synchronous, like the real one: it only reads the token and picks the branch.
  mock.getMobileAuth.mockImplementation(() => caller.current)
  return mock
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(async () => browser.current?.orgId ?? null),
  getSession: vi.fn(async () => browser.current),
  requireAuth: vi.fn(async () => browser.current ?? new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })),
  isAuthError: (value: unknown) => value instanceof Response,
}))
// The tenant's plan is not what is under test.
vi.mock("@/lib/tenant-capability-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tenant-capability-access")>(),
  requireTenantCapabilityAccessResponse: async () => null,
}))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const MIGRATION = path.join(ROOT, "prisma/migrations/20261025090000_mtm_product_viewers/migration.sql")
const BASE = "http://localhost:3000/api/v1/mtm"

// The organization the migration is run on.
const LEGACY = "org-viewers-legacy"
// The organization the screen works in, and another company.
const ORG = "org-viewers"
const OTHER_ORG = "org-viewers-elsewhere"

// Who works there: a manager who manages «Gastro» (not «Kardio»), three field
// agents, one who left, a supervisor card, and an agent of another company.
const MANAGER = "agent-viewers-manager"
const KAMRAN = "agent-viewers-kamran"
const LEYLA = "agent-viewers-leyla"
const NIGAR = "agent-viewers-nigar"
const LEFT = "agent-viewers-left"
const SUPERVISOR = "agent-viewers-supervisor"
const ABROAD = "agent-viewers-abroad"
const CUSTOMER = "customer-viewers"

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/**
 * The schema as `db push` can build it on any Postgres. Two knowledge-base
 * tables carry a pgvector column; the pull-request database has that extension
 * and a plain `postgres:16` does not. Nothing here reads those columns.
 */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "mtm-product-viewers-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const migrationSql = readFileSync(MIGRATION, "utf8")

/** `db push` cannot express a partial index: a name is unique among live presentations only. */
function liveNameIndex(): string {
  const statement = migrationSql.match(/CREATE UNIQUE INDEX "mtm_products_live_name_key"[^;]*;/)?.[0]
  if (!statement || !statement.includes(`WHERE "deletedAt" IS NULL`)) throw new Error("live-name index not found in its migration")
  return statement
}

/** The migration's own backfill, as it will run on production. */
function backfill(): string {
  const statement = migrationSql.match(/INSERT INTO "mtm_product_viewers"[\s\S]*?ON CONFLICT DO NOTHING;/)?.[0]
  if (!statement) throw new Error("viewer backfill not found in its migration")
  return statement
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("presentation viewers and deletion on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let catalog!: typeof import("@/app/api/v1/mtm/products/route")
  let viewers!: typeof import("@/app/api/v1/mtm/products/viewers/route").PUT
  let remove!: typeof import("@/app/api/v1/mtm/products/[id]/route").DELETE
  let webFile!: typeof import("@/app/api/v1/mtm/products/[id]/presentation/route").GET
  let phoneCatalog!: typeof import("@/app/api/v1/mtm/mobile/products/route").GET
  let openSession!: typeof import("@/app/api/v1/mtm/mobile/presentation-sessions/route").POST
  let phoneFile!: typeof import("@/app/api/v1/mtm/mobile/documents/[documentId]/download/route").GET
  let review!: typeof import("@/app/api/v1/mtm/visits/[id]/review/route").GET
  let sequence = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, liveNameIndex())
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    catalog = await import("@/app/api/v1/mtm/products/route")
    viewers = (await import("@/app/api/v1/mtm/products/viewers/route")).PUT
    remove = (await import("@/app/api/v1/mtm/products/[id]/route")).DELETE
    webFile = (await import("@/app/api/v1/mtm/products/[id]/presentation/route")).GET
    phoneCatalog = (await import("@/app/api/v1/mtm/mobile/products/route")).GET
    openSession = (await import("@/app/api/v1/mtm/mobile/presentation-sessions/route")).POST
    phoneFile = (await import("@/app/api/v1/mtm/mobile/documents/[documentId]/download/route")).GET
    review = (await import("@/app/api/v1/mtm/visits/[id]/review/route")).GET

    await bypass(async () => {
      for (const id of [LEGACY, ORG, OTHER_ORG]) {
        await prisma.organization.create({ data: { id, name: id, slug: id, modules: { mtm: true, "route-field": true } } })
      }
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  function phoneOf(agentId: string, role = "AGENT", orgId = ORG) {
    browser.current = null
    caller.current = {
      orgId,
      agentId,
      userId: "",
      role,
      email: `${agentId}@example.test`,
      name: agentId,
      tenantCapabilities: { routeField: true, workforceHrm: true },
    }
  }

  function browserOf(userId: string, role = "member") {
    caller.current = null
    browser.current = { orgId: ORG, userId, role, email: `${userId}@example.test`, name: userId, principalType: "session" }
  }

  async function call(handler: (req: NextRequest, ctx?: never) => Promise<Response>, url: string, method = "GET", body?: unknown, ctx?: unknown) {
    const response = await (handler as (req: NextRequest, ctx?: unknown) => Promise<Response>)(new NextRequest(url, {
      method,
      headers: caller.current
        ? { Authorization: "Bearer mobile", "content-type": "application/json" }
        : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), ctx)
    const text = await response.text()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the handler's JSON, read field by field below
    let json: Record<string, any> = {}
    try { json = JSON.parse(text) } catch { /* a file, not JSON */ }
    return { status: response.status, body: json }
  }

  const params = (id: string) => ({ params: Promise.resolve({ id }) })

  async function document(orgId: string, id: string) {
    const { createMobileDocumentStorageKey } = await import("@/lib/mtm/mobile-document")
    return bypass(() => prisma.mtmDocument.create({
      data: { id, organizationId: orgId, fileName: `${id}.pdf`, mimeType: "application/pdf", sizeBytes: 4, storageKey: createMobileDocumentStorageKey() },
    }))
  }

  async function presentation(orgId: string, id: string, groupId: string, over: Record<string, unknown> = {}) {
    await document(orgId, `doc-${id}`)
    return bypass(() => prisma.mtmProduct.create({
      data: { id, organizationId: orgId, groupId, name: id, documentId: `doc-${id}`, ...over },
    }))
  }

  async function viewerRows(orgId = ORG): Promise<string[]> {
    const rows: Array<{ productId: string; agentId: string }> = await bypass(() => prisma.mtmProductViewer.findMany({
      where: { organizationId: orgId },
      select: { productId: true, agentId: true },
    }))
    return rows.map((row) => `${row.productId}:${row.agentId}`).sort()
  }

  async function phoneSees(agentId: string, role = "AGENT"): Promise<string[]> {
    phoneOf(agentId, role)
    const result = await call(phoneCatalog, `${BASE}/mobile/products`)
    expect(result.status).toBe(200)
    return result.body.data.products.map((product: { id: string }) => product.id).sort()
  }

  async function open(agentId: string, productId: string, visitId: string) {
    phoneOf(agentId)
    return call(openSession, `${BASE}/mobile/presentation-sessions`, "POST", {
      clientSessionId: `session-viewers-${++sequence}`,
      visitId,
      productId,
      openedAt: new Date().toISOString(),
      pageCount: 3,
    })
  }

  it("copies today's visibility into each presentation's own list, and only that", async () => {
    await bypass(async () => {
      await prisma.mtmAgent.createMany({
        data: [
          { id: "legacy-portfolio-agent", organizationId: LEGACY, name: "Portfolio agent" },
          { id: "legacy-line-agent", organizationId: LEGACY, name: "Line agent" },
          { id: "legacy-paused-agent", organizationId: LEGACY, name: "Agent of a paused line" },
          { id: "legacy-manager", organizationId: LEGACY, name: "Manager", role: "MANAGER" },
        ],
      })
      // Cardio ▸ Hypertension; Paused (switched off) ▸ Under paused.
      await prisma.mtmProductGroup.create({ data: { id: "legacy-cardio", organizationId: LEGACY, name: "Cardio" } })
      await prisma.mtmProductGroup.create({ data: { id: "legacy-hyper", organizationId: LEGACY, parentId: "legacy-cardio", name: "Hypertension" } })
      await prisma.mtmProductGroup.create({ data: { id: "legacy-paused", organizationId: LEGACY, name: "Paused", isActive: false } })
      await prisma.mtmProductGroup.create({ data: { id: "legacy-under-paused", organizationId: LEGACY, parentId: "legacy-paused", name: "Under paused" } })
      await prisma.mtmProductGroupMember.createMany({
        data: [
          { organizationId: LEGACY, groupId: "legacy-cardio", agentId: "legacy-portfolio-agent", role: "AGENT" },
          { organizationId: LEGACY, groupId: "legacy-hyper", agentId: "legacy-line-agent", role: "AGENT" },
          // Ticked on the line too: one row, not two.
          { organizationId: LEGACY, groupId: "legacy-hyper", agentId: "legacy-portfolio-agent", role: "AGENT" },
          { organizationId: LEGACY, groupId: "legacy-paused", agentId: "legacy-paused-agent", role: "AGENT" },
          // A group's manager keeps getting it through the management rule, not through a copied row.
          { organizationId: LEGACY, groupId: "legacy-cardio", agentId: "legacy-manager", role: "MANAGER" },
        ],
      })
    })
    await presentation(LEGACY, "legacy-cardio-deck", "legacy-cardio")
    await presentation(LEGACY, "legacy-hyper-deck", "legacy-hyper")
    await presentation(LEGACY, "legacy-switched-off", "legacy-hyper", { isActive: false })
    await presentation(LEGACY, "legacy-under-paused-deck", "legacy-under-paused")

    // As the migration runs: tables under FORCE RLS, no tenant set — hence its bypass.
    for (let run = 0; run < 2; run += 1) {
      await bypass(() => prisma.$executeRawUnsafe(backfill()))
    }

    expect(await viewerRows(LEGACY)).toEqual([
      "legacy-cardio-deck:legacy-portfolio-agent",
      "legacy-hyper-deck:legacy-line-agent",
      "legacy-hyper-deck:legacy-portfolio-agent",
    ])
  })

  describe("in the organization the screen works in", () => {
    let visitKamran = ""
    let visitLeyla = ""

    beforeAll(async () => {
      await bypass(async () => {
        await prisma.user.createMany({
          data: [
            { id: "user-viewers-manager", organizationId: ORG, email: "manager@example.test", name: "Manager", passwordHash: "-", role: "member" },
            { id: "user-viewers-kamran", organizationId: ORG, email: "kamran@example.test", name: "Kamran", passwordHash: "-", role: "member" },
            { id: "user-viewers-admin", organizationId: ORG, email: "admin@example.test", name: "Admin", passwordHash: "-", role: "admin" },
          ],
        })
        await prisma.mtmAgent.createMany({
          data: [
            { id: MANAGER, organizationId: ORG, name: "Team Manager", role: "MANAGER", userId: "user-viewers-manager" },
            { id: KAMRAN, organizationId: ORG, name: "Kamran", userId: "user-viewers-kamran" },
            { id: LEYLA, organizationId: ORG, name: "Leyla" },
            { id: NIGAR, organizationId: ORG, name: "Nigar" },
            { id: LEFT, organizationId: ORG, name: "Left the company", status: "INACTIVE" },
            { id: SUPERVISOR, organizationId: ORG, name: "Supervisor", role: "SUPERVISOR" },
            { id: ABROAD, organizationId: OTHER_ORG, name: "Another company" },
          ],
        })
        await prisma.mtmProductGroup.create({ data: { id: "gastro", organizationId: ORG, name: "Gastro" } })
        await prisma.mtmProductGroup.create({ data: { id: "kardio", organizationId: ORG, name: "Kardio" } })
        await prisma.mtmProductGroup.create({ data: { id: "abroad", organizationId: OTHER_ORG, name: "Abroad" } })
        await prisma.mtmProductGroupMember.createMany({
          data: [
            { organizationId: ORG, groupId: "gastro", agentId: MANAGER, role: "MANAGER" },
            // A tick on the group, the old way: it no longer hands Nigar anything.
            { organizationId: ORG, groupId: "gastro", agentId: NIGAR, role: "AGENT" },
          ],
        })
        await prisma.mtmCustomer.create({ data: { id: CUSTOMER, organizationId: ORG, name: "Central Clinic", latitude: 40.4093, longitude: 49.8671, geofenceRadius: 300 } })
      })
      for (const id of ["omega", "vita", "zinc"]) await presentation(ORG, id, "gastro")
      await presentation(ORG, "kardil", "kardio")
      await presentation(OTHER_ORG, "abroad-deck", "abroad")
      await bypass(async () => {
        const now = new Date()
        const checkInAt = new Date(now.getTime() - 10 * 60_000)
        visitKamran = (await prisma.mtmVisit.create({ data: { organizationId: ORG, agentId: KAMRAN, customerId: CUSTOMER, status: "CHECKED_IN", checkInAt } })).id
        visitLeyla = (await prisma.mtmVisit.create({ data: { organizationId: ORG, agentId: LEYLA, customerId: CUSTOMER, status: "CHECKED_IN", checkInAt } })).id
      })
    })

    it("gives the ticked agents every chosen presentation, takes them from the unticked, and the phones follow", async () => {
      browserOf("user-viewers-manager")
      const first = await call(viewers, `${BASE}/products/viewers`, "PUT", { productIds: ["omega", "vita"], add: [KAMRAN, LEYLA], remove: [] })
      expect(first.status).toBe(200)
      expect(first.body.data.products).toEqual([
        { id: "omega", viewerAgentIds: [KAMRAN, LEYLA] },
        { id: "vita", viewerAgentIds: [KAMRAN, LEYLA] },
      ])

      // Leyla off Vita only; Kamran, untouched, keeps both.
      const second = await call(viewers, `${BASE}/products/viewers`, "PUT", { productIds: ["vita"], add: [], remove: [LEYLA] })
      expect(second.status).toBe(200)
      expect(await viewerRows()).toEqual([`omega:${KAMRAN}`, `omega:${LEYLA}`, `vita:${KAMRAN}`])

      expect(await phoneSees(KAMRAN)).toEqual(["omega", "vita"])
      expect(await phoneSees(LEYLA)).toEqual(["omega"])
      // Ticked on «Gastro» the old way, listed on nothing: nothing.
      expect(await phoneSees(NIGAR)).toEqual([])

      // The office screen says the same.
      browserOf("user-viewers-manager")
      const screen = await call(catalog.GET, `${BASE}/products`)
      expect(screen.status).toBe(200)
      const seen = Object.fromEntries(screen.body.data.products.map((product: { id: string; viewerAgentIds: string[] }) => [product.id, [...product.viewerAgentIds].sort()]))
      expect(seen).toMatchObject({ omega: [KAMRAN, LEYLA].sort(), vita: [KAMRAN], zinc: [] })

      // The journal says who changed what.
      const journal: Array<{ action: string; newData: { productNames: string[]; added: string[]; removed: string[] } }> = await bypass(() => prisma.mtmAuditLog.findMany({
        where: { organizationId: ORG, action: "FIELD_PRODUCT_VIEWERS_UPDATE" },
        orderBy: { createdAt: "asc" },
        select: { action: true, newData: true },
      }))
      expect(journal.map((row) => row.newData)).toEqual([
        { productIds: ["omega", "vita"], productNames: ["omega", "vita"], added: [KAMRAN, LEYLA], removed: [] },
        { productIds: ["vita"], productNames: ["vita"], added: [], removed: [LEYLA] },
      ])
    })

    it("opens on a visit only a presentation the agent is listed on", async () => {
      const listed = await open(KAMRAN, "vita", visitKamran)
      expect(listed.status).toBe(201)
      const notListed = await open(LEYLA, "vita", visitLeyla)
      expect([notListed.status, notListed.body.code]).toEqual([403, "MTM_PRODUCT_NOT_ASSIGNED"])
      // The file goes the same way: Kamran gets it, Leyla does not.
      phoneOf(KAMRAN)
      const kamranFile = await call(phoneFile, `${BASE}/mobile/documents/doc-vita/download`, "GET", undefined, { params: Promise.resolve({ documentId: "doc-vita" }) })
      // Past the access check: 410 only because the scratch database has no bytes on disk.
      expect(kamranFile.status).toBe(410)
      phoneOf(LEYLA)
      const leylaFile = await call(phoneFile, `${BASE}/mobile/documents/doc-vita/download`, "GET", undefined, { params: Promise.resolve({ documentId: "doc-vita" }) })
      expect(leylaFile.status).toBe(404)
    })

    it("writes nothing for a request it refuses", async () => {
      const before = await viewerRows()
      browserOf("user-viewers-manager")
      const refused = [
        // Somebody who left, a supervisor, a card of another company, a card that does not exist.
        await call(viewers, `${BASE}/products/viewers`, "PUT", { productIds: ["zinc"], add: [LEFT], remove: [] }),
        await call(viewers, `${BASE}/products/viewers`, "PUT", { productIds: ["zinc"], add: [SUPERVISOR], remove: [] }),
        await call(viewers, `${BASE}/products/viewers`, "PUT", { productIds: ["zinc"], add: [ABROAD], remove: [] }),
        await call(viewers, `${BASE}/products/viewers`, "PUT", { productIds: ["zinc"], add: [KAMRAN, "no-such-card"], remove: [] }),
        // «Kardio» is not his group: to him it does not exist, like another company's presentation.
        await call(viewers, `${BASE}/products/viewers`, "PUT", { productIds: ["zinc", "kardil"], add: [KAMRAN], remove: [] }),
        await call(viewers, `${BASE}/products/viewers`, "PUT", { productIds: ["abroad-deck"], add: [KAMRAN], remove: [] }),
        // One agent both given and taken.
        await call(viewers, `${BASE}/products/viewers`, "PUT", { productIds: ["zinc"], add: [KAMRAN], remove: [KAMRAN] }),
      ]
      expect(refused.map((result) => [result.status, result.body.code ?? null])).toEqual([
        [422, "MTM_PRODUCT_VIEWER_INVALID"],
        [422, "MTM_PRODUCT_VIEWER_INVALID"],
        [422, "MTM_PRODUCT_VIEWER_INVALID"],
        [422, "MTM_PRODUCT_VIEWER_INVALID"],
        [404, "MTM_PRODUCT_NOT_FOUND"],
        [404, "MTM_PRODUCT_NOT_FOUND"],
        [400, null],
      ])

      // A field agent at a browser, even one ticked on the group, sees it and changes nothing.
      await bypass(() => prisma.mtmProductGroupMember.create({ data: { organizationId: ORG, groupId: "kardio", agentId: KAMRAN, role: "AGENT" } }))
      browserOf("user-viewers-kamran")
      const byAgent = await call(viewers, `${BASE}/products/viewers`, "PUT", { productIds: ["kardil"], add: [KAMRAN], remove: [] })
      expect([byAgent.status, byAgent.body.code]).toEqual([403, "MTM_PRODUCT_FORBIDDEN"])
      const deleteByAgent = await call(remove, `${BASE}/products/kardil`, "DELETE", undefined, params("kardil"))
      expect([deleteByAgent.status, deleteByAgent.body.code]).toEqual([403, "MTM_PRODUCT_FORBIDDEN"])
      const notHis = await call(remove, `${BASE}/products/zinc`, "DELETE", undefined, params("zinc"))
      expect(notHis.status).toBe(404)

      expect(await viewerRows()).toEqual(before)
      expect(await bypass(() => prisma.mtmProduct.count({ where: { organizationId: ORG, deletedAt: { not: null } } }))).toBe(0)
    })

    it("deletes a presentation from the catalog and every phone, and keeps its showings and the visit naming it", async () => {
      browserOf("user-viewers-manager")
      const outside = await call(remove, `${BASE}/products/kardil`, "DELETE", undefined, params("kardil"))
      expect(outside.status).toBe(404)
      const abroad = await call(remove, `${BASE}/products/abroad-deck`, "DELETE", undefined, params("abroad-deck"))
      expect(abroad.status).toBe(404)

      const deleted = await call(remove, `${BASE}/products/vita`, "DELETE", undefined, params("vita"))
      expect(deleted.status).toBe(200)
      expect(deleted.body.data).toEqual({ id: "vita", name: "vita", showings: 1 })
      const again = await call(remove, `${BASE}/products/vita`, "DELETE", undefined, params("vita"))
      expect([again.status, again.body.idempotent]).toEqual([200, true])

      // The row stays, marked; the showing stays, pointing at it.
      const row = await bypass(() => prisma.mtmProduct.findUnique({ where: { id: "vita" }, select: { deletedAt: true, deletedByUserId: true, isActive: true } }))
      expect(row?.deletedAt).toBeInstanceOf(Date)
      expect(row).toMatchObject({ deletedByUserId: "user-viewers-manager", isActive: false })
      expect(await bypass(() => prisma.mtmPresentationSession.count({ where: { productId: "vita" } }))).toBe(1)
      const journal = await bypass(() => prisma.mtmAuditLog.findMany({
        where: { organizationId: ORG, action: "FIELD_PRODUCT_DELETE" },
        select: { entityId: true, newData: true },
      }))
      expect(journal).toEqual([{ entityId: "vita", newData: { name: "vita", showings: 1 } }])

      // Gone from the office list, with its showing still counted for the group.
      const screen = await call(catalog.GET, `${BASE}/products`)
      expect(screen.body.data.products.map((product: { id: string }) => product.id).sort()).toEqual(["omega", "zinc"])
      expect(screen.body.data.deletedShowings).toEqual({ gastro: 1 })
      const file = await call(webFile, `${BASE}/products/vita/presentation`, "GET", undefined, params("vita"))
      expect(file.status).toBe(404)

      // Gone from Kamran's phone: not listed, not opened, not downloaded.
      expect(await phoneSees(KAMRAN)).toEqual(["omega"])
      const reopened = await open(KAMRAN, "vita", visitKamran)
      expect([reopened.status, reopened.body.code]).toEqual([404, "MTM_PRODUCT_NOT_FOUND"])
      phoneOf(KAMRAN)
      const download = await call(phoneFile, `${BASE}/mobile/documents/doc-vita/download`, "GET", undefined, { params: Promise.resolve({ documentId: "doc-vita" }) })
      expect(download.status).toBe(404)

      // The visit still says what was shown on it.
      browserOf("user-viewers-admin", "admin")
      const visit = await call(review, `${BASE}/visits/${visitKamran}/review`, "GET", undefined, params(visitKamran))
      expect(visit.status).toBe(200)
      expect(JSON.stringify(visit.body.data)).toContain(`"name":"vita"`)
    })

    it("lets a deleted presentation's name be used again, and not a live one's", async () => {
      browserOf("user-viewers-manager")
      await document(ORG, "doc-vita-new")
      await document(ORG, "doc-omega-copy")
      const reused = await call(catalog.POST, `${BASE}/products`, "POST", { groupId: "gastro", name: "vita", documentId: "doc-vita-new" })
      expect(reused.status).toBe(201)
      const taken = await call(catalog.POST, `${BASE}/products`, "POST", { groupId: "gastro", name: "omega", documentId: "doc-omega-copy" })
      expect([taken.status, taken.body.code]).toEqual([409, "MTM_PRODUCT_NAME_TAKEN"])

      // The new «vita» starts with nobody: who sees it is chosen on it.
      expect(await bypass(() => prisma.mtmProductViewer.count({ where: { productId: reused.body.data.id } }))).toBe(0)
      expect(await phoneSees(KAMRAN)).toEqual(["omega"])
    })
  })
})
