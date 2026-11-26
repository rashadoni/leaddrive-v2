/**
 * «Подписан на бумаге» on a real Postgres, connected as an application role without BYPASSRLS, the
 * tables under the standard tenant policy — the real routes, only the browser session stubbed.
 *
 * Until 2026-11-26 only our own e-signature made a contract «Активный». A contract signed on paper —
 * most of them in Azerbaijan — stayed «Согласован» or «Черновик» for good, and its renewal
 * reminders, its «Истёк» and the live-value analytics never saw it (they read contracts in force).
 *
 *  - An approved contract is recorded by anyone who edits contracts: the status, the day on paper,
 *    who recorded it; the scan sealed with the organization's key as a "signed_copy" file; an e-sign
 *    invitation still out is voided and its links die; one audit row; the renewal reminders.
 *  - A draft — signed before it reached the CRM — skips approval, so only an administrator; a
 *    manager is refused and nothing is written, not even the file on disk.
 *  - Nothing in approval, in force, or in another organization moves; a bad day or a file that is
 *    not what it says leaves nothing behind; the scan cannot be deleted from the files list.
 *
 * Set CONTRACT_PAPER_SIGNATURE_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   CONTRACT_PAPER_SIGNATURE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the deploy («Contract paper
 * signature database gate»), where `CONTRACT_PAPER_SIGNATURE_DB_GATE=required` turns a missing URL
 * into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.CONTRACT_PAPER_SIGNATURE_TEST_DATABASE_URL
if (!adminUrl && process.env.CONTRACT_PAPER_SIGNATURE_DB_GATE === "required") {
  throw new Error("CONTRACT_PAPER_SIGNATURE_TEST_DATABASE_URL is required by the contract paper signature database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.CONTRACT_PAPER_SIGNATURE_TEST_DATABASE_URL
  if (!admin) return null
  const name = `paper_sign_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "paper-signature-fixture-only"
  process.env.DATABASE_URL = app.toString()
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  return { name, role, adminDb: db.toString() }
})
// Uploads go to a scratch directory, never the checkout's. Only where they go is replaced: a real
// LEADDRIVE_RUNTIME_DIR under /tmp is refused by runtime-paths (an ephemeral path), and that is right.
vi.mock("@/lib/runtime-paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runtime-paths")>()
  const nodePath = await import("node:path")
  return { ...actual, runtimePublicUploadDirectory: (subdir: string) => nodePath.join(process.env.PAPER_SIGN_UPLOAD_ROOT!, subdir) }
})
if (scratch) process.env.PAPER_SIGN_UPLOAD_ROOT = mkdtempSync(path.join(tmpdir(), "paper-sign-uploads-"))

/** The browser session the routes see. */
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
    // The module switch is not what this file is about; «Договоры» is on.
    orgHasModule: vi.fn(async () => true),
    moduleDisabledResponse: vi.fn(() => NextResponse.json({ error: "Forbidden" }, { status: 403 })),
  }
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const RLS_TABLES = ["contracts", "contract_files", "esign_envelopes", "esign_signers", "esign_audit_events", "contract_renewal_alerts", "audit_logs"]

const ORG = "org-paper"
const OTHER = "org-paper-other"
const ADMIN = "user-paper-admin"
const MANAGER = "user-paper-manager"
const APPROVED = "ctr-paper-approved" // approved, an e-sign invitation still out
const DRAFT = "ctr-paper-draft" // signed before the CRM
const IN_APPROVAL = "ctr-paper-pending"
const APPROVED_2 = "ctr-paper-approved-2" // approved, for the refusals that come before any write
const OTHERS = "ctr-paper-other-org"
const ENVELOPE = "env-paper-out"
const SIGNER = "signer-paper-out"
const PDF = Buffer.from("%PDF-1.4\n% a scan of the signed contract\n%%EOF\n")

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "paper-sign-schema-")), "schema.prisma")
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

