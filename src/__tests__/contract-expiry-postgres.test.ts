/**
 * A contract becomes «Истёк» once its last day is over — read off a real
 * Postgres after the real finance deadline job (src/lib/cron/finance-deadline-job.ts,
 * every 6 hours on prod), with only the clock moved.
 *
 * `endDate` is the contract's last valid day at 00:00 UTC (the form sends
 * "YYYY-MM-DD", the wizard start + N months − 1 day). Until 2026-11-26 the job
 * compared `endDate < now` and expired a contract on its own last day, at
 * 00:05 UTC — 04:05 in Baku — and wrote nothing about it. Here: the last day
 * stays «Активен» to its end, the next day it is «Истёк», only contracts in
 * force move, and each move is in the audit log as the system's, once.
 *
 * Set CONTRACT_EXPIRY_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   CONTRACT_EXPIRY_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Contract expiry database gate»), where
 * `CONTRACT_EXPIRY_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.CONTRACT_EXPIRY_TEST_DATABASE_URL
if (!adminUrl && process.env.CONTRACT_EXPIRY_DB_GATE === "required") {
  throw new Error("CONTRACT_EXPIRY_TEST_DATABASE_URL is required by the contract expiry database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.CONTRACT_EXPIRY_TEST_DATABASE_URL
  if (!admin) return null
  const name = `contract_expiry_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, after the scratch database exists.
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/** The schema as `db push` builds it on a plain postgres:16 (no pgvector; nothing here reads those columns). */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "contract-expiry-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const pgDescribe = adminUrl ? describe : describe.skip
const ORG = "org-expiry"
const OTHER = "org-other"
const at = (iso: string) => new Date(iso)

pgDescribe("contracts run out on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let runDeadlineJob!: typeof import("@/lib/cron/finance-deadline-job").runFinanceDeadlineJob

  const status = async (id: string) =>
    (await bypass(() => prisma.contract.findUniqueOrThrow({ where: { id }, select: { status: true } }))).status
  /** Run the job as the scheduler would at that moment — only `Date` is moved. */
  async function runAt(iso: string) {
    vi.setSystemTime(at(iso))
    const run = await runDeadlineJob()
    expect(run).toMatchObject({ status: "completed" })
    return run as unknown as { value: { expiredContracts: number } }
  }

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    // Nothing may leave the process: no organisation here set up Telegram.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      throw new Error(`unexpected outbound request to ${String(input)}`)
    })
    vi.useFakeTimers({ toFake: ["Date"] })
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    runDeadlineJob = (await import("@/lib/cron/finance-deadline-job")).runFinanceDeadlineJob
    for (const id of [ORG, OTHER]) {
      await bypass(() => prisma.organization.create({ data: { id, name: `Tenant ${id}`, slug: id, modules: { crm: true, contracts: true } } }))
    }
    const contracts: Array<[string, string, string, string]> = [
      // id, organisation, status, last valid day
      ["ended-yesterday", ORG, "active", "2026-12-30"],
      ["renewing-ended", ORG, "renewing", "2026-12-30"],
      ["last-day-today", ORG, "active", "2026-12-31"],
      ["ends-next-year", ORG, "active", "2027-06-30"],
      ["draft-ended", ORG, "draft", "2026-01-31"],
      ["approved-ended", ORG, "approved", "2026-01-31"],
      ["terminated-ended", ORG, "terminated", "2026-01-31"],
      ["other-org-ended", OTHER, "active", "2026-12-30"],
    ]
    for (const [id, organizationId, s, end] of contracts) {
      await bypass(() => prisma.contract.create({
        data: { id, organizationId, contractNumber: id, title: `Contract ${id}`, status: s, endDate: at(`${end}T00:00:00Z`) },
      }))
    }
    await bypass(() => prisma.contract.create({
      data: { id: "no-end-date", organizationId: ORG, contractNumber: "open", title: "Open-ended", status: "active" },
    }))
  }, 300_000)

  afterAll(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  it("on its last day a contract stays in force — the whole day, in Baku too", async () => {
    // 00:05 UTC is the first scheduled run of 31 December; 18:05 UTC is the last (22:05 in Baku).
    const first = await runAt("2026-12-31T00:05:00Z")
    expect(await status("last-day-today")).toBe("active")
    const last = await runAt("2026-12-31T18:05:00Z")
    expect(await status("last-day-today")).toBe("active")
    // what had already ended moved on the first run, and only once
    expect(first.value.expiredContracts).toBe(3)
    expect(last.value.expiredContracts).toBe(0)
  })

  it("a contract past its last day is «Истёк»; nothing else moves", async () => {
    expect(await status("ended-yesterday")).toBe("expired")
    expect(await status("renewing-ended")).toBe("expired")
    expect(await status("other-org-ended")).toBe("expired")
    expect(await status("draft-ended")).toBe("draft")
    expect(await status("approved-ended")).toBe("approved") // signed, not yet in force: a person decides
    expect(await status("terminated-ended")).toBe("terminated")
    expect(await status("ends-next-year")).toBe("active")
    expect(await status("no-end-date")).toBe("active")
  })

  it("the day after its last day it runs out", async () => {
    const run = await runAt("2027-01-01T00:05:00Z")
    expect(run.value.expiredContracts).toBe(1)
    expect(await status("last-day-today")).toBe("expired")
  })

  it("each move is in the audit log once, as the system's, with the reason", async () => {
    type AuditRow = { entityId: string | null; organizationId: string } & Record<string, unknown>
    const rows: AuditRow[] = await bypass(() => prisma.auditLog.findMany({ where: { entityType: "contract" }, orderBy: { createdAt: "asc" } }))
    expect(rows.map((r) => r.entityId).sort()).toEqual(["ended-yesterday", "last-day-today", "other-org-ended", "renewing-ended"])
    const row = rows.find((r) => r.entityId === "renewing-ended")!
    expect(row).toMatchObject({
      organizationId: ORG,
      userId: null,
      action: "update",
      entityName: "Contract renewing-ended",
      oldValue: { status: { old: "renewing", new: "expired" } },
      newValue: { status: "expired", reason: "end_date_passed", endDate: "2026-12-30" },
    })
    expect(rows.find((r) => r.entityId === "other-org-ended")!.organizationId).toBe(OTHER)
  })
})
