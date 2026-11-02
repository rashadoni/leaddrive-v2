/**
 * Per-organization data keys (PII encryption stage 2b, owner 2026-10-22) on a
 * real Postgres, connected as an application role without BYPASSRLS, with the
 * table built by its own migration:
 *
 *   - an organization's first tenant entry creates its key — wrapped, version
 *     1 — and every later load in any process returns that same key;
 *   - processes racing to create the first key end with one row, one key;
 *   - `tenant_data_keys` is under FORCE RLS: another tenant and a query
 *     without context see none of it, and cannot write a row for it;
 *   - the sweep cron's dry run writes nothing (not even a key), and `apply=1`
 *     moves v1 values and "t1" files to the data key without changing what
 *     they hold, leaving plaintext and `updatedAt` alone;
 *   - deleting an organization's key rows makes its v2 data unreadable.
 * A mocked Prisma cannot show any of this: it is RLS, a unique index and
 * rows that are or are not there.
 *
 * Set TENANT_DATA_KEYS_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   TENANT_DATA_KEYS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Tenant data keys database gate»), where
 * `TENANT_DATA_KEYS_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.TENANT_DATA_KEYS_TEST_DATABASE_URL
if (!adminUrl && process.env.TENANT_DATA_KEYS_DB_GATE === "required") {
  throw new Error("TENANT_DATA_KEYS_TEST_DATABASE_URL is required by the tenant data keys database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.TENANT_DATA_KEYS_TEST_DATABASE_URL
  if (!admin) return null
  const name = `tenant_data_keys_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "data-key-fixture-only"
  // `@/lib/prisma` builds its client from DATABASE_URL on first import (dynamic, below).
  process.env.DATABASE_URL = app.toString()
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  process.env.CRON_SECRET = "data-key-cron-secret"
  return { name, role, adminDb: db.toString() }
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const MIGRATION = path.join(ROOT, "prisma/migrations/20261030100000_tenant_data_keys/migration.sql")

const ORG = "org-data-keys"
const OTHER = "org-data-keys-other"
const RACE = "org-data-keys-race"
const SWEEP = "org-data-keys-sweep"

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

/** The schema as `db push` can build it on any Postgres (no pgvector columns). */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "tenant-data-keys-schema-")), "schema.prisma")
  writeFileSync(file, schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
  return file
}

