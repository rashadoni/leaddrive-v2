/**
 * «Ağıllı axtarış» on a real Postgres with pgvector — the SQL of
 * src/lib/clm/contract-search-index.ts, with only Voyage stood in by fixed
 * vectors (a lease is one direction, a sale another).
 *
 * What it holds: which contracts get a vector (new, changed since, another
 * model — never another organization's), what is sent to Voyage (title,
 * number, counterparty, the text with phones and e-mails masked), the order by
 * meaning, that another organization's contract never comes back — not even
 * through an embedding row filed under this organization — and the search by
 * words when there is no Voyage. Until 2026-11-26 the search had no switch,
 * no schedule and, without a key, a «vector» made of character codes.
 *
 * Set CONTRACT_SEARCH_TEST_DATABASE_URL to an admin connection on a Postgres
 * WITH pgvector, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55497:5432 pgvector/pgvector:pg16
 *   CONTRACT_SEARCH_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55497/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` (pgvector
 * image), where CONTRACT_SEARCH_DB_GATE=required makes a missing URL a failure.
 * Not in the deploy: its database is a plain postgres:16.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.CONTRACT_SEARCH_TEST_DATABASE_URL
if (!adminUrl && process.env.CONTRACT_SEARCH_DB_GATE === "required") {
  throw new Error("CONTRACT_SEARCH_TEST_DATABASE_URL is required by the contract search database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.CONTRACT_SEARCH_TEST_DATABASE_URL
  if (!admin) return null
  const name = `contract_search_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

/** What Voyage was asked to embed, and whether it answers. */
const voyage = vi.hoisted(() => ({ sent: [] as string[], down: false }))
vi.mock("@/lib/ai/voyage-embedding", () => ({
  VOYAGE_MODEL: "voyage-3-lite",
  // A lease points one way, a sale another, anything else a third: enough to see «nearest by meaning».
  voyageEmbedding: vi.fn(async (_orgId: string, text: string) => {
    voyage.sent.push(text)
    if (voyage.down) return null
    const v = new Array(512).fill(0)
    const lower = text.toLowerCase()
    if (/icarə|lease/.test(lower)) v[0] = 1
    if (/satqı|satış|sale/.test(lower)) v[1] = 1
    if (v[0] === 0 && v[1] === 0) v[2] = 1
    return v
  }),
}))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
}

const pgDescribe = adminUrl ? describe : describe.skip
const ORG = "org-search"
const OTHER = "org-other"

