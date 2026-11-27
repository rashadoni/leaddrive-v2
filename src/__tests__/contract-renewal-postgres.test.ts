/**
 * «Продление» of a contract on a real Postgres, connected as an application role without BYPASSRLS,
 * the tables under the standard tenant policy — the real routes and the real reminder job, only the
 * browser session, the bell and the e-mail stubbed (owner 2026-11-26, mock «Продление», «Давай»).
 *
 *  - «Продлить» makes a draft with the same parties and text, the new dates, a number «<old>/<year>»,
 *    linked to the old contract; the old one is «Продлевается». A second press names the first.
 *  - The renewal signed on paper: the old contract is «Продлён», and its reminders stop.
 *  - The renewal cancelled or deleted: the old contract is «Активный» again.
 *  - An ended contract is renewed too, and stays «Истёк».
 *  - The reminder goes to the person who made the contract, by bell and e-mail with «Продлить»;
 *    without an author, to the admins and managers as before.
 *
 * Set CONTRACT_RENEWAL_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   CONTRACT_RENEWAL_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the deploy («Contract renewal
 * database gate»), where `CONTRACT_RENEWAL_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.CONTRACT_RENEWAL_TEST_DATABASE_URL
if (!adminUrl && process.env.CONTRACT_RENEWAL_DB_GATE === "required") {
  throw new Error("CONTRACT_RENEWAL_TEST_DATABASE_URL is required by the contract renewal database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.CONTRACT_RENEWAL_TEST_DATABASE_URL
  if (!admin) return null
  const name = `contract_renewal_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "contract-renewal-fixture-only"
  process.env.DATABASE_URL = app.toString()
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  process.env.CRON_SECRET = "contract-renewal-cron-secret"
  return { name, role, adminDb: db.toString() }
})

// Uploads go to a scratch directory, never the checkout's (a real LEADDRIVE_RUNTIME_DIR under /tmp
// is refused by runtime-paths as an ephemeral path, and that is right).
vi.mock("@/lib/runtime-paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runtime-paths")>()
  const nodePath = await import("node:path")
  return { ...actual, runtimePublicUploadDirectory: (subdir: string) => nodePath.join(process.env.CONTRACT_RENEWAL_UPLOAD_ROOT!, subdir) }
})
if (scratch) process.env.CONTRACT_RENEWAL_UPLOAD_ROOT = mkdtempSync(path.join(tmpdir(), "contract-renewal-uploads-"))

const outbox = vi.hoisted(() => ({
  bell: [] as Array<{ userId: string; entityId?: string; title?: string }>,
  mail: [] as Array<{ to: string; subject: string; html: string }>,
}))
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(async (n: { userId: string; entityId?: string; title?: string }) => { outbox.bell.push(n); return { id: `n-${outbox.bell.length}` } }),
}))
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string; html: string }) => { outbox.mail.push(m); return { success: true } }),
}))

const browser = vi.hoisted(() => ({
  current: null as null | { orgId: string; userId: string; role: string; email: string; name: string; principalType: "session" },
}))
vi.mock("@/lib/api-auth", () => {
  const unauthorized = () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
  return {
    getOrgId: vi.fn(async () => browser.current?.orgId ?? null),
    getSession: vi.fn(async () => browser.current),
    requireAuth: vi.fn(async () => browser.current ?? unauthorized()),
    requireSessionAuth: vi.fn(async () => browser.current ?? unauthorized()),
    isAuthError: (value: unknown) => value instanceof Response,
    orgHasModule: vi.fn(async () => true),
    moduleDisabledResponse: vi.fn(() => NextResponse.json({ error: "Forbidden" }, { status: 403 })),
  }
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const RLS_TABLES = [
  "contracts", "contract_versions", "contract_files", "contract_approval_stages", "contract_renewal_alerts",
  "esign_envelopes", "esign_signers", "esign_audit_events", "audit_logs",
]

const ORG = "org-renew"
const ADMIN = "user-renew-admin"
const MANAGER = "user-renew-manager"
const AUTHOR = "user-renew-author" // a sales rep who made the contract
const ACTIVE = "ctr-renew-active" // in force, ends in 40 days, made by AUTHOR
const SECOND = "ctr-renew-second" // in force, for cancel and delete
const ENDED = "ctr-renew-ended" // ended
const DRAFT = "ctr-renew-draft"
const ORPHAN = "ctr-renew-orphan" // in force, no author
const PDF = Buffer.from("%PDF-1.4\n% a scan of the signed renewal\n%%EOF\n")
const DAY = 86_400_000

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "contract-renewal-schema-")), "schema.prisma")
  writeFileSync(file, schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
  return file
}
function tenantPolicy(table: string): string {
  return `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "${table}"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');`
}
const utcDay = (offsetDays: number) => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offsetDays * DAY)
}
const dayText = (d: Date) => d.toISOString().slice(0, 10)

;(scratch ? describe : describe.skip)("«Продление» on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let renew!: typeof import("@/app/api/v1/contracts/[id]/renew/route")
  let detail!: typeof import("@/app/api/v1/contracts/[id]/route")
  let cancel!: typeof import("@/app/api/v1/contracts/[id]/cancel/route")
  let paper!: typeof import("@/app/api/v1/contracts/[id]/paper-signature/route")
  let alerts!: typeof import("@/app/api/cron/renewal-alerts/route")
  let createdDb = false
  let createdRole = false

  const as = (userId: string, role: string) => {
    browser.current = { orgId: ORG, userId, role, email: `${userId}@example.test`, name: userId, principalType: "session" }
  }
  // The exported prisma is untyped (CLAUDE.md, «Память тайпчека»), so are the rows it reads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bypass = (fn: () => Promise<unknown>): Promise<any> => rls.runWithRlsBypass(fn) as Promise<any>
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
  const req = (url: string, method: string, payload?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
    method,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload), headers: { "content-type": "application/json" } }),
  })
  const call = async (res: Promise<Response>) => { const r = await res; return { status: r.status, body: await r.json() } }
  const status = (id: string) => bypass(() => prisma.contract.findUniqueOrThrow({ where: { id }, select: { status: true } })).then((r: { status: string }) => r.status)
  const renewOf = (id: string, payload: Record<string, unknown>) => call(renew.POST(req(`/api/v1/contracts/${id}/renew`, "POST", payload), ctx(id)))
  async function signOnPaper(contractId: string) {
    const form = new FormData()
    form.set("signedAt", dayText(utcDay(0)))
    form.set("file", new File([new Uint8Array(PDF)], "renewal.pdf", { type: "application/pdf" }))
    const res = await paper.POST(
      new NextRequest(`http://localhost:3000/api/v1/contracts/${contractId}/paper-signature`, { method: "POST", body: form, headers: { "user-agent": "vitest" } }),
      ctx(contractId),
    )
    return { status: res.status, body: await res.json() }
  }

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'contract-renewal-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    sql(scratch!.adminDb, RLS_TABLES.map(tenantPolicy).join("\n"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    renew = await import("@/app/api/v1/contracts/[id]/renew/route")
    detail = await import("@/app/api/v1/contracts/[id]/route")
    cancel = await import("@/app/api/v1/contracts/[id]/cancel/route")
    paper = await import("@/app/api/v1/contracts/[id]/paper-signature/route")
    alerts = await import("@/app/api/cron/renewal-alerts/route")

    await bypass(async () => {
      await prisma.organization.create({ data: { id: ORG, name: "Tenant", slug: ORG, modules: { crm: true, contracts: true } } })
      await prisma.user.create({ data: { id: ADMIN, organizationId: ORG, email: "admin@renew.test", name: "Admin", passwordHash: "x", role: "admin" } })
      await prisma.user.create({ data: { id: MANAGER, organizationId: ORG, email: "manager@renew.test", name: "Menecer", passwordHash: "x", role: "manager" } })
      await prisma.user.create({ data: { id: AUTHOR, organizationId: ORG, email: "author@renew.test", name: "Satıcı", passwordHash: "x", role: "sales" } })
      await prisma.company.create({ data: { id: "co-renew", organizationId: ORG, name: "Müştəri MMC" } })
      const inForce = { organizationId: ORG, valueAmount: 120_000, currency: "AZN", companyId: "co-renew", renderedBody: "<p>Şərtlər</p>", bodyHtml: "<p>Şərtlər</p>" }
      // A year that ends in 40 days.
      await prisma.contract.create({ data: { ...inForce, id: ACTIVE, contractNumber: "DG-7", title: "Xidmət", status: "active", startDate: utcDay(-325), endDate: utcDay(40), signedAt: utcDay(-325), createdBy: AUTHOR } })
      await prisma.contract.create({ data: { ...inForce, id: SECOND, contractNumber: "DG-8", title: "Təchizat", status: "active", startDate: utcDay(-300), endDate: utcDay(65), signedAt: utcDay(-300) } })
      await prisma.contract.create({ data: { ...inForce, id: ENDED, contractNumber: "DG-9", title: "Köhnə", status: "expired", startDate: utcDay(-400), endDate: utcDay(-35), signedAt: utcDay(-400) } })
      await prisma.contract.create({ data: { ...inForce, id: DRAFT, contractNumber: "DG-10", title: "Qaralama", status: "draft" } })
      await prisma.contract.create({ data: { ...inForce, id: ORPHAN, contractNumber: "DG-11", title: "Sahibsiz", status: "active", startDate: utcDay(-335), endDate: utcDay(30), signedAt: utcDay(-335) } })
      for (const [contractId, days] of [[ACTIVE, 60], [ACTIVE, 30], [ORPHAN, 30]] as const) {
        await prisma.contractRenewalAlert.create({ data: { organizationId: ORG, contractId, daysBeforeExpiry: days, dueAt: utcDay(-1), status: "pending" } })
      }
    })
  }, 300_000)

  afterAll(async () => {
    browser.current = null
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch!.role}"`)
  }, 120_000)

  it("the reminder goes to the person who made the contract, by bell and e-mail with «Продлить»; without an author to the admins and managers", async () => {
    const res = await alerts.POST(new NextRequest("http://localhost/api/cron/renewal-alerts", { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET! } }))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ processed: 3, errors: 0 })

    const toActive = outbox.bell.filter((n) => n.entityId === ACTIVE).map((n) => n.userId)
    expect(toActive).toEqual([AUTHOR, AUTHOR]) // the 60- and 30-day reminders, both to the author
    expect(outbox.bell.filter((n) => n.entityId === ORPHAN).map((n) => n.userId).sort()).toEqual([ADMIN, MANAGER])
    const authorMail = outbox.mail.filter((m) => m.to === "author@renew.test")
    expect(authorMail).toHaveLength(2)
    expect(authorMail[0].html).toContain(`/contracts/${ACTIVE}?renew=1`)
    expect(outbox.mail.filter((m) => m.html.includes(`/contracts/${ORPHAN}?renew=1`)).map((m) => m.to).sort()).toEqual(["admin@renew.test", "manager@renew.test"])
    const delivered = await bypass(() => prisma.contractRenewalAlert.findMany({ where: { organizationId: ORG }, select: { status: true, deliveredVia: true } }))
    expect(delivered).toEqual(Array(3).fill({ status: "sent", deliveredVia: "in_app+email" }))
    // the reminders made sent here are the ones a renewal then supersedes — put two back as pending
    await bypass(() => prisma.contractRenewalAlert.updateMany({ where: { contractId: ACTIVE }, data: { status: "pending", deliveredVia: null, deliveredAt: null } }))
  })

  it("«Продлить» makes a draft with the same parties and text, linked to the old contract, which is «Продлевается»", async () => {
    as(MANAGER, "manager")
    const start = dayText(utcDay(41))
    const end = dayText(utcDay(41 + 365))
    const res = await renewOf(ACTIVE, { startDate: start, endDate: end, valueAmount: 132_000 })
    expect(res.status).toBe(201)
    const renewal = await bypass(() => prisma.contract.findUniqueOrThrow({
      where: { id: res.body.data.id },
      select: { status: true, contractNumber: true, title: true, companyId: true, currency: true, valueAmount: true, startDate: true, endDate: true, renewalSourceContractId: true, renderedBody: true, bodyHtml: true, createdBy: true },
    }))
    expect(renewal).toMatchObject({
      status: "draft", contractNumber: `DG-7/${start.slice(0, 4)}`, title: "Xidmət", companyId: "co-renew", currency: "AZN",
      renewalSourceContractId: ACTIVE, renderedBody: "<p>Şərtlər</p>", bodyHtml: "<p>Şərtlər</p>", createdBy: MANAGER,
    })
    expect(Number(renewal.valueAmount)).toBe(132_000)
    expect(dayText(renewal.startDate)).toBe(start)
    expect(dayText(renewal.endDate)).toBe(end)
    expect(await bypass(() => prisma.contractVersion.count({ where: { contractId: res.body.data.id } }))).toBe(1)
    expect(await status(ACTIVE)).toBe("renewing")
    const audit = await bypass(() => prisma.auditLog.findMany({ where: { entityId: ACTIVE }, select: { userId: true, newValue: true } }))
    expect(audit).toEqual([expect.objectContaining({ userId: MANAGER, newValue: expect.objectContaining({ reason: "renewal_created", renewalContractId: res.body.data.id }) })])

    // The card shows both ends of the link.
    const old = await call(detail.GET(req(`/api/v1/contracts/${ACTIVE}`, "GET"), ctx(ACTIVE)))
    expect(old.body.data.renewedAs).toEqual([{ id: res.body.data.id, contractNumber: renewal.contractNumber, status: "draft" }])
    const fresh = await call(detail.GET(req(`/api/v1/contracts/${res.body.data.id}`, "GET"), ctx(res.body.data.id)))
    expect(fresh.body.data.renewalSource).toEqual({ id: ACTIVE, contractNumber: "DG-7", status: "renewing" })

    // A second press names the first and makes nothing.
    expect(await renewOf(ACTIVE, { startDate: start, endDate: end })).toMatchObject({
      status: 409, body: { code: "RENEWAL_EXISTS", renewal: { id: res.body.data.id, contractNumber: renewal.contractNumber } },
    })
    expect(await bypass(() => prisma.contract.count({ where: { renewalSourceContractId: ACTIVE } }))).toBe(1)
  })

  it("the renewal signed on paper: the old contract is «Продлён», and its reminders stop", async () => {
    const renewal = await bypass(() => prisma.contract.findFirstOrThrow({ where: { renewalSourceContractId: ACTIVE }, select: { id: true } }))
    as(ADMIN, "admin") // a draft signed on paper is the administrator's
    expect((await signOnPaper(renewal.id)).status).toBe(200)
    expect(await status(renewal.id)).toBe("active")
    expect(await status(ACTIVE)).toBe("renewed")
    const old = await bypass(() => prisma.contractRenewalAlert.findMany({ where: { contractId: ACTIVE }, select: { status: true } }))
    expect(old).toEqual([{ status: "superseded" }, { status: "superseded" }])
    // and the new contract has its own reminders now
    expect(await bypass(() => prisma.contractRenewalAlert.count({ where: { contractId: renewal.id, status: "pending" } }))).toBeGreaterThan(0)
    // a renewed contract is not renewed again
    as(MANAGER, "manager")
    expect(await renewOf(ACTIVE, { startDate: dayText(utcDay(41)), endDate: dayText(utcDay(400)) })).toMatchObject({ status: 409, body: { code: "NOT_RENEWABLE" } })
  })

  it("a renewal cancelled or deleted gives the old contract back: «Активный»", async () => {
    as(MANAGER, "manager")
    const first = await renewOf(SECOND, { startDate: dayText(utcDay(66)), endDate: dayText(utcDay(430)) })
    expect(first.status).toBe(201)
    expect(await status(SECOND)).toBe("renewing")
    expect((await call(cancel.POST(req(`/api/v1/contracts/${first.body.data.id}/cancel`, "POST", { reason: "Müştəri imtina etdi" }), ctx(first.body.data.id)))).status).toBe(200)
    expect(await status(SECOND)).toBe("active")

    const second = await renewOf(SECOND, { startDate: dayText(utcDay(66)), endDate: dayText(utcDay(430)) })
    expect(second.status).toBe(201)
    expect(second.body.data.contractNumber).not.toBe(first.body.data.contractNumber) // the number is made free
    expect(await status(SECOND)).toBe("renewing")
    as(ADMIN, "admin")
    expect((await call(detail.DELETE(req(`/api/v1/contracts/${second.body.data.id}`, "DELETE"), ctx(second.body.data.id)))).status).toBe(200)
    expect(await status(SECOND)).toBe("active")
  })

  it("an ended contract is renewed and stays «Истёк»; a draft and wrong dates are refused", async () => {
    as(MANAGER, "manager")
    const res = await renewOf(ENDED, { startDate: dayText(utcDay(0)), endDate: dayText(utcDay(364)) })
    expect(res.status).toBe(201)
    expect(await status(ENDED)).toBe("expired")
    as(ADMIN, "admin")
    expect((await signOnPaper(res.body.data.id)).status).toBe(200)
    expect(await status(ENDED)).toBe("expired")

    as(MANAGER, "manager")
    expect(await renewOf(DRAFT, { startDate: dayText(utcDay(0)), endDate: dayText(utcDay(364)) })).toMatchObject({ status: 409, body: { code: "NOT_RENEWABLE" } })
    expect(await renewOf(ORPHAN, { startDate: dayText(utcDay(40)), endDate: dayText(utcDay(39)) })).toMatchObject({ status: 400, body: { code: "RENEWAL_DATES_INVALID" } })
    expect(await renewOf(ORPHAN, { startDate: "2027-02-30", endDate: "2028-01-01" })).toMatchObject({ status: 400, body: { code: "RENEWAL_DATES_INVALID" } })
    expect(await status(ORPHAN)).toBe("active")
  })
})
