/**
 * Saving client categories, and filling a category field on a contact, against
 * a real Postgres.
 *
 * Why this exists: on 2026-10-02 the category editor shipped with every unit
 * test green and could not save once on prod. The transaction opened with
 * `tx.$queryRaw\`SELECT pg_advisory_xact_lock(...)\``; that function returns
 * `void`, Prisma cannot deserialize it, and the request died with P2010 before
 * touching a table. The tests mock Prisma, and a mock answers any raw query.
 * The same call had been copied from routes that had themselves never run.
 *
 * Here the real handlers run over a scratch database built from the real
 * schema, with the dictionary table's CHECK and one-active-version index taken
 * from its migration. Only the session and the tenant's plan are stubbed.
 *
 * Set MTM_CONTACT_CATEGORIES_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 pgvector/pgvector:pg16
 *   MTM_CONTACT_CATEGORIES_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («MTM client categories database gate»), where
 * `MTM_CONTACT_CATEGORIES_DB_GATE=required` turns a missing URL into a failure
 * so the gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_CONTACT_CATEGORIES_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_CONTACT_CATEGORIES_DB_GATE === "required") {
  throw new Error("MTM_CONTACT_CATEGORIES_TEST_DATABASE_URL is required by the MTM client categories database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_CONTACT_CATEGORIES_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_contact_categories_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database exists (dynamic imports below).
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(async () => ({
    orgId: "org-categories",
    userId: "admin-user",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  })),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
// The tenant's plan is not what is under test.
vi.mock("@/lib/tenant-capability-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tenant-capability-access")>(),
  requireTenantCapabilityAccessResponse: async () => null,
}))

const ROOT = process.cwd()
const ORG = "org-categories"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/**
 * `db push` builds tables from schema.prisma, which cannot express a CHECK or
 * a partial index. Those two are what decide whether a saved version is
 * accepted, so they are lifted from the migration that created them.
 */
function dictionaryConstraints(): string[] {
  const sql = readFileSync(
    path.join(ROOT, "prisma/migrations/20260808160000_mtm_contact_dictionaries/migration.sql"),
    "utf8",
  )
  const oneActive = sql.match(/CREATE UNIQUE INDEX "mtm_contact_dict_one_active_kind_key"[\s\S]*?;/)
  const signature = sql.match(/ALTER TABLE "mtm_contact_dictionaries"\s+ADD CONSTRAINT "mtm_contact_dict_signature_check"[\s\S]*?\);/)
  if (!oneActive || !signature) throw new Error("dictionary constraints not found in their migration")
  return [oneActive[0], signature[0]]
}

function put(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("client categories on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    // The schema has embedding columns; their type comes from an extension.
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, "CREATE EXTENSION IF NOT EXISTS vector")
    prismaCli(
      ["db", "push", "--schema", path.join(ROOT, "prisma/schema.prisma"), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    for (const statement of dictionaryConstraints()) {
      prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, statement)
    }
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    await bypass(() => prisma.organization.create({ data: { id: ORG, name: "Zeytun Pharma", slug: "categories-test" } }))
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  it("saves a patient-count field for doctors, then a second edit on top of it", async () => {
    const { GET, PUT } = await import("@/app/api/v1/mtm/contact-categories/route")
    const { contactCategoriesForSave, defaultContactCategories } = await import("@/lib/mtm/contact-category-editor")

    const categories = defaultContactCategories()
    categories[0].fields = [{ key: "", order: 0, type: "NUMBER", required: false, labels: { ru: "", az: "Xəstə sayı", en: "" } }]
    const first = await PUT(put("/api/v1/mtm/contact-categories", {
      expectedDictionaryId: null,
      categories: contactCategoriesForSave(categories, "az"),
    }))
    const firstBody = await first.json()
    expect(firstBody).toMatchObject({ success: true, data: { version: 1, changed: true } })
    expect(first.status).toBe(200)

    categories[0].fields[0].key = "xeste_sayi"
    categories.push({ code: "", order: 0, labels: { ru: "", az: "Tibb bacısı", en: "" }, fields: [] })
    const second = await PUT(put("/api/v1/mtm/contact-categories", {
      expectedDictionaryId: firstBody.data.dictionaryId,
      categories: contactCategoriesForSave(categories, "az"),
    }))
    expect(await second.json()).toMatchObject({ success: true, data: { version: 2, changed: true } })

    const rows = await bypass(() => prisma.mtmContactDictionary.findMany({
      where: { organizationId: ORG, kind: "CLIENT_TYPE" },
      orderBy: { version: "asc" },
      select: { version: true, status: true, retiredAt: true },
    }))
    expect(rows.map((row: { version: number; status: string }) => [row.version, row.status])).toEqual([[1, "RETIRED"], [2, "ACTIVE"]])
    expect(rows[0].retiredAt).toBeInstanceOf(Date)

    const read = await (await GET(new NextRequest("http://localhost:3000/api/v1/mtm/contact-categories"))).json()
    expect(read.data.categories.map((category: { code: string }) => category.code))
      .toEqual(["DOCTOR", "PHARMACIST", "OTHER", "TIBB_BACISI"])
    expect(read.data.categories[0].fields[0]).toMatchObject({ key: "xeste_sayi", type: "NUMBER" })
    const audit = await bypass(() => prisma.mtmAuditLog.count({ where: { organizationId: ORG, action: "CONTACT_CATEGORIES_SAVED" } }))
    expect(audit).toBe(2)
  })

  it("stores the patient count on a doctor who existed before the field did", async () => {
    const { PUT } = await import("@/app/api/v1/mtm/contacts/[id]/dictionary-assignments/route")
    const { contactDictionaryAssignmentStateHash } = await import("@/lib/mtm/contact-dictionary-assignment")
    const contact = await bypass(() => prisma.mtmContact.create({
      data: { organizationId: ORG, firstName: "Leyla", lastName: "Əliyeva", displayName: "Əliyeva Leyla", type: "DOCTOR" },
      select: { id: true },
    }))
    const active = await bypass(() => prisma.mtmContactDictionary.findFirstOrThrow({
      where: { organizationId: ORG, kind: "CLIENT_TYPE", status: "ACTIVE" },
      select: { id: true },
    }))

    const response = await PUT(put(`/api/v1/mtm/contacts/${contact.id}/dictionary-assignments`, {
      expectedStateHash: contactDictionaryAssignmentStateHash([]),
      reason: "Xəstə sayı əlavə edildi",
      clientType: { dictionaryId: active.id, code: "DOCTOR", values: { xeste_sayi: 120 } },
      psychotype: null,
      productCategories: null,
      brandCategories: null,
    }), { params: Promise.resolve({ id: contact.id }) })
    expect(await response.json()).toMatchObject({ success: true, data: { created: 1 } })

    const stored = await bypass(() => prisma.mtmContact.findUniqueOrThrow({
      where: { id: contact.id },
      select: { type: true, categoryData: true, dictionaryAssignments: { select: { kind: true, entryCode: true, effectiveTo: true } } },
    }))
    expect(stored).toMatchObject({
      type: "DOCTOR",
      categoryData: { xeste_sayi: 120 },
      dictionaryAssignments: [{ kind: "CLIENT_TYPE", entryCode: "DOCTOR", effectiveTo: null }],
    })
  })
})