;(scratch ? describe : describe.skip)("per-organization data keys on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let pii!: typeof import("@/lib/crypto/tenant-pii-encryption")
  let cache!: typeof import("@/lib/crypto/tenant-data-key-cache")
  let keys!: typeof import("@/lib/crypto/tenant-data-keys")
  let files!: typeof import("@/lib/crypto/tenant-file-encryption")
  let cron!: typeof import("@/app/api/cron/tenant-data-key-reencrypt/route")
  let createdDb = false
  let createdRole = false
  let runtimeDir = ""
  let logDir = ""

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'data-key-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    // The table as production gets it: from its migration, with RLS.
    sql(scratch!.adminDb, `DROP TABLE "tenant_data_keys";\n${readFileSync(MIGRATION, "utf8")}`)
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    // The real external-runtime guard rejects /tmp, as it should in production.
    runtimeDir = mkdtempSync(path.join(homedir(), ".tenant-data-keys-runtime-test-"))
    process.env.LEADDRIVE_RUNTIME_DIR = runtimeDir
    logDir = mkdtempSync(path.join(homedir(), ".tenant-data-keys-logs-test-"))
    process.env.LEADDRIVE_LOG_DIR = logDir

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    pii = await import("@/lib/crypto/tenant-pii-encryption")
    cache = await import("@/lib/crypto/tenant-data-key-cache")
    keys = await import("@/lib/crypto/tenant-data-keys")
    files = await import("@/lib/crypto/tenant-file-encryption")
    cron = await import("@/app/api/cron/tenant-data-key-reencrypt/route")

    await rls.runWithRlsBypass(async () => {
      for (const id of [ORG, OTHER, RACE, SWEEP]) {
        await prisma.organization.create({ data: { id, name: id, slug: id } })
      }
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    for (const directory of [runtimeDir, logDir]) if (directory) rmSync(directory, { recursive: true, force: true })
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
  }, 60_000)

  type KeyRow = { organizationId: string; version: number; wrappedKey: string; masterKeyId: string; retiredAt: Date | null }
  const keyRows = (orgId: string): Promise<KeyRow[]> => rls.runWithRlsBypass(() => prisma.tenantDataKey.findMany({
    where: { organizationId: orgId },
    orderBy: { version: "asc" },
  }))

  /** A fresh process: nothing in memory. */
  function newProcess() {
    cache.forgetTenantDataKeyRings()
    keys.resetTenantDataKeyLoadState()
  }

  it("creates the organization's first key on its first tenant entry, and every later load returns it", async () => {
    newProcess()
    expect(await keyRows(ORG)).toEqual([])
    const written = await rls.runWithTenant(ORG, () => pii.encryptForTenantBound(ORG, "citizens", "fullName", "Aysel Məmmədova"))
    expect(written).toMatch(/^v2:1:/)

    const [row, ...more] = await keyRows(ORG)
    expect(more).toEqual([])
    expect(row).toMatchObject({ version: 1, masterKeyId: pii.tenantMasterKeyId(), retiredAt: null })
    expect(row.wrappedKey).toHaveLength(80)

    newProcess()
    const read = await rls.runWithTenant(ORG, () => pii.decryptForTenantBound(ORG, "citizens", "fullName", written))
    expect(read).toBe("Aysel Məmmədova")
    expect(await keyRows(ORG)).toHaveLength(1)
  })

  it("ends a race for the first key with one row and one key", async () => {
    newProcess()
    const loads = (globalThis as unknown as { __tenantDataKeyLoads: Map<string, unknown> }).__tenantDataKeyLoads
    // Eight "processes": each starts its own load (the in-process dedupe is cleared between them).
    const racing = Array.from({ length: 8 }, () => {
      const load = keys.ensureTenantDataKeys(RACE)
      loads.delete(RACE)
      cache.forgetTenantDataKeyRings(RACE)
      return load.then(() => pii.encryptForTenant(RACE, "same key for all"))
    })
    const values = await Promise.all(racing)
    expect(await keyRows(RACE)).toHaveLength(1)

    newProcess()
    await keys.ensureTenantDataKeys(RACE)
    for (const value of values) {
      expect(value).toMatch(/^v2:1:/)
      expect(pii.decryptForTenant(RACE, value)).toBe("same key for all")
    }

    await expect(rls.runWithRlsBypass(() => prisma.tenantDataKey.create({
      data: { organizationId: RACE, version: 1, wrappedKey: "A".repeat(80), masterKeyId: "m-duplicate" },
    }))).rejects.toThrow()
  })

  it("keeps the table under FORCE RLS with the standard tenant policy", async () => {
    await keys.ensureTenantDataKeys(OTHER)
    const [table] = await rls.runWithRlsBypass(() => prisma.$queryRaw<Array<{ enabled: boolean; forced: boolean }>>`
      SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'tenant_data_keys'`)
    expect(table).toEqual({ enabled: true, forced: true })
    const policies = await rls.runWithRlsBypass(() => prisma.$queryRaw<Array<{ policyname: string }>>`
      SELECT policyname FROM pg_policies WHERE tablename = 'tenant_data_keys'`)
    expect(policies.map((policy: { policyname: string }) => policy.policyname)).toEqual(["tenant_isolation"])

    await rls.runWithTenant(OTHER, async () => {
      const seen: KeyRow[] = await prisma.tenantDataKey.findMany()
      expect(seen.map((row) => row.organizationId)).toEqual([OTHER])
      await expect(prisma.tenantDataKey.create({
        data: { organizationId: ORG, version: 7, wrappedKey: "A".repeat(80), masterKeyId: "m-foreign" },
      })).rejects.toThrow()
    })
    // No context at all: the database answers nothing.
    expect(await prisma.$queryRaw`SELECT id FROM tenant_data_keys`).toEqual([])
    expect((await keyRows(ORG)).map((row) => row.version)).toEqual([1])
  })

  async function sweep(query: string) {
    const response = await cron.POST(new NextRequest(`http://localhost/api/cron/tenant-data-key-reencrypt${query}`, {
      method: "POST",
      headers: { "x-cron-secret": "data-key-cron-secret" },
    }))
    expect(response.status).toBe(200)
    return (await response.json()).data
  }

  it("sweeps v1 values and t1 files to the data key without changing what they hold", async () => {
    newProcess()
    // Written before this release: v1 values, a t1 envelope, and a legacy plaintext row.
    const name = pii.encryptForTenantBound(SWEEP, "media_subscribers", "displayName", "Nigar Əliyeva")
    const creds = pii.encryptForTenant(SWEEP, JSON.stringify({ integrationKey: "fixture" }))
    expect(pii.ciphertextVersion(name)).toBe(1)
    const at = new Date("2026-01-02T03:04:05.000Z")
    await rls.runWithRlsBypass(async () => {
      await prisma.mediaSubscriber.create({ data: { id: "sub-v1", organizationId: SWEEP, subscriberNumber: "S-1", displayName: name, updatedAt: at } })
      await prisma.mediaSubscriber.create({ data: { id: "sub-plain", organizationId: SWEEP, subscriberNumber: "S-2", displayName: "Plain Name", updatedAt: at } })
      await prisma.esignProviderConfig.create({ data: { id: "esign-v1", organizationId: SWEEP, provider: "docusign", config: creds } })
    })
    const pdf = Buffer.from("%PDF-1.7 signed contract")
    const inbox = path.join(runtimeDir, "uploads", "inbox", SWEEP)
    mkdirSync(inbox, { recursive: true })
    const filePath = path.join(inbox, "contract.pdf")
    writeFileSync(filePath, files.sealTenantFile(SWEEP, pdf))
    expect(files.tenantFileKeyId(readFileSync(filePath))).toBe("t1")

    const dry = await sweep("")
    expect(dry.dryRun).toBe(true)
    expect(dry.remainingOnDerivedKey[SWEEP]).toEqual({ columns: 2, appendOnlyColumns: 0, files: 1 })
    expect(await keyRows(SWEEP)).toEqual([])
    expect(files.tenantFileKeyId(readFileSync(filePath))).toBe("t1")

    const applied = await sweep("?apply=1&limit=50")
    expect(applied.columns).toMatchObject({ rewritten: 2, undecryptable: 0, keyUnavailable: 0, changedMeanwhile: 0 })
    expect(applied.files).toMatchObject({ rekeyed: 1, failed: 0 })
    expect(applied.remainingOnDerivedKey[SWEEP]).toBeUndefined()
    expect(applied.hasMore).toBe(false)

    newProcess()
    const rows: Array<{ id: string; displayName: string; updatedAt: Date }> = await rls.runWithTenant(SWEEP, () => prisma.mediaSubscriber.findMany({
      where: { organizationId: SWEEP }, orderBy: { id: "asc" }, select: { id: true, displayName: true, updatedAt: true },
    }))
    expect(rows.map((row) => row.id)).toEqual(["sub-plain", "sub-v1"])
    expect(rows[0].displayName).toBe("Plain Name")
    expect(rows[1].displayName).toMatch(/^v2:1:/)
    expect(rows.map((row) => row.updatedAt.toISOString())).toEqual([at.toISOString(), at.toISOString()])
    expect(pii.softDecryptForTenantBound(SWEEP, "media_subscribers", "displayName", rows[1].displayName)).toBe("Nigar Əliyeva")
    const config: { config: string } = await rls.runWithTenant(SWEEP, () => prisma.esignProviderConfig.findUniqueOrThrow({ where: { id: "esign-v1" }, select: { config: true } }))
    expect(JSON.parse(pii.decryptForTenant(SWEEP, config.config))).toEqual({ integrationKey: "fixture" })

    newProcess()
    const stored = readFileSync(filePath)
    expect(files.tenantFileKeyId(stored)).toBe("d1")
    expect(await files.openTenantFileBytes(SWEEP, stored)).toEqual(pdf)

    // Nothing left: a second run finds nothing to do.
    const again = await sweep("?apply=1")
    expect(again.columns.rewritten).toBe(0)
    expect(again.files.rekeyed).toBe(0)
  })

  it("makes v2 data unreadable once the organization's key rows are gone", async () => {
    newProcess()
    const value = await rls.runWithTenant(OTHER, () => pii.encryptForTenant(OTHER, "to be shredded"))
    expect(value).toMatch(/^v2:1:/)
    await rls.runWithRlsBypass(() => prisma.tenantDataKey.deleteMany({ where: { organizationId: OTHER } }))
    newProcess()
    await keys.ensureTenantDataKeys(OTHER) // a new key; the deleted one is gone for good
    expect(() => pii.decryptForTenant(OTHER, value)).toThrow()
  })
})
