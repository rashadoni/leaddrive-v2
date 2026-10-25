/**
 * A company's VÖEN against a real Postgres: the API keeps it as ten digits and
 * refuses anything else, the form's duplicate warning finds the other company
 * of the same organization (never one of another organization, never itself),
 * and «VÖEN ilə doldur» reads the tax registry's card.
 *
 * Stood in for: the Fanum station relay to the tax registry (its fetch), with
 * the registry's answers as they came back live on 2026-10-24 — a found
 * entity, the registry's own 404 «tax_payer_not_found», and a station without
 * the relay. The company is fictional; the shape is the registry's.
 *
 * Set COMPANY_VOEN_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55501:5432 postgres:16
 *   COMPANY_VOEN_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55501/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy («Company VÖEN database gate»), where COMPANY_VOEN_DB_GATE=required
 * turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.COMPANY_VOEN_TEST_DATABASE_URL
if (!adminUrl && process.env.COMPANY_VOEN_DB_GATE === "required") {
  throw new Error("COMPANY_VOEN_TEST_DATABASE_URL is required by the company VÖEN database gate")
}

const scratch = vi.hoisted(() => {
  process.env.TENANT_PII_MASTER_KEY = "7".repeat(64)
  const admin = process.env.COMPANY_VOEN_TEST_DATABASE_URL
  if (!admin) return null
  const name = `company_voen_${process.pid}`
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

const relay = vi.hoisted(() => ({ answer: null as null | (() => Response), calls: [] as { url: string; body: unknown }[] }))
vi.mock("@/lib/voip/fanum-pbx-control-transport", () => ({
  secureFanumPbxControlFetch: async (input: string | URL, init?: RequestInit) => {
    relay.calls.push({ url: String(input), body: JSON.parse(String(init?.body)) })
    if (!relay.answer) throw new Error("connect ETIMEDOUT")
    return relay.answer()
  },
}))

const ROOT = process.cwd()
const ORG = "org-voen"
const OTHER_ORG = "org-voen-other"
const VOEN = "1700000001"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const FOUND = json(200, {
  taxpayers: [{
    name: "\"NUR TİCARƏT\" MƏHDUD MƏSULİYYƏTLİ CƏMİYYƏTİ",
    tin: VOEN,
    type: "legalEntity",
    active: true,
    vatPayer: true,
    riskyPayer: false,
    organizationType: "Məhdud məsuliyyətli cəmiyyət",
    legalTaxpayerStatus: {
      name: "\"NUR TİCARƏT\" MƏHDUD MƏSULİYYƏTLİ CƏMİYYƏTİ",
      tin: VOEN,
      legalAddress: "AZ1000, BAKI ŞƏHƏRİ  SƏBAİL RAYONU, NEFTÇİLƏR PR., ev.1",
      legitimate: "ƏLİ MƏMMƏDOV VÜQAR OĞLU",
      legalForm: { code: "21", name: { az: "Məhdud Məsuliyyətli Cəmiyyət", ru: "Общество с ограниченной ответственностью", en: "Limited Liability Company" } },
    },
  }],
})
const NOT_IN_REGISTRY = json(404, { code: "authless-106", debug: "tax_payer_not_found" })
const STATION_WITHOUT_RELAY = () => new Response("<html>404 Not Found</html>", { status: 404, headers: { "content-type": "text/html" } })

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "company-voen-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const request = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("a company's VÖEN on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let createCompany!: typeof import("@/app/api/v1/companies/route").POST
  let updateCompany!: typeof import("@/app/api/v1/companies/[id]/route").PUT
  let byVoen!: typeof import("@/app/api/v1/companies/by-voen/route").GET
  let lookup!: typeof import("@/app/api/v1/companies/registry-lookup/route").POST

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    createCompany = (await import("@/app/api/v1/companies/route")).POST
    updateCompany = (await import("@/app/api/v1/companies/[id]/route")).PUT
    byVoen = (await import("@/app/api/v1/companies/by-voen/route")).GET
    lookup = (await import("@/app/api/v1/companies/registry-lookup/route")).POST
    await bypass(async () => {
      for (const [id, slug] of [[ORG, "voen-shop"], [OTHER_ORG, "voen-other"]]) {
        await prisma.organization.create({ data: { id, name: slug, slug, modules: { crm: true, sales: true } } })
        await prisma.user.create({ data: { id: `admin-${id}`, organizationId: id, email: `admin@${slug}.test`, name: "Admin", passwordHash: "-", role: "admin" } })
      }
      // Another organization's client with the same VÖEN: never this organization's duplicate.
      await prisma.company.create({ data: { organizationId: OTHER_ORG, name: "Their copy", voen: VOEN } })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => {
    relay.answer = null
    relay.calls = []
    session.current = { user: { id: `admin-${ORG}`, organizationId: ORG, role: "admin", email: "admin@voen-shop.test", name: "Admin" } }
  })

  const companies = () => bypass(() => prisma.company.findMany({ where: { organizationId: ORG }, orderBy: { createdAt: "asc" } }))
  const duplicateOf = async (voen: string, exclude?: string) => {
    const res = await byVoen(request("GET", `/api/v1/companies/by-voen?voen=${voen}${exclude ? `&exclude=${exclude}` : ""}`))
    return (await res.json()).data?.duplicate ?? null
  }

  it("keeps a VÖEN as its ten digits, refuses anything else, and stores the director", async () => {
    const bad = await createCompany(request("POST", "/api/v1/companies", { name: "Typo", voen: "17000" }))
    const good = await createCompany(request("POST", "/api/v1/companies", { name: "Nur Ticarət", voen: "17 0000 0001", director: " Əli Məmmədov Vüqar oğlu " }))

    expect([bad.status, (await bad.json()).code]).toEqual([400, "INVALID_VOEN"])
    expect(good.status, await good.clone().text()).toBe(201)
    expect((await companies()).map((c) => [c.name, c.voen, c.director])).toEqual([["Nur Ticarət", VOEN, "Əli Məmmədov Vüqar oğlu"]])
  })

  it("warns about the same VÖEN in this organization only, and not about the company itself", async () => {
    const [first] = await companies()

    expect(await duplicateOf(VOEN)).toEqual({ id: first.id, name: "Nur Ticarət" })
    expect(await duplicateOf(VOEN, first.id)).toBeNull()
    expect(await duplicateOf("1700000002")).toBeNull()
  })

  it("an edit without the VÖEN keeps it, and an empty one clears it", async () => {
    const [first] = await companies()
    await updateCompany(request("PUT", `/api/v1/companies/${first.id}`, { industry: "Retail" }), { params: Promise.resolve({ id: first.id }) })
    expect((await companies())[0].voen).toBe(VOEN)

    await updateCompany(request("PUT", `/api/v1/companies/${first.id}`, { voen: "" }), { params: Promise.resolve({ id: first.id }) })
    expect((await companies())[0].voen).toBeNull()
    await updateCompany(request("PUT", `/api/v1/companies/${first.id}`, { voen: VOEN }), { params: Promise.resolve({ id: first.id }) })
  })

  it("reads the registry's card through the station, with the duplicate and nothing written", async () => {
    relay.answer = FOUND
    const before = await companies()
    const res = await lookup(request("POST", "/api/v1/companies/registry-lookup", { voen: VOEN }))
    const body = await res.json()

    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body.data.card).toEqual({
      voen: VOEN,
      name: "\"NUR TİCARƏT\" MƏHDUD MƏSULİYYƏTLİ CƏMİYYƏTİ",
      legalForm: "Məhdud Məsuliyyətli Cəmiyyət",
      legalAddress: "AZ1000, BAKI ŞƏHƏRİ SƏBAİL RAYONU, NEFTÇİLƏR PR., ev.1",
      director: "Əli Məmmədov Vüqar oğlu",
      active: true,
      vatPayer: true,
    })
    expect(body.data.duplicate).toEqual({ id: before[0].id, name: "Nur Ticarət" })
    expect(relay.calls).toEqual([{
      url: "https://127.0.0.1:18088/registry/az/find-taxpayer",
      body: { tin: VOEN, type: "legalEntity", serviceCode: "checkLegalName", isStateRegistry: true },
    }])
    expect(await companies()).toEqual(before)
  })

  it("tells «not in the registry» from «the registry cannot answer»", async () => {
    relay.answer = NOT_IN_REGISTRY
    const missing = await lookup(request("POST", "/api/v1/companies/registry-lookup", { voen: "1700000002" }))
    relay.answer = STATION_WITHOUT_RELAY
    const noRelay = await lookup(request("POST", "/api/v1/companies/registry-lookup", { voen: "1700000002" }))
    relay.answer = null
    const unreachable = await lookup(request("POST", "/api/v1/companies/registry-lookup", { voen: "1700000002" }))
    const invalid = await lookup(request("POST", "/api/v1/companies/registry-lookup", { voen: "17" }))

    expect([missing.status, (await missing.json()).code]).toEqual([404, "NOT_FOUND"])
    expect([noRelay.status, (await noRelay.json()).code]).toEqual([502, "REGISTRY_UNAVAILABLE"])
    expect([unreachable.status, (await unreachable.json()).code]).toEqual([502, "REGISTRY_UNAVAILABLE"])
    expect([invalid.status, (await invalid.json()).code]).toEqual([400, "INVALID_VOEN"])
    expect(relay.calls).toHaveLength(3)
  })
})