;(scratch ? describe : describe.skip)("«Подписан на бумаге» on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let paper!: typeof import("@/app/api/v1/contracts/[id]/paper-signature/route")
  let detail!: typeof import("@/app/api/v1/contracts/[id]/route")
  let fileRoute!: typeof import("@/app/api/v1/contracts/[id]/files/[fileId]/route")
  let uploadsDir = ""
  let createdDb = false
  let createdRole = false

  const as = (userId: string, role: string, orgId = ORG) => {
    browser.current = { orgId, userId, role, email: `${userId}@example.test`, name: userId === ADMIN ? "Admin Adminov" : "Menecer Məmmədov", principalType: "session" }
  }
  // The exported prisma is untyped (CLAUDE.md, «Память тайпчека»), so are the rows it reads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bypass = (fn: () => Promise<unknown>): Promise<any> => rls.runWithRlsBypass(fn) as Promise<any>
  const idCtx = (id: string) => ({ params: Promise.resolve({ id }) })
  const storedFiles = () => (existsSync(uploadsDir) ? readdirSync(uploadsDir).sort() : [])

  async function record(contractId: string, signedAt: string, file?: { name: string; type: string; bytes: Buffer }) {
    const form = new FormData()
    form.set("signedAt", signedAt)
    if (file) form.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }))
    const res = await paper.POST(
      new NextRequest(`http://localhost:3000/api/v1/contracts/${contractId}/paper-signature`, { method: "POST", body: form, headers: { "user-agent": "vitest" } }),
      idCtx(contractId),
    )
    return { status: res.status, body: await res.json() }
  }
  const contract = (id: string) => bypass(() => prisma.contract.findUniqueOrThrow({
    where: { id }, select: { status: true, signedAt: true, signedBy: true },
  }))

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'paper-signature-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    sql(scratch!.adminDb, RLS_TABLES.map(tenantPolicy).join("\n"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    paper = await import("@/app/api/v1/contracts/[id]/paper-signature/route")
    detail = await import("@/app/api/v1/contracts/[id]/route")
    fileRoute = await import("@/app/api/v1/contracts/[id]/files/[fileId]/route")
    uploadsDir = (await import("@/lib/runtime-paths")).runtimePublicUploadDirectory("contracts")

    await bypass(async () => {
      for (const id of [ORG, OTHER]) {
        await prisma.organization.create({ data: { id, name: `Tenant ${id}`, slug: id, modules: { crm: true, contracts: true } } })
      }
      await prisma.user.create({ data: { id: ADMIN, organizationId: ORG, email: "admin@paper.test", name: "Admin Adminov", passwordHash: "x", role: "admin" } })
      await prisma.user.create({ data: { id: MANAGER, organizationId: ORG, email: "manager@paper.test", name: "Menecer Məmmədov", passwordHash: "x", role: "manager" } })
      const end = new Date("2027-12-31T00:00:00Z")
      await prisma.contract.create({ data: { id: APPROVED, organizationId: ORG, contractNumber: "P-1", title: "Avadanlıq tədarükü", status: "approved", endDate: end } })
      await prisma.contract.create({ data: { id: DRAFT, organizationId: ORG, contractNumber: "P-2", title: "2024-cü il müqaviləsi", status: "draft", endDate: end } })
      await prisma.contract.create({ data: { id: IN_APPROVAL, organizationId: ORG, contractNumber: "P-3", title: "Razılaşmada", status: "pending_approval" } })
      await prisma.contract.create({ data: { id: APPROVED_2, organizationId: ORG, contractNumber: "P-4", title: "Təsdiqlənib", status: "approved" } })
      await prisma.contract.create({ data: { id: OTHERS, organizationId: OTHER, contractNumber: "O-1", title: "Başqa təşkilat", status: "approved" } })
      await prisma.esignEnvelope.create({ data: { id: ENVELOPE, organizationId: ORG, contractId: APPROVED, subject: "İmzalayın", status: "sent", sentAt: new Date() } })
      await prisma.esignSigner.create({ data: { id: SIGNER, organizationId: ORG, envelopeId: ENVELOPE, fullName: "Müştəri", email: "client@example.test", order: 1, role: "signer", status: "sent", tokenHash: "hash-of-a-live-link" } })
    })
  }, 300_000)

  afterAll(async () => {
    browser.current = null
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch!.role}"`)
  }, 120_000)

  it("a manager records an approved contract: «Активный», the day on paper, who recorded it", async () => {
    as(MANAGER, "manager")
    const res = await record(APPROVED, "2026-11-20", { name: "Müqavilə.pdf", type: "application/pdf", bytes: PDF })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: "active", signedAt: "2026-11-20", file: { originalName: "Müqavilə.pdf", mimeType: "application/pdf" } })
    expect(await contract(APPROVED)).toEqual({ status: "active", signedAt: new Date("2026-11-20T00:00:00Z"), signedBy: `paper:${MANAGER}` })
  })

  it("the scan is a signed copy, sealed with the organization's key on disk", async () => {
    const files = await bypass(() => prisma.contractFile.findMany({ where: { contractId: APPROVED } }))
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ organizationId: ORG, purpose: "signed_copy", uploadedBy: MANAGER, mimeType: "application/pdf", fileSize: PDF.byteLength })
    const stored = readFileSync(path.join(uploadsDir, files[0].fileName))
    expect(stored.equals(PDF)).toBe(false)
    const { decodeTenantFileBytes } = await import("@/lib/crypto/tenant-file-encryption")
    expect(decodeTenantFileBytes(ORG, stored).equals(PDF)).toBe(true)
    expect(() => decodeTenantFileBytes(OTHER, stored)).toThrow()
  })

  it("the e-sign invitation still out is voided and its link dies, and the e-sign trail says why", async () => {
    const envelope = await bypass(() => prisma.esignEnvelope.findUniqueOrThrow({ where: { id: ENVELOPE } }))
    expect(envelope).toMatchObject({ status: "voided", voidedBy: MANAGER, voidReason: "signed_on_paper" })
    const signer = await bypass(() => prisma.esignSigner.findUniqueOrThrow({ where: { id: SIGNER } }))
    expect(signer.tokenHash).toBeNull()
    const events = await bypass(() => prisma.esignAuditEvent.findMany({ where: { envelopeId: ENVELOPE } }))
    expect(events.map((e: { eventType: string; actorId: string | null }) => [e.eventType, e.actorId])).toEqual([["envelope_voided", MANAGER]])
  })

  it("one audit row says who, from what, the day and the file; the reminders are scheduled", async () => {
    const rows = await bypass(() => prisma.auditLog.findMany({ where: { entityType: "contract", entityId: APPROVED } }))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      organizationId: ORG,
      userId: MANAGER,
      action: "update",
      oldValue: { status: { old: "approved", new: "active" } },
      newValue: { status: "active", reason: "signed_on_paper", signedAt: "2026-11-20", voidedEnvelopes: 1 },
    })
    const alerts = await bypass(() => prisma.contractRenewalAlert.findMany({ where: { contractId: APPROVED }, orderBy: { daysBeforeExpiry: "desc" } }))
    expect(alerts.map((a: { daysBeforeExpiry: number; status: string }) => [a.daysBeforeExpiry, a.status])).toEqual([
      [90, "pending"], [60, "pending"], [30, "pending"], [14, "pending"], [7, "pending"],
    ])
  })

  it("the card reads who recorded it and the scan", async () => {
    as(ADMIN, "admin")
    const res = await detail.GET(new NextRequest(`http://localhost:3000/api/v1/contracts/${APPROVED}`), idCtx(APPROVED))
    const data = (await res.json()).data
    expect(data.paperSignature).toMatchObject({ recordedBy: "Menecer Məmmədov", file: { originalName: "Müqavilə.pdf", mimeType: "application/pdf" } })
    expect(new Date(data.paperSignature.signedAt).toISOString()).toBe("2026-11-20T00:00:00.000Z")
  })

  it("the scan cannot be deleted from the contract's files", async () => {
    as(ADMIN, "admin")
    const scan = await bypass(() => prisma.contractFile.findFirstOrThrow({ where: { contractId: APPROVED } }))
    const res = await fileRoute.DELETE(
      new NextRequest(`http://localhost:3000/api/v1/contracts/${APPROVED}/files/${scan.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: APPROVED, fileId: scan.id }) },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("SIGNED_COPY_LOCKED")
    expect(await bypass(() => prisma.contractFile.count({ where: { id: scan.id } }))).toBe(1)
    expect(existsSync(path.join(uploadsDir, scan.fileName))).toBe(true)
  })

  it("a contract in force is not recorded twice", async () => {
    const before = storedFiles()
    as(ADMIN, "admin")
    const res = await record(APPROVED, "2026-11-21", { name: "again.pdf", type: "application/pdf", bytes: PDF })
    expect(res).toMatchObject({ status: 409, body: { code: "NOT_SIGNABLE" } })
    expect(storedFiles()).toEqual(before)
    expect((await contract(APPROVED)).signedAt).toEqual(new Date("2026-11-20T00:00:00Z"))
  })

  it("a draft skips approval, so a manager is refused and nothing is written", async () => {
    const before = storedFiles()
    as(MANAGER, "manager")
    const res = await record(DRAFT, "2024-03-01", { name: "old.pdf", type: "application/pdf", bytes: PDF })
    expect(res).toMatchObject({ status: 403, body: { code: "ADMIN_REQUIRED_FOR_DRAFT" } })
    expect(await contract(DRAFT)).toMatchObject({ status: "draft", signedAt: null, signedBy: null })
    expect(await bypass(() => prisma.contractFile.count({ where: { contractId: DRAFT } }))).toBe(0)
    expect(storedFiles()).toEqual(before)
  })

  it("an administrator records a contract signed before the CRM", async () => {
    as(ADMIN, "admin")
    const res = await record(DRAFT, "2024-03-01", { name: "2024.png", type: "image/png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) })
    expect(res.status).toBe(200)
    expect(await contract(DRAFT)).toEqual({ status: "active", signedAt: new Date("2024-03-01T00:00:00Z"), signedBy: `paper:${ADMIN}` })
  })

  it("nothing in approval moves, and another organization's contract is not there at all", async () => {
    const before = storedFiles()
    as(ADMIN, "admin")
    expect(await record(IN_APPROVAL, "2026-11-20", { name: "a.pdf", type: "application/pdf", bytes: PDF })).toMatchObject({ status: 409, body: { code: "NOT_SIGNABLE" } })
    expect((await contract(IN_APPROVAL)).status).toBe("pending_approval")
    expect((await record(OTHERS, "2026-11-20", { name: "a.pdf", type: "application/pdf", bytes: PDF })).status).toBe(404)
    expect(await contract(OTHERS)).toEqual({ status: "approved", signedAt: null, signedBy: null })
    expect(storedFiles()).toEqual(before)
  })

  it("a day in the future, no scan, or a file that is not what it says leave nothing behind", async () => {
    const before = storedFiles()
    as(ADMIN, "admin")
    expect(await record(APPROVED_2, "2099-01-01", { name: "a.pdf", type: "application/pdf", bytes: PDF })).toMatchObject({ status: 400, body: { code: "SIGNED_AT_IN_FUTURE" } })
    expect(await record(APPROVED_2, "2026-11-20")).toMatchObject({ status: 400, body: { code: "FILE_REQUIRED" } })
    expect(await record(APPROVED_2, "2026-11-20", { name: "a.pdf", type: "application/pdf", bytes: Buffer.from("MZ not a pdf") })).toMatchObject({ status: 400, body: { code: "FILE_TYPE_NOT_ALLOWED" } })
    expect(await record(APPROVED_2, "2026-11-20", { name: "a.exe", type: "application/pdf", bytes: PDF })).toMatchObject({ status: 400, body: { code: "FILE_TYPE_NOT_ALLOWED" } })
    expect(await contract(APPROVED_2)).toEqual({ status: "approved", signedAt: null, signedBy: null })
    expect(await bypass(() => prisma.contractFile.count({ where: { contractId: APPROVED_2 } }))).toBe(0)
    expect(storedFiles()).toEqual(before)
  })
})
