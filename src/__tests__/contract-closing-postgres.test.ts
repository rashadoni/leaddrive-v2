/**
 * Ending a contract on a real Postgres, connected as an application role without BYPASSRLS, the
 * tables under the standard tenant policy — the real routes and the real scheduled pass, only the
 * browser session stubbed (owner 2026-11-26, mock «Расторжение», «Давай»).
 *
 * Until then «Расторгнут» and «Отменён» were filter tabs no button reached, and a rejected contract
 * was a dead end.
 *
 *  - Termination today: «Расторгнут» at once, who/why/when recorded, the signed agreement sealed as
 *    a "termination_copy" file, the renewal reminders superseded, every e-sign invitation still out
 *    — the contract's and a protocol's — voided, the protocol back to draft; one audit row.
 *  - Termination from a later day: still in force, reminders superseded; withdrawn — reminders back;
 *    set again — the scheduled pass makes it «Расторгнут» on that day and not before, as the system.
 *  - Cancellation: a contract that never took effect, with a reason; the approval chain still
 *    waiting is superseded. A contract in force is not cancelled, nor terminated twice.
 *  - «Вернуть в черновик»: a rejected contract is a draft again with its old round superseded, and
 *    the real submit route starts a clean chain for it.
 *  - Another organization's contract is not there at all.
 *
 * Set CONTRACT_CLOSING_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   CONTRACT_CLOSING_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the deploy («Contract closing
 * database gate»), where `CONTRACT_CLOSING_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.CONTRACT_CLOSING_TEST_DATABASE_URL
if (!adminUrl && process.env.CONTRACT_CLOSING_DB_GATE === "required") {
  throw new Error("CONTRACT_CLOSING_TEST_DATABASE_URL is required by the contract closing database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.CONTRACT_CLOSING_TEST_DATABASE_URL
  if (!admin) return null
  const name = `contract_closing_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "contract-closing-fixture-only"
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
// The submit route tells approvers; who is told is not what this file is about.
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }))
vi.mock("@/lib/integrations/contract-alerts", () => ({ sendContractAlert: vi.fn(async () => undefined) }))
// Uploads go to a scratch directory (a real LEADDRIVE_RUNTIME_DIR under /tmp is refused, and rightly).
vi.mock("@/lib/runtime-paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runtime-paths")>()
  const nodePath = await import("node:path")
  return { ...actual, runtimePublicUploadDirectory: (subdir: string) => nodePath.join(process.env.CONTRACT_CLOSING_UPLOAD_ROOT!, subdir) }
})
if (scratch) process.env.CONTRACT_CLOSING_UPLOAD_ROOT = mkdtempSync(path.join(tmpdir(), "contract-closing-uploads-"))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const RLS_TABLES = [
  "contracts", "contract_files", "contract_documents", "contract_approval_stages", "contract_renewal_alerts",
  "esign_envelopes", "esign_signers", "esign_audit_events", "audit_logs",
]

const ORG = "org-close"
const OTHER = "org-close-other"
const ADMIN = "user-close-admin"
const MANAGER = "user-close-manager"
const NOW_ACTIVE = "ctr-close-now" // terminated today
const LATER = "ctr-close-later" // terminated from a later day
const IN_APPROVAL = "ctr-close-pending"
const REJECTED = "ctr-close-rejected"
const DRAFT = "ctr-close-draft"
const OTHERS = "ctr-close-other-org"
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const DAY = 86_400_000
const todayUtc = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) }
const iso = (d: Date) => d.toISOString().slice(0, 10)

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "contract-closing-schema-")), "schema.prisma")
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

;(scratch ? describe : describe.skip)("ending a contract on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let terminate!: typeof import("@/app/api/v1/contracts/[id]/terminate/route")
  let cancel!: typeof import("@/app/api/v1/contracts/[id]/cancel/route")
  let reopen!: typeof import("@/app/api/v1/contracts/[id]/reopen/route")
  let submit!: typeof import("@/app/api/v1/contracts/[id]/submit-for-approval/route")
  let detail!: typeof import("@/app/api/v1/contracts/[id]/route")
  let scheduled!: typeof import("@/lib/contract-lifecycle/terminate-scheduled")
  let uploadsDir = ""
  let createdDb = false
  let createdRole = false
  const later = new Date(todayUtc().getTime() + 10 * DAY)

  const as = (userId: string, role: string) => {
    browser.current = { orgId: ORG, userId, role, email: `${userId}@example.test`, name: userId, principalType: "session" }
  }
  // The exported prisma is untyped (CLAUDE.md, «Память тайпчека»), so are the rows it reads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bypass = (fn: () => Promise<unknown>): Promise<any> => rls.runWithRlsBypass(fn) as Promise<any>
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
  const url = (id: string, tail: string) => `http://localhost:3000/api/v1/contracts/${id}/${tail}`
  const read = (id: string) => bypass(() => prisma.contract.findUniqueOrThrow({
    where: { id },
    select: { status: true, terminationDate: true, terminationReason: true, closeNote: true, closedBy: true, closedAt: true, currentApprovalStage: true },
  }))
  const alerts = (id: string) => bypass(() => prisma.contractRenewalAlert.findMany({ where: { contractId: id }, orderBy: { daysBeforeExpiry: "desc" }, select: { status: true } }))
    .then((rows: Array<{ status: string }>) => rows.map((r) => r.status))
  const audit = (id: string) => bypass(() => prisma.auditLog.findMany({ where: { entityType: "contract", entityId: id }, orderBy: { createdAt: "asc" } }))

  async function postTermination(id: string, fields: Record<string, string>, file?: { name: string; type: string; bytes: Buffer }) {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.set(k, v)
    if (file) form.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }))
    const res = await terminate.POST(new NextRequest(url(id, "terminate"), { method: "POST", body: form }), ctx(id))
    return { status: res.status, body: await res.json() }
  }
  async function json(route: { POST: (req: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response> }, id: string, tail: string, body?: unknown) {
    const res = await route.POST(new NextRequest(url(id, tail), {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    }), ctx(id))
    return { status: res.status, body: await res.json() }
  }

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'contract-closing-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    sql(scratch!.adminDb, RLS_TABLES.map(tenantPolicy).join("\n"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    terminate = await import("@/app/api/v1/contracts/[id]/terminate/route")
    cancel = await import("@/app/api/v1/contracts/[id]/cancel/route")
    reopen = await import("@/app/api/v1/contracts/[id]/reopen/route")
    submit = await import("@/app/api/v1/contracts/[id]/submit-for-approval/route")
    detail = await import("@/app/api/v1/contracts/[id]/route")
    scheduled = await import("@/lib/contract-lifecycle/terminate-scheduled")
    uploadsDir = (await import("@/lib/runtime-paths")).runtimePublicUploadDirectory("contracts")
    const { upsertRenewalAlerts } = await import("@/lib/contract-lifecycle/upsert-renewal-alerts")

    const end = new Date("2027-12-31T00:00:00Z")
    await bypass(async () => {
      for (const id of [ORG, OTHER]) await prisma.organization.create({ data: { id, name: `Tenant ${id}`, slug: id, modules: { crm: true, contracts: true } } })
      await prisma.user.create({ data: { id: ADMIN, organizationId: ORG, email: "admin@close.test", name: "Admin Adminov", passwordHash: "x", role: "admin" } })
      await prisma.user.create({ data: { id: MANAGER, organizationId: ORG, email: "manager@close.test", name: "Menecer Məmmədov", passwordHash: "x", role: "manager" } })
      for (const [id, status, org] of [
        [NOW_ACTIVE, "active", ORG], [LATER, "active", ORG], [IN_APPROVAL, "pending_approval", ORG],
        [REJECTED, "rejected", ORG], [DRAFT, "draft", ORG], [OTHERS, "active", OTHER],
      ] as const) {
        await prisma.contract.create({ data: { id, organizationId: org, contractNumber: id, title: `Contract ${id}`, status, endDate: end } })
      }
      for (const id of [NOW_ACTIVE, LATER]) await upsertRenewalAlerts(ORG, id, end)
      // NOW_ACTIVE is out for signing twice: the contract itself and its price protocol.
      await prisma.contractDocument.create({ data: { id: "doc-close-protocol", organizationId: ORG, contractId: NOW_ACTIVE, kind: "price_protocol", number: 1, status: "in_signing", documentDate: new Date(), signedBody: "frozen", contentHash: "hash" } })
      await prisma.esignEnvelope.create({ data: { id: "env-close-contract", organizationId: ORG, contractId: NOW_ACTIVE, subject: "Müqavilə", status: "sent", sentAt: new Date() } })
      await prisma.esignEnvelope.create({ data: { id: "env-close-protocol", organizationId: ORG, contractId: NOW_ACTIVE, documentId: "doc-close-protocol", subject: "Protokol", status: "sent", sentAt: new Date() } })
      await prisma.esignSigner.create({ data: { id: "signer-close", organizationId: ORG, envelopeId: "env-close-contract", fullName: "Müştəri", email: "c@example.test", order: 1, role: "signer", status: "sent", tokenHash: "live-link" } })
      // IN_APPROVAL waits on two levels; REJECTED's round: one approved, one rejected, one skipped.
      for (const [order, status] of [[1, "approved"], [2, "pending"]] as const) {
        await prisma.contractApprovalStage.create({ data: { organizationId: ORG, contractId: IN_APPROVAL, order, label: `L${order}`, assigneeUserId: ADMIN, status } })
      }
      for (const [order, status] of [[1, "approved"], [2, "rejected"], [3, "skipped"]] as const) {
        await prisma.contractApprovalStage.create({ data: { organizationId: ORG, contractId: REJECTED, order, label: `R${order}`, assigneeUserId: ADMIN, status } })
      }
    })
  }, 300_000)

  afterAll(async () => {
    browser.current = null
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch!.role}"`)
  }, 120_000)

  it("a termination today ends the contract at once, with who, why and the sealed agreement", async () => {
    as(MANAGER, "manager")
    const res = await postTermination(NOW_ACTIVE, { terminationDate: iso(todayUtc()), reason: "counterparty_initiative", note: "Müştəri bağlanır" },
      { name: "Xitam.png", type: "image/png", bytes: PNG })
    expect(res).toMatchObject({ status: 200, body: { data: { status: "terminated", scheduled: false } } })
    expect(await read(NOW_ACTIVE)).toMatchObject({
      status: "terminated", terminationDate: todayUtc(), terminationReason: "counterparty_initiative", closeNote: "Müştəri bağlanır", closedBy: MANAGER,
    })
    const files = await bypass(() => prisma.contractFile.findMany({ where: { contractId: NOW_ACTIVE } }))
    expect(files.map((f: { purpose: string }) => f.purpose)).toEqual(["termination_copy"])
    const stored = readFileSync(path.join(uploadsDir, files[0].fileName))
    const { decodeTenantFileBytes } = await import("@/lib/crypto/tenant-file-encryption")
    expect(stored.equals(PNG)).toBe(false)
    expect(decodeTenantFileBytes(ORG, stored).equals(PNG)).toBe(true)
  })

  it("…its reminders stop, every invitation to sign dies, the protocol is a draft again, one audit row", async () => {
    expect(await alerts(NOW_ACTIVE)).toEqual(["superseded", "superseded", "superseded", "superseded", "superseded"])
    const envelopes = await bypass(() => prisma.esignEnvelope.findMany({ where: { contractId: NOW_ACTIVE }, orderBy: { id: "asc" }, select: { id: true, status: true, voidReason: true } }))
    expect(envelopes).toEqual([
      { id: "env-close-contract", status: "voided", voidReason: "contract_terminated" },
      { id: "env-close-protocol", status: "voided", voidReason: "contract_terminated" },
    ])
    expect((await bypass(() => prisma.esignSigner.findUniqueOrThrow({ where: { id: "signer-close" } }))).tokenHash).toBeNull()
    expect(await bypass(() => prisma.contractDocument.findUniqueOrThrow({ where: { id: "doc-close-protocol" }, select: { status: true, signedBody: true } })))
      .toEqual({ status: "draft", signedBody: null })
    const rows = await audit(NOW_ACTIVE)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: MANAGER,
      oldValue: { status: { old: "active", new: "terminated" } },
      newValue: { status: "terminated", reason: "terminated", terminationReason: "counterparty_initiative", voidedEnvelopes: 2, supersededRenewalAlerts: 5 },
    })
  })

  it("the card reads who ended it and opens the agreement; a terminated contract is not terminated again", async () => {
    as(ADMIN, "admin")
    const data = (await (await detail.GET(new NextRequest(url(NOW_ACTIVE, "")), ctx(NOW_ACTIVE))).json()).data
    expect(data.closing).toMatchObject({ recordedBy: "Menecer Məmmədov", file: { originalName: "Xitam.png" } })
    expect(await postTermination(NOW_ACTIVE, { terminationDate: iso(todayUtc()), reason: "other" })).toMatchObject({ status: 409, body: { code: "NOT_TERMINABLE" } })
  })

  it("a termination from a later day keeps the contract in force, and can be withdrawn", async () => {
    as(MANAGER, "manager")
    expect(await postTermination(LATER, { terminationDate: "2028-01-02", reason: "other" })).toMatchObject({ status: 400, body: { code: "AFTER_END_DATE" } })
    expect(await postTermination(LATER, { terminationDate: iso(later), reason: "why-not" })).toMatchObject({ status: 400, body: { code: "REASON_REQUIRED" } })
    const res = await postTermination(LATER, { terminationDate: iso(later), reason: "mutual_agreement" })
    expect(res).toMatchObject({ status: 200, body: { data: { status: "active", scheduled: true } } })
    expect(await read(LATER)).toMatchObject({ status: "active", terminationDate: later, terminationReason: "mutual_agreement", closedBy: MANAGER })
    expect(await alerts(LATER)).toEqual(["superseded", "superseded", "superseded", "superseded", "superseded"])
    expect(await postTermination(LATER, { terminationDate: iso(later), reason: "other" })).toMatchObject({ status: 409, body: { code: "ALREADY_SCHEDULED" } })

    const withdrawn = await terminate.DELETE(new NextRequest(url(LATER, "terminate"), { method: "DELETE" }), ctx(LATER))
    expect(withdrawn.status).toBe(200)
    expect(await read(LATER)).toMatchObject({ status: "active", terminationDate: null, terminationReason: null, closedBy: null })
    expect(await alerts(LATER)).toEqual(["pending", "pending", "pending", "pending", "pending"])
    expect((await audit(LATER)).map((r: { newValue: { reason: string } }) => r.newValue.reason)).toEqual(["termination_scheduled", "termination_withdrawn"])
  })

  it("on that day, and not before, the scheduled pass makes it «Расторгнут» — as the system", async () => {
    as(MANAGER, "manager")
    expect((await postTermination(LATER, { terminationDate: iso(later), reason: "breach" })).status).toBe(200)
    const pass = (at: Date) => bypass(() => scheduled.terminateScheduledContracts(ORG, at))
    expect(await pass(new Date(later.getTime() - 60_000))).toBe(0)
    expect((await read(LATER)).status).toBe("active")
    expect(await pass(new Date(later.getTime() + 5 * 60_000))).toBe(1)
    expect((await read(LATER)).status).toBe("terminated")
    expect(await pass(new Date(later.getTime() + 6 * 3_600_000))).toBe(0)
    const last = (await audit(LATER)).at(-1)
    expect(last).toMatchObject({ userId: null, newValue: { status: "terminated", reason: "termination_date_reached", terminationReason: "breach" } })
    const withdrawn = await terminate.DELETE(new NextRequest(url(LATER, "terminate"), { method: "DELETE" }), ctx(LATER))
    expect(withdrawn.status).toBe(409)
  })

  it("a contract that never took effect is cancelled with a reason; the chain still waiting is superseded", async () => {
    as(MANAGER, "manager")
    expect(await json(cancel, IN_APPROVAL, "cancel", { reason: " " })).toMatchObject({ status: 400, body: { code: "REASON_REQUIRED" } })
    expect(await json(cancel, IN_APPROVAL, "cancel", { reason: "Müştəri imtina etdi" })).toMatchObject({ status: 200, body: { data: { status: "cancelled" } } })
    expect(await read(IN_APPROVAL)).toMatchObject({ status: "cancelled", closeNote: "Müştəri imtina etdi", closedBy: MANAGER, currentApprovalStage: null })
    const stages = await bypass(() => prisma.contractApprovalStage.findMany({ where: { contractId: IN_APPROVAL }, orderBy: { order: "asc" }, select: { status: true } }))
    expect(stages.map((s: { status: string }) => s.status)).toEqual(["approved", "superseded"])
    expect(await json(cancel, NOW_ACTIVE, "cancel", { reason: "x" })).toMatchObject({ status: 409, body: { code: "NOT_CANCELLABLE" } })
    expect(await json(cancel, DRAFT, "cancel", { reason: "Dublikat" })).toMatchObject({ status: 200 })
  })

  it("a rejected contract goes back to draft, its old round superseded, and starts a clean chain", async () => {
    as(MANAGER, "manager")
    expect(await json(reopen, DRAFT, "reopen")).toMatchObject({ status: 409, body: { code: "NOT_REJECTED" } })
    expect(await json(reopen, REJECTED, "reopen")).toMatchObject({ status: 200, body: { data: { status: "draft" } } })
    expect((await read(REJECTED)).status).toBe("draft")
    const old = await bypass(() => prisma.contractApprovalStage.findMany({ where: { contractId: REJECTED }, select: { status: true } }))
    expect(old.map((s: { status: string }) => s.status)).toEqual(["superseded", "superseded", "superseded"])

    const sent = await json(submit, REJECTED, "submit-for-approval", { stages: [{ label: "Hüquq", approvers: [{ assigneeUserId: ADMIN }] }] })
    expect(sent.status).toBe(200)
    expect((await read(REJECTED)).status).toBe("pending_approval")
    const chain = await bypass(() => prisma.contractApprovalStage.findMany({ where: { contractId: REJECTED, status: { not: "superseded" } }, select: { order: true, status: true, label: true } }))
    expect(chain).toEqual([{ order: 1, status: "pending", label: "Hüquq" }])
    expect((await audit(REJECTED))[0]).toMatchObject({ userId: MANAGER, newValue: { status: "draft", reason: "reopened_after_rejection", supersededStages: 3 } })
  })

  it("another organization's contract is not there at all", async () => {
    as(ADMIN, "admin")
    expect((await postTermination(OTHERS, { terminationDate: iso(todayUtc()), reason: "other" })).status).toBe(404)
    expect((await json(cancel, OTHERS, "cancel", { reason: "x" })).status).toBe(404)
    expect((await bypass(() => prisma.contract.findUniqueOrThrow({ where: { id: OTHERS }, select: { status: true } }))).status).toBe("active")
    expect(existsSync(uploadsDir)).toBe(true)
  })
})