pgDescribe("contract search on a real Postgres with pgvector", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let lib!: typeof import("@/lib/clm/contract-search-index")
  const inBypass = <T,>(fn: () => Promise<T>) => bypass(fn)
  type VectorRow = { contractId: string; organizationId: string; content: string; model: string }
  const vectorRows = (): Promise<VectorRow[]> => inBypass(() => prisma.$queryRaw<VectorRow[]>`
    SELECT "contractId", "organizationId", content, model FROM contract_embeddings ORDER BY "contractId"`)

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, "CREATE EXTENSION IF NOT EXISTS vector")
    prismaCli(["db", "push", "--schema", path.join(ROOT, "prisma/schema.prisma"), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    lib = await import("@/lib/clm/contract-search-index")
    await inBypass(async () => {
      for (const id of [ORG, OTHER]) await prisma.organization.create({ data: { id, name: id, slug: id, modules: { contracts: true } } })
      await prisma.company.create({ data: { id: "kaspi", organizationId: ORG, name: "Kaspi Ticarət MMC" } })
      await prisma.company.create({ data: { id: "nar", organizationId: ORG, name: "Nar Logistika MMC" } })
      await prisma.company.create({ data: { id: "foreign-co", organizationId: OTHER, name: "Kaspi Ticarət MMC" } })
      const contract = (id: string, organizationId: string, title: string, companyId: string | null, renderedBody: string | null) =>
        prisma.contract.create({ data: { id, organizationId, contractNumber: id.toUpperCase(), title, status: "active", companyId, renderedBody } })
      await contract("lease", ORG, "Ofis icarəsi", "kaspi", "İcarəyə verən ofisi icarəçiyə verir. Əlaqə: +994501234567, rent@kaspi.az")
      await contract("sale", ORG, "Avadanlıq alğı-satqısı", "nar", "Satıcı alıcıya avadanlıq təhvil verir.")
      await contract("bare", ORG, "Xidmət müqaviləsi", "nar", null)
      await contract("foreign", OTHER, "Ofis icarəsi", "foreign-co", "İcarəyə verən ofisi icarəçiyə verir.")
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => {
    voyage.sent.length = 0
    voyage.down = false
  })

  it("without Voyage nothing is stored — no made-up vector", async () => {
    voyage.down = true
    const run = await inBypass(() => lib.indexContracts(ORG, { limit: 10 }))
    expect(run).toEqual({ indexed: 0, unavailable: true })
    expect(await vectorRows()).toEqual([])
    expect(await inBypass(() => lib.indexOneContract(ORG, "lease"))).toBe("unavailable")
    expect(await vectorRows()).toEqual([])
  })

  it("indexes this organization's contracts only, from title, number, counterparty and the masked text", async () => {
    expect((await inBypass(() => lib.contractsToIndex(ORG, 50))).map((c) => c.id).sort()).toEqual(["bare", "lease", "sale"])
    const run = await inBypass(() => lib.indexContracts(ORG, { limit: 10 }))
    expect(run).toEqual({ indexed: 3, unavailable: false })
    const rows = await vectorRows()
    expect(rows.map((r) => [r.contractId, r.organizationId, r.model])).toEqual([
      ["bare", ORG, "voyage-3-lite"], ["lease", ORG, "voyage-3-lite"], ["sale", ORG, "voyage-3-lite"],
    ])
    const lease = rows.find((r) => r.contractId === "lease")!.content
    expect(lease).toContain("Ofis icarəsi")
    expect(lease).toContain("LEASE")
    expect(lease).toContain("Kaspi Ticarət MMC")
    for (const sent of [...voyage.sent, lease]) {
      expect(sent).not.toContain("+994501234567")
      expect(sent).not.toContain("rent@kaspi.az")
    }
    // a contract without a text is still found by its title and counterparty
    expect(rows.find((r) => r.contractId === "bare")!.content).toBe("Xidmət müqaviləsi\nBARE\nNar Logistika MMC")
    // nothing left to do — until a contract changes or the model does
    expect(await inBypass(() => lib.contractsToIndex(ORG, 50))).toEqual([])
    await inBypass(() => prisma.contract.update({ where: { id: "sale" }, data: { title: "Avadanlıq alğı-satqısı (yeni)" } }))
    await inBypass(() => prisma.$executeRaw`UPDATE contract_embeddings SET model = 'voyage-2' WHERE "contractId" = 'bare'`)
    expect((await inBypass(() => lib.contractsToIndex(ORG, 50))).map((c) => c.id).sort()).toEqual(["bare", "sale"])
    await inBypass(() => lib.indexContracts(ORG, { limit: 10 }))
    expect(await inBypass(() => lib.contractsToIndex(ORG, 50))).toEqual([])
  })

  it("the nearest in meaning comes first; another organization's contract never comes back", async () => {
    // A stray vector filed under this organization but pointing at another's contract must not leak it.
    await inBypass(() => prisma.$executeRaw`
      INSERT INTO contract_embeddings (id, "organizationId", "contractId", content, embedding, model, "createdAt", "updatedAt")
      VALUES ('stray', ${ORG}, 'foreign', 'x', ${`[1${",0".repeat(511)}]`}::vector, 'voyage-3-lite', NOW(), NOW())`)
    const lease = new Array(512).fill(0)
    lease[0] = 1
    const hits = await inBypass(() => lib.searchByMeaning(ORG, lease, 10, -1))
    expect(hits[0]).toMatchObject({ contractId: "lease", similarity: 1 })
    expect(hits.map((h) => h.contractId)).not.toContain("foreign")
    // the threshold drops what is not close
    expect((await inBypass(() => lib.searchByMeaning(ORG, lease, 10, 0.5))).map((h) => h.contractId)).toEqual(["lease"])
    expect(await inBypass(() => lib.searchByMeaning(OTHER, lease, 10, -1))).toEqual([])
  })

  it("the card's reindex: only this organization's contract", async () => {
    expect(await inBypass(() => lib.indexOneContract(ORG, "foreign"))).toBe("not_found")
    expect(await inBypass(() => lib.indexOneContract(ORG, "lease"))).toBe("indexed")
  })

  it("by words: every word, in title, number, counterparty or text — this organization only", async () => {
    const ids = async (q: string) => (await inBypass(() => lib.searchByWords(ORG, q, 10))).map((h) => h.contractId).sort()
    expect(await ids("Kaspi icarə")).toEqual(["lease"])
    expect(await ids("nar")).toEqual(["bare", "sale"])
    expect(await ids("SALE")).toEqual(["sale"])
    expect(await ids("Kaspi satıcı")).toEqual([])
    expect(await ids("% _")).toEqual([])
    expect((await inBypass(() => lib.searchByWords(OTHER, "Kaspi", 10))).map((h) => h.contractId)).toEqual(["foreign"])
  })
})
