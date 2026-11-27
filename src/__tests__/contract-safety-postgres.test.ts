/**
 * «Опасные места» of a contract on a real Postgres, connected as an application role without
 * BYPASSRLS, the tables under the standard tenant policy — the real routes, only the browser session
 * stubbed (owner 2026-11-26, mock «Опасные места», «Давай»).
 *
 *  - A signed contract is not deleted — its versions and the e-sign trail stay; a draft is.
 *  - The amount of an approved contract changes only with «Сохранить и вернуть в черновик»: then it
 *    is a draft again, its approval round superseded, an e-sign invitation still out voided.
 *  - The approved text changed in the editor: the same, and the reply says so.
 *  - A signed contract's dates change only by an administrator, and the audit log names who.
 *  - One number, one contract: the database refuses a second, the routes say so in a code.
 *
 * Set CONTRACT_SAFETY_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   CONTRACT_SAFETY_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the deploy («Contract safety
 * database gate»), where `CONTRACT_SAFETY_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.CONTRACT_SAFETY_TEST_DATABASE_URL
if (!adminUrl && process.env.CONTRACT_SAFETY_DB_GATE === "required") {
  throw new Error("CONTRACT_SAFETY_TEST_DATABASE_URL is required by the contract safety database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.CONTRACT_SAFETY_TEST_DATABASE_URL
  if (!admin) return null
  const name = `contract_safety_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "contract-safety-fixture-only"
  process.env.DATABASE_URL = app.toString()
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  return { name, role, adminDb: db.toString() }
})

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
const RLS_TABLES = ["contracts", "contract_versions", "contract_approval_stages", "esign_envelopes", "esign_signers", "esign_audit_events", "audit_logs"]

const ORG = "org-safe"
const ADMIN = "user-safe-admin"
const MANAGER = "user-safe-manager"
const SIGNED = "ctr-safe-signed"
const DRAFT = "ctr-safe-draft"
const APPROVED = "ctr-safe-approved"
const PENDING = "ctr-safe-pending"

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "contract-safety-schema-")), "schema.prisma")
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

;(scratch ? describe : describe.skip)("«Опасные места» on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let contract!: typeof import("@/app/api/v1/contracts/[id]/route")
  let contracts!: typeof import("@/app/api/v1/contracts/route")
  let body!: typeof import("@/app/api/v1/contracts/[id]/body/route")
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
  const read = (id: string) => bypass(() => prisma.contract.findUnique({ where: { id }, select: { status: true, valueAmount: true, endDate: true, currentApprovalStage: true, renderedBody: true } }))
  const stages = (id: string) => bypass(() => prisma.contractApprovalStage.findMany({ where: { contractId: id }, orderBy: { order: "asc" }, select: { status: true } }))
    .then((rows: Array<{ status: string }>) => rows.map((r) => r.status))

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'contract-safety-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    sql(scratch!.adminDb, RLS_TABLES.map(tenantPolicy).join("\n"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    contract = await import("@/app/api/v1/contracts/[id]/route")
    contracts = await import("@/app/api/v1/contracts/route")
    body = await import("@/app/api/v1/contracts/[id]/body/route")

    await bypass(async () => {
      await prisma.organization.create({ data: { id: ORG, name: "Tenant", slug: ORG, modules: { crm: true, contracts: true } } })
      await prisma.user.create({ data: { id: ADMIN, organizationId: ORG, email: "a@safe.test", name: "Admin", passwordHash: "x", role: "admin" } })
      await prisma.user.create({ data: { id: MANAGER, organizationId: ORG, email: "m@safe.test", name: "Menecer", passwordHash: "x", role: "manager" } })
      const base = { organizationId: ORG, valueAmount: 120_000, currency: "AZN", startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z") }
      await prisma.contract.create({ data: { ...base, id: SIGNED, contractNumber: "DG-1", title: "Signed", status: "active", signedAt: new Date("2026-01-01T00:00:00Z"), signedBy: "esign:env-old" } })
      await prisma.contractVersion.create({ data: { organizationId: ORG, contractId: SIGNED, versionNo: 1, renderedBody: "signed text", contentHash: "h1", source: "esign", isCanonicalSigned: true, createdBy: ADMIN } })
      await prisma.contract.create({ data: { ...base, id: DRAFT, contractNumber: "DG-2", title: "Draft", status: "draft" } })
      await prisma.contract.create({ data: { ...base, id: APPROVED, contractNumber: "DG-3", title: "Approved", status: "approved" } })
      await prisma.contract.create({ data: { ...base, id: PENDING, contractNumber: "DG-4", title: "Pending", status: "pending_approval", renderedBody: "<p>old</p>", bodyHtml: "<p>old</p>", currentApprovalStage: 1 } })
      for (const [id, status] of [[APPROVED, "approved"], [PENDING, "pending"]] as const) {
        await prisma.contractApprovalStage.create({ data: { organizationId: ORG, contractId: id, order: 1, label: "Hüquq", assigneeUserId: ADMIN, status } })
      }
      await prisma.esignEnvelope.create({ data: { id: "env-safe-out", organizationId: ORG, contractId: APPROVED, subject: "İmza", status: "sent", sentAt: new Date() } })
    })
  }, 300_000)

  afterAll(async () => {
    browser.current = null
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch!.role}"`)
  }, 120_000)

  it("a signed contract is not deleted, and its signed version stays; a draft is", async () => {
    as(ADMIN, "admin")
    expect(await call(contract.DELETE(req(`/api/v1/contracts/${SIGNED}`, "DELETE"), ctx(SIGNED)))).toMatchObject({ status: 409, body: { code: "CONTRACT_DELETE_LOCKED" } })
    expect(await read(SIGNED)).not.toBeNull()
    expect(await bypass(() => prisma.contractVersion.count({ where: { contractId: SIGNED } }))).toBe(1)
    expect((await call(contract.DELETE(req(`/api/v1/contracts/${DRAFT}`, "DELETE"), ctx(DRAFT)))).status).toBe(200)
    expect(await read(DRAFT)).toBeNull()
  })

  it("an approved amount changes only with the return to draft, and then the approval starts over", async () => {
    as(MANAGER, "manager")
    expect(await call(contract.PUT(req(`/api/v1/contracts/${APPROVED}`, "PUT", { valueAmount: 125_000 }), ctx(APPROVED))))
      .toMatchObject({ status: 409, body: { code: "REAPPROVAL_REQUIRED", fields: ["valueAmount"] } })
    expect(Number((await read(APPROVED)).valueAmount)).toBe(120_000)
    // a change that is not a term goes through as before
    expect((await call(contract.PUT(req(`/api/v1/contracts/${APPROVED}`, "PUT", { notes: "Qeyd" }), ctx(APPROVED)))).status).toBe(200)
    expect((await read(APPROVED)).status).toBe("approved")

    const res = await call(contract.PUT(req(`/api/v1/contracts/${APPROVED}`, "PUT", { valueAmount: 125_000, confirmReapproval: true }), ctx(APPROVED)))
    expect(res).toMatchObject({ status: 200, body: { returnedToDraft: true } })
    expect(await read(APPROVED)).toMatchObject({ status: "draft", currentApprovalStage: null })
    expect(Number((await read(APPROVED)).valueAmount)).toBe(125_000)
    expect(await stages(APPROVED)).toEqual(["superseded"])
    expect(await bypass(() => prisma.esignEnvelope.findUniqueOrThrow({ where: { id: "env-safe-out" }, select: { status: true, voidReason: true } })))
      .toEqual({ status: "voided", voidReason: "contract_changed" })
    const audit = await bypass(() => prisma.auditLog.findMany({ where: { entityId: APPROVED }, orderBy: { createdAt: "desc" }, take: 1 }))
    expect(audit[0]).toMatchObject({ userId: MANAGER, newValue: { status: "draft", reason: "reapproval_required" } })
  })

  it("a changed text of a contract in approval sends it back to draft too", async () => {
    as(MANAGER, "manager")
    const res = await call(body.PUT(req(`/api/v1/contracts/${PENDING}/body`, "PUT", { bodyHtml: "<p>new terms</p>" }), ctx(PENDING)))
    expect(res).toMatchObject({ status: 200, body: { data: { versionMinted: true, returnedToDraft: true } } })
    expect(await read(PENDING)).toMatchObject({ status: "draft", currentApprovalStage: null })
    expect(await stages(PENDING)).toEqual(["superseded"])
  })

  it("a signed contract's dates change only by an administrator, and the log names who", async () => {
    as(MANAGER, "manager")
    expect(await call(contract.PUT(req(`/api/v1/contracts/${SIGNED}`, "PUT", { endDate: "2027-12-31" }), ctx(SIGNED))))
      .toMatchObject({ status: 403, body: { code: "SIGNED_EDIT_ADMIN_ONLY", fields: ["endDate"] } })
    expect((await call(contract.PUT(req(`/api/v1/contracts/${SIGNED}`, "PUT", { notes: "ok" }), ctx(SIGNED)))).status).toBe(200)
    as(ADMIN, "admin")
    expect((await call(contract.PUT(req(`/api/v1/contracts/${SIGNED}`, "PUT", { endDate: "2027-12-31" }), ctx(SIGNED)))).status).toBe(200)
    expect((await read(SIGNED)).status).toBe("active")
    const audit = await bypass(() => prisma.auditLog.findMany({ where: { entityId: SIGNED }, orderBy: { createdAt: "desc" }, take: 1 }))
    expect(audit[0]).toMatchObject({ userId: ADMIN, oldValue: { endDate: { old: "2026-12-31", new: "2027-12-31" } } })
  })

  it("one number, one contract: a second is refused in a code, not a 500", async () => {
    as(ADMIN, "admin")
    expect(await call(contracts.POST(req("/api/v1/contracts", "POST", { contractNumber: "DG-1", title: "Again", status: "draft" }))))
      .toMatchObject({ status: 409, body: { code: "CONTRACT_NUMBER_TAKEN" } })
    expect(await call(contract.PUT(req(`/api/v1/contracts/${APPROVED}`, "PUT", { contractNumber: "DG-1" }), ctx(APPROVED))))
      .toMatchObject({ status: 409, body: { code: "CONTRACT_NUMBER_TAKEN" } })
    const { freeContractNumber } = await import("@/lib/clm/contract-safety")
    expect(await rls.runWithTenant(ORG, () => freeContractNumber(prisma, ORG, "DG-1"))).toBe("DG-1-2")
  })
})
