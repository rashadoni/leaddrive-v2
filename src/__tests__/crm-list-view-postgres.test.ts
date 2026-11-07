/**
 * The contacts, companies and deals list screens against a real Postgres
 * (`view=list`, 2026-11-07).
 *
 * The screens used to load `?limit=500` (deals 200) and search in the browser,
 * so the 501st contact could not be found by search at all. Now the route
 * searches, filters, sorts and pages. What is proved here, on rows in a real
 * database rather than on the shape of a Prisma call:
 *  - a contact past the first 500 is found by name, e-mail, phone and company;
 *  - pages do not overlap and are capped at 200 per request;
 *  - the counters above each list describe the whole book, not the search;
 *  - another organization's rows never come back, from any of the three;
 *  - a column the role may not see (field permission, or masked customer
 *    phones) is not searchable either — a search would reveal it;
 *  - `%` and `_` in the search box are literal characters;
 *  - the deals board's stage totals ignore the search and respect ownership.
 *
 * Set CRM_LIST_VIEW_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55502:5432 postgres:16
 *   CRM_LIST_VIEW_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55502/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy («CRM list view database gate»), where CRM_LIST_VIEW_DB_GATE=required
 * turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.CRM_LIST_VIEW_TEST_DATABASE_URL
if (!adminUrl && process.env.CRM_LIST_VIEW_DB_GATE === "required") {
  throw new Error("CRM_LIST_VIEW_TEST_DATABASE_URL is required by the CRM list view database gate")
}

const scratch = vi.hoisted(() => {
  process.env.TENANT_PII_MASTER_KEY = "7".repeat(64)
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "crm-list-view-test-secret"
  const admin = process.env.CRM_LIST_VIEW_TEST_DATABASE_URL
  if (!admin) return null
  const name = `crm_list_view_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

const ROOT = process.cwd()
const ORG = "org-lists"
const OTHER_ORG = "org-lists-other"
const MASKED_ORG = "org-lists-masked"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "crm-list-view-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const get = (url: string) => new NextRequest(`http://localhost:3000${url}`, { method: "GET" })

function signIn(org: string, role: string) {
  session.current = { user: { id: `${role}-${org}`, organizationId: org, role, email: `${role}@${org}.test`, name: role } }
}

/** "Contact 0001" … — 505 of them sort before the one the search must reach. */
const FILLER_CONTACTS = 505
const pad = (n: number) => String(n).padStart(4, "0")

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("the contacts, companies and deals lists on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let contactsGet!: typeof import("@/app/api/v1/contacts/route").GET
  let companiesGet!: typeof import("@/app/api/v1/companies/route").GET
  let dealsGet!: typeof import("@/app/api/v1/deals/route").GET
  let pipelineId = ""
  let zeynalovId = ""

  const contacts = async (query: string) => {
    const res = await contactsGet(get(`/api/v1/contacts?${query}`))
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(200)
    return body.data
  }
  const companies = async (query: string) => {
    const res = await companiesGet(get(`/api/v1/companies?${query}`))
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(200)
    return body.data
  }
  const deals = async (query: string) => {
    const res = await dealsGet(get(`/api/v1/deals?${query}`))
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(200)
    return body.data
  }

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    contactsGet = (await import("@/app/api/v1/contacts/route")).GET
    companiesGet = (await import("@/app/api/v1/companies/route")).GET
    dealsGet = (await import("@/app/api/v1/deals/route")).GET

    await bypass(async () => {
      for (const [id, slug, settings] of [
        [ORG, "lists", {}],
        [OTHER_ORG, "lists-other", {}],
        [MASKED_ORG, "lists-masked", { hideCustomerPhoneForOperators: true }],
      ] as const) {
        await prisma.organization.create({ data: { id, name: slug, slug, modules: { crm: true, sales: true }, settings } })
        for (const role of ["admin", "sales"]) {
          await prisma.user.create({ data: { id: `${role}-${id}`, organizationId: id, email: `${role}@${id}.test`, name: role, passwordHash: "-", role } })
        }
      }

      // ── Companies: three statuses, contacts to sort by.
      const nur = await prisma.company.create({ data: { organizationId: ORG, name: "Nur Ticarət", status: "active", leadScore: 80 } })
      await prisma.company.create({ data: { organizationId: ORG, name: "Discount 50% Ltd", status: "prospect", leadScore: 45 } })
      await prisma.company.create({ data: { organizationId: ORG, name: "Discount 500 Ltd", status: "inactive", leadScore: 10 } })
      await prisma.company.create({ data: { organizationId: ORG, name: "A_B Holding", status: "active", leadScore: 0 } })
      await prisma.company.create({ data: { organizationId: ORG, name: "AxB Holding", status: "active", leadScore: 0 } })
      await prisma.company.create({ data: { organizationId: ORG, name: "Old Partner", category: "partner" } })
      await prisma.company.create({ data: { organizationId: OTHER_ORG, name: "Nur Ticarət (theirs)", status: "active" } })

      // ── Contacts: 505 filler names, then the one the search must reach.
      await prisma.contact.createMany({
        data: Array.from({ length: FILLER_CONTACTS }, (_, i) => ({
          organizationId: ORG,
          fullName: `Contact ${pad(i + 1)}`,
          isActive: i % 5 !== 0,
          engagementScore: i % 3 === 0 ? 60 : i % 3 === 1 ? 30 : 5,
          category: i % 2 === 0 ? "vip" : "regular",
        })),
      })
      const zeynalov = await prisma.contact.create({
        data: {
          organizationId: ORG,
          fullName: "Zeynalov Rauf",
          email: "rauf@nur-ticaret.az",
          phone: "+994 50 123 45 67",
          companyId: nur.id,
          category: "partner",
          portalAccessEnabled: true,
          portalPasswordHash: "$2b$10$not-a-real-hash",
        },
      })
      zeynalovId = zeynalov.id
      await prisma.contact.create({ data: { organizationId: OTHER_ORG, fullName: "Zeynalov Rauf", email: "rauf@other.az", phone: "+994 50 123 45 67" } })
      await prisma.contact.create({ data: { organizationId: MASKED_ORG, fullName: "Masked Customer", phone: "+994 55 765 43 21" } })

      // A sales user may not see contact phones in ORG.
      await prisma.fieldPermission.create({ data: { organizationId: ORG, roleId: "sales", entityType: "contact", fieldName: "phone", access: "hidden" } })

      // ── Deals: one pipeline, open and closed stages in two currencies.
      const pipeline = await prisma.pipeline.create({ data: { organizationId: ORG, name: "Sales", isDefault: true } })
      pipelineId = pipeline.id
      const deal = (name: string, stage: string, valueAmount: number, currency: string, assignedTo: string | null, extra: Record<string, unknown> = {}) =>
        prisma.deal.create({ data: { organizationId: ORG, pipelineId, name, stage, valueAmount, currency, assignedTo, probability: 50, ...extra } })
      await deal("Kassa sistemi", "LEAD", 1000, "AZN", "sales-org-lists", { companyId: nur.id })
      await deal("Server otağı", "PROPOSAL", 3000, "AZN", "admin-org-lists", { notes: "Kassa ilə birlikdə" })
      await deal("Hosting", "WON", 500, "USD", "admin-org-lists")
      await deal("Lisenziya", "WON", 2000, "AZN", "sales-org-lists")
      await deal("Ləğv", "LOST", 700, "AZN", null)
      await prisma.deal.create({ data: { organizationId: OTHER_ORG, name: "Kassa sistemi (theirs)", stage: "LEAD", valueAmount: 9999 } })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => signIn(ORG, "admin"))

  describe("contacts", () => {
    it("finds the contact past the first 500 by name, e-mail, phone and company — and only in its own organization", async () => {
      for (const term of ["zeynalov", "RAUF@NUR", "123 45", "nur ticar"]) {
        const data = await contacts(`view=list&search=${encodeURIComponent(term)}`)
        expect(data.contacts.map((c: { id: string }) => c.id), term).toEqual([zeynalovId])
        expect(data.total, term).toBe(1)
      }
    })

    it("pages without overlap, 200 at most per request, ordered by name, with an offset for «show more»", async () => {
      const first = await contacts("view=list&page=1&limit=1000")
      const second = await contacts("view=list&page=2&limit=200")
      const third = await contacts("view=list&offset=400&limit=200")

      expect(first.limit).toBe(200)
      expect(first.contacts).toHaveLength(200)
      expect(first.total).toBe(FILLER_CONTACTS + 1)
      const names = [...first.contacts, ...second.contacts, ...third.contacts].map((c: { fullName: string }) => c.fullName)
      expect(new Set(names).size).toBe(FILLER_CONTACTS + 1)
      expect(names[0]).toBe("Contact 0001")
      expect(names.at(-1)).toBe("Zeynalov Rauf")
      expect(names).toEqual([...names].sort())
    })

    it("sends the list's columns only, with whether a portal password is set but never the hash", async () => {
      const data = await contacts("view=list&search=zeynalov")
      const [row] = data.contacts
      expect(Object.keys(row).sort()).toEqual([
        "brand", "category", "company", "companyId", "email", "engagementScore", "fullName", "id",
        "isActive", "phone", "portalAccessEnabled", "portalPasswordSet", "position", "source",
      ])
      expect(row.portalPasswordSet).toBe(true)
      expect(row.company).toEqual({ id: expect.any(String), name: "Nur Ticarət" })
    })

    it("counts the whole book above the list, whatever the search and the category filter", async () => {
      const data = await contacts("view=list&search=zeynalov&category=partner")
      const fillerActive = Array.from({ length: FILLER_CONTACTS }, (_, i) => i % 5 !== 0).filter(Boolean).length
      const fillerHot = Array.from({ length: FILLER_CONTACTS }, (_, i) => i % 3 === 0).filter(Boolean).length
      const fillerWarm = Array.from({ length: FILLER_CONTACTS }, (_, i) => i % 3 === 1).filter(Boolean).length
      expect(data.total).toBe(1)
      expect(data.stats).toEqual({
        total: FILLER_CONTACTS + 1,
        active: fillerActive + 1,
        withEmail: 1,
        withPhone: 1,
        hot: fillerHot,
        warm: fillerWarm,
        cold: FILLER_CONTACTS + 1 - fillerHot - fillerWarm,
      })
    })

    it("filters by category on the server and sorts by company, contacts without one last", async () => {
      const vip = await contacts("view=list&category=vip&limit=1")
      expect(vip.total).toBe(Math.ceil(FILLER_CONTACTS / 2))
      const byCompany = await contacts("view=list&sort=company&limit=1")
      expect(byCompany.contacts[0].fullName).toBe("Zeynalov Rauf")
    })

    it("hands «select all found» every matching id, not only the page on screen", async () => {
      const data = await contacts("view=list&category=regular&idsOnly=1")
      expect(data.ids).toHaveLength(Math.floor(FILLER_CONTACTS / 2))
      expect(data.capped).toBe(false)
    })

    it("does not search a column the role may not see", async () => {
      signIn(ORG, "sales")
      expect((await contacts("view=list&search=123%2045")).total).toBe(0)
      const byName = await contacts("view=list&search=zeynalov")
      expect(byName.total).toBe(1)
      expect(byName.contacts[0]).not.toHaveProperty("phone")
      expect(byName.stats.withPhone).toBeNull()
    })

    it("does not search phones for an operator who sees them masked", async () => {
      signIn(MASKED_ORG, "sales")
      expect((await contacts("view=list&search=765%2043")).total).toBe(0)
      expect((await contacts("view=list&search=masked")).total).toBe(1)
      signIn(MASKED_ORG, "admin")
      expect((await contacts("view=list&search=765%2043")).total).toBe(1)
    })

    it("keeps the pickers' shape: full rows, a name-only search, up to 1000", async () => {
      const data = await contacts("limit=5000&search=nur")
      expect(data.limit).toBe(1000)
      // «nur» is in Zeynalov's company and e-mail, not in a name.
      expect(data.total).toBe(0)
      const full = await contacts("search=zeynalov")
      expect(full.contacts[0]).toHaveProperty("createdAt")
      expect(full).not.toHaveProperty("stats")
    })
  })

  describe("companies", () => {
    it("searches on the server, takes % and _ literally, and never returns another organization's company", async () => {
      const nur = await companies("category=client&view=list&search=nur")
      expect(nur.companies.map((c: { name: string }) => c.name)).toEqual(["Nur Ticarət"])

      const percent = await companies("category=client&view=list&search=50%25")
      expect(percent.companies.map((c: { name: string }) => c.name)).toEqual(["Discount 50% Ltd"])
      const underscore = await companies("category=client&view=list&search=a_b")
      expect(underscore.companies.map((c: { name: string }) => c.name)).toEqual(["A_B Holding"])
    })

    it("counts the status tabs over the whole category, whatever the search and the tab", async () => {
      const data = await companies("category=client&view=list&status=prospect&search=discount")
      expect(data.companies.map((c: { name: string }) => c.name)).toEqual(["Discount 50% Ltd"])
      expect(data.total).toBe(1)
      expect(data.statusCounts).toEqual({ active: 3, prospect: 1, inactive: 1 })
      expect(data.allCount).toBe(5)
    })

    it("sorts by the score the card's HOT/WARM/COLD badge is drawn from, and sends a card's columns only", async () => {
      const data = await companies("category=client&view=list&sort=hot_cold")
      expect(data.companies.map((c: { name: string }) => c.name).slice(0, 3)).toEqual(["Nur Ticarət", "Discount 50% Ltd", "Discount 500 Ltd"])
      expect(Object.keys(data.companies[0]).sort()).toEqual([
        "_count", "category", "city", "id", "industry", "leadScore", "leadStatus", "leadTemperature",
        "name", "slaPolicy", "status", "userCount", "website",
      ])
      const byContacts = await companies("category=client&view=list&sort=contacts&limit=1")
      expect(byContacts.companies[0]).toMatchObject({ name: "Nur Ticarət", _count: { contacts: 1, deals: 1 } })
    })

    it("refuses a status it does not know", async () => {
      const res = await companiesGet(get("/api/v1/companies?view=list&status=deleted"))
      expect(res.status).toBe(400)
    })
  })

  describe("deals", () => {
    it("searches name, company and notes on the server, in this organization only", async () => {
      const data = await deals(`view=list&pipelineId=${pipelineId}&search=kassa`)
      expect(data.deals.map((d: { name: string }) => d.name).sort()).toEqual(["Kassa sistemi", "Server otağı"])
      const byCompany = await deals(`view=list&pipelineId=${pipelineId}&search=nur%20ticar`)
      expect(byCompany.deals.map((d: { name: string }) => d.name)).toEqual(["Kassa sistemi"])
    })

    it("gives the board's stage totals for the whole pipeline, by currency, whatever the search and the stage filter", async () => {
      const data = await deals(`view=list&pipelineId=${pipelineId}&search=hosting&stage=WON`)
      expect(data.total).toBe(1)
      const totals = [...data.stageTotals].sort((a, b) => `${a.stage}${a.currency}`.localeCompare(`${b.stage}${b.currency}`))
      expect(totals).toEqual([
        { stage: "LEAD", currency: "AZN", count: 1, value: 1000 },
        { stage: "LOST", currency: "AZN", count: 1, value: 700 },
        { stage: "PROPOSAL", currency: "AZN", count: 1, value: 3000 },
        { stage: "WON", currency: "AZN", count: 1, value: 2000 },
        { stage: "WON", currency: "USD", count: 1, value: 500 },
      ])
    })

    it("sorts by value on the server and keeps a seller to their own and unassigned deals — totals included", async () => {
      const byValue = await deals(`view=list&pipelineId=${pipelineId}&sort=value_desc`)
      expect(byValue.deals.map((d: { name: string }) => d.name)).toEqual(["Server otağı", "Lisenziya", "Kassa sistemi", "Ləğv", "Hosting"])
      expect(byValue.deals[0]).not.toHaveProperty("campaign")

      signIn(ORG, "sales")
      const own = await deals(`view=list&pipelineId=${pipelineId}`)
      expect(own.deals.map((d: { name: string }) => d.name).sort()).toEqual(["Kassa sistemi", "Lisenziya", "Ləğv"])
      expect(own.stageTotals.reduce((n: number, t: { count: number }) => n + t.count, 0)).toBe(3)
    })

    it("caps a list page at 200 and keeps the pickers' 400 above 500", async () => {
      expect((await deals("view=list&limit=999")).limit).toBe(200)
      const res = await dealsGet(get("/api/v1/deals?limit=501"))
      expect(res.status).toBe(400)
    })
  })
})
