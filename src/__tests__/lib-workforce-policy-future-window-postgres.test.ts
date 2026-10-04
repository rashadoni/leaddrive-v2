import { randomUUID, createHash } from "node:crypto"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { Prisma, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readWorkforcePolicyFutureWindow } from "@/lib/workforce/policy-future-window-read"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"

// Only the dedicated hosted browser fixture may opt in. No local/production SQL.
const enabled = process.env.WF_POLICY_WINDOW_POSTGRES === "1"
const postgresDescribe = enabled ? describe : describe.skip
const suffix = randomUUID(), orgs = [`window-a-${suffix}`, `window-b-${suffix}`]
const actor = `window-actor-${suffix}`, team = `window-team-${suffix}`
const beforeId = `window-before-${suffix}`, afterId = `window-after-${suffix}`, draftId = `window-draft-${suffix}`
const overflowDraft = `window-cap-draft-${suffix}`
const observedAt = new Date(), today = new Date(observedAt.toISOString().slice(0, 10) + "T00:00:00.000Z")
const day = (offset: number) => new Date(today.getTime() + offset * 86_400_000)
const key = (offset: number) => day(offset).toISOString().slice(0, 10)
const definition = { expectedWorkSeconds: 28800, lateGraceSeconds: 0, undertimeToleranceSeconds: 0,
  overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null, opaqueRule: { fixture: "not-returned" } }
const definitionHash = workforcePolicyDefinitionHash(definition)
let admin: PrismaClient, app: PrismaClient
const passed: string[] = []
function target(value: string | undefined, role: string) {
  if (!value) throw new Error("Window fixture database URL is required")
  const url = new URL(value)
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/workforce_manager_today_browser" || url.username !== role) throw new Error("Window PostgreSQL requires its exact disposable loopback role/database")
  return url
}
async function scoped<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, org: string | null = orgs[0]) {
  return app.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${org ?? ""}, true)`
    return fn(tx)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000, maxWait: 5_000 })
}
const read = (tx: Prisma.TransactionClient, policyId = draftId, organizationId = orgs[0]) =>
  readWorkforcePolicyFutureWindow(tx, { organizationId, policyId, observedAt })
async function contextAbsent() {
  const [setting] = await app.$queryRaw<Array<{ tenant: string | null; bypass: string | null }>>`
    SELECT current_setting('app.org_id',true) AS tenant,current_setting('app.rls_bypass',true) AS bypass`
  expect(setting.tenant === null || setting.tenant === "").toBe(true); expect(setting.bypass).not.toBe("on")
}

postgresDescribe("hosted real PostgreSQL recorded future-window read", () => {
  beforeAll(async () => {
    expect(process.env.GITHUB_ACTIONS).toBe("true"); expect(process.env.CI).toBe("true")
    expect(process.env.NODE_ENV).not.toBe("production")
    expect(process.env.WF_POLICY_VERSION_BROWSER_HEAD_SHA).toMatch(/^[a-f0-9]{40}$/)
    const ownerUrl = target(process.env.ADMIN_DATABASE_URL, "postgres"), appUrl = target(process.env.DATABASE_URL, "wf_manager_today_browser")
    const fence = target(process.env.EVENT_PLATFORM_TEST_DATABASE_URL, "postgres")
    expect(fence.href).toBe(ownerUrl.href)
    expect([appUrl.protocol, appUrl.host, appUrl.pathname, appUrl.search]).toEqual([ownerUrl.protocol, ownerUrl.host, ownerUrl.pathname, ownerUrl.search])
    appUrl.searchParams.set("connection_limit", "1")
    admin = new PrismaClient({ datasourceUrl: ownerUrl.toString() }); app = new PrismaClient({ datasourceUrl: appUrl.toString() })
    for (const [index, id] of orgs.entries()) {
      await admin.organization.create({ data: { id, name: "Window isolated fixture", slug: `window-${index}-${suffix}` } })
      await admin.mtmSetting.create({ data: { organizationId: id, key: "timezone", value: "UTC" } })
    }
    await admin.user.create({ data: { id: actor, organizationId: orgs[0], email: `window-${suffix}@example.test`, name: "Window fixture actor", role: "admin", passwordHash: randomUUID() } })
    await admin.mtmTeam.create({ data: { id: team, organizationId: orgs[0], name: "Window cap team", code: `window-${suffix}` } })
    const common = { organizationId: orgs[0], name: "Recorded window fixture", definition, definitionHash,
      provenance: "TENANT_ADMIN" as const, createdByUserId: actor }
    const active = { ...common, status: "ACTIVE" as const, activatedByUserId: actor, activatedAt: day(-2) }
    await admin.workforcePolicy.createMany({ data: [
      { ...active, id: beforeId, version: 1, effectiveFrom: day(-365), effectiveTo: day(29) },
      { ...active, id: afterId, version: 2, effectiveFrom: day(30) },
      { ...common, id: draftId, version: 3, status: "DRAFT", effectiveFrom: day(60) },
      ...Array.from({ length: 100 }, (_, n) => ({ ...active, id: `window-cap-${n}-${suffix}`, teamId: team,
        version: n + 1, effectiveFrom: day(-730 + n), effectiveTo: n === 99 ? null : day(-730 + n) })),
      { ...common, id: overflowDraft, teamId: team, version: 200, status: "DRAFT", effectiveFrom: day(60) },
    ] })
    // A populated foreign policy and setting make foreign/unscoped controls meaningful.
    await admin.workforcePolicy.create({ data: { organizationId: orgs[1], name: "Foreign recorded window", version: 1,
      status: "ACTIVE", effectiveFrom: day(-365), activatedAt: day(-2), definition, definitionHash,
      provenance: "SYSTEM_PROVISIONING", systemProfileVersion: "fixture-only" } })
  }, 30_000)

  it("keeps a coherent RR snapshot while another transaction replaces draft/window dates and timezone", async () => {
    let release!: () => void, reached!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve }), firstRead = new Promise<void>(resolve => { reached = resolve })
    const extended = app.$extends({ query: { workforcePolicy: { async findFirst({ args, query }) {
      const result = await query(args)
      if (args.where?.id === draftId) { reached(); await barrier }
      return result
    } } } })
    const pending = extended.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgs[0]}, true)`
      return read(tx)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 })
    // Observe either first read or the original failure; never hide a failed transaction behind a wait.
    try {
      await Promise.race([firstRead, pending.then(() => { throw new Error("Snapshot barrier was not reached") })])
      await admin.$transaction(async tx => {
        await tx.workforcePolicy.update({ where: { id: afterId }, data: { effectiveFrom: day(40) } })
        await tx.workforcePolicy.update({ where: { id: beforeId }, data: { effectiveTo: day(39) } })
        await tx.workforcePolicy.update({ where: { id: draftId }, data: { effectiveFrom: day(70) } })
        await tx.mtmSetting.update({ where: { organizationId_key: { organizationId: orgs[0], key: "timezone" } }, data: { value: "Asia/Baku" } })
      })
      release()
      const old = await pending
      expect(old?.draft.effectiveFrom).toBe(key(60)); expect(old?.predecessor?.effectiveFrom).toBe(key(30))
      expect(old?.recordedWindows[0].effectiveTo).toBe(key(29)); expect(old?.predecessor?.projectedEffectiveTo).toBe(key(59)); expect(old?.timezone).toBe("UTC")
      const fresh = await scoped(tx => read(tx))
      expect(fresh?.draft.effectiveFrom).toBe(key(70)); expect(fresh?.predecessor?.effectiveFrom).toBe(key(40))
      expect(fresh?.recordedWindows[0].effectiveTo).toBe(key(39)); expect(fresh?.predecessor?.projectedEffectiveTo).toBe(key(69)); expect(fresh?.timezone).toBe("Asia/Baku")
      await contextAbsent(); passed.push("coherent-repeatable-read-concurrent-owner-commit")
    } finally {
      release(); await pending.catch(() => undefined)
      await admin.$transaction(async tx => {
        await tx.workforcePolicy.update({ where: { id: beforeId }, data: { effectiveTo: day(29) } })
        await tx.workforcePolicy.update({ where: { id: afterId }, data: { effectiveFrom: day(30) } })
        await tx.workforcePolicy.update({ where: { id: draftId }, data: { effectiveFrom: day(60) } })
        await tx.mtmSetting.update({ where: { organizationId_key: { organizationId: orgs[0], key: "timezone" } }, data: { value: "UTC" } })
      })
    }
  }, 20_000)

  it("reads 100 complete published windows and fails closed at the actual 101st sentinel", async () => {
    expect((await scoped(tx => read(tx, overflowDraft)))?.recordedWindows).toHaveLength(100)
    const extraId = `window-cap-extra-${suffix}`
    try {
      await admin.$transaction(async tx => {
        await tx.workforcePolicy.update({ where: { id: `window-cap-99-${suffix}` }, data: { effectiveTo: day(-630) } })
        await tx.workforcePolicy.create({ data: { id: extraId, organizationId: orgs[0], teamId: team,
          version: 101, name: "Window sentinel", status: "ACTIVE", effectiveFrom: day(-629), definition, definitionHash,
          provenance: "TENANT_ADMIN", createdByUserId: actor, activatedByUserId: actor, activatedAt: day(-2) } })
      })
      await expect(scoped(tx => read(tx, overflowDraft))).rejects.toMatchObject({ code: "WORKFORCE_POLICY_WINDOW_LIMIT_EXCEEDED" })
      await contextAbsent(); passed.push("real-100-positive-101-fail-closed-no-partial-result")
    } finally {
      await admin.workforcePolicy.deleteMany({ where: { id: extraId, organizationId: orgs[0] } })
      await admin.workforcePolicy.update({ where: { id: `window-cap-99-${suffix}` }, data: { effectiveTo: null } })
    }
  })

  it("keeps positive tenant reads while foreign/unscoped reads are empty and the app cannot write", async () => {
    for (const table of ["workforce_policies", "mtm_settings"] as const) {
      const [role] = await app.$queryRaw<Array<{ bypass: boolean; super: boolean; owner: boolean; read: boolean; write: boolean; enabled: boolean; forced: boolean }>>`
        SELECT r.rolbypassrls AS bypass,r.rolsuper AS super,c.relowner=r.oid AS owner,
          c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,
          has_table_privilege(current_user,${"public." + table},'SELECT') AS read,
          (has_table_privilege(current_user,${"public." + table},'INSERT') OR has_table_privilege(current_user,${"public." + table},'UPDATE') OR has_table_privilege(current_user,${"public." + table},'DELETE')) AS write
        FROM pg_roles r,pg_class c WHERE r.rolname=current_user AND c.relname=${table} AND c.relnamespace='public'::regnamespace`
      expect(role).toEqual({ bypass: false, super: false, owner: false, read: true, write: false, enabled: true, forced: true })
      for (const org of orgs) {
        const where = { organizationId: org }, foreign = { organizationId: orgs.find(id => id !== org) }
        const owner = table === "workforce_policies" ? await admin.workforcePolicy.count({ where }) : await admin.mtmSetting.count({ where })
        expect(owner).toBeGreaterThan(0)
        expect(await scoped(tx => table === "workforce_policies" ? tx.workforcePolicy.count() : tx.mtmSetting.count(), org)).toBe(owner)
        expect(await scoped(tx => table === "workforce_policies" ? tx.workforcePolicy.count({ where: foreign }) : tx.mtmSetting.count({ where: foreign }), org)).toBe(0)
      }
      expect(await scoped(tx => table === "workforce_policies" ? tx.workforcePolicy.count() : tx.mtmSetting.count(), null)).toBe(0)
    }
    expect(await scoped(tx => read(tx), orgs[1])).toBeNull(); expect(await scoped(tx => read(tx), null)).toBeNull()
    await contextAbsent(); passed.push("populated-two-tenant-select-only-rls")
  })

  it("rolls back a rejected integrity read without leaking transaction tenant context or changing facts", async () => {
    try {
      await admin.workforcePolicy.update({ where: { id: draftId }, data: { definitionHash: "0".repeat(64) } })
      const facts = async () => ({
        policies: await admin.workforcePolicy.findMany({ where: { organizationId: { in: orgs } }, orderBy: { id: "asc" } }),
        settings: await admin.mtmSetting.findMany({ where: { organizationId: { in: orgs } }, orderBy: { id: "asc" } }),
      })
      const before = await facts()
      await expect(scoped(tx => read(tx))).rejects.toMatchObject({ code: "WORKFORCE_POLICY_WINDOW_INTEGRITY_INVALID" })
      expect(await facts()).toEqual(before)
      await contextAbsent(); passed.push("integrity-rejection-read-transaction-rollback-facts-unchanged")
    } finally { await admin.workforcePolicy.update({ where: { id: draftId }, data: { definitionHash } }) }
  })

  afterAll(async () => {
    const cleanup: Array<{ action: string; status: string }> = []
    try {
      if (admin) await admin.$transaction(async tx => {
        await tx.workforcePolicy.deleteMany({ where: { organizationId: { in: orgs } } })
        await tx.mtmSetting.deleteMany({ where: { organizationId: { in: orgs } } })
        await tx.mtmTeam.deleteMany({ where: { organizationId: { in: orgs } } })
        await tx.user.deleteMany({ where: { organizationId: { in: orgs } } })
        await tx.organization.deleteMany({ where: { id: { in: orgs } } })
      })
      if (admin) {
        expect(await admin.workforcePolicy.count({ where: { organizationId: { in: orgs } } })).toBe(0)
        expect(await admin.mtmSetting.count({ where: { organizationId: { in: orgs } } })).toBe(0)
        expect(await admin.mtmTeam.count({ where: { organizationId: { in: orgs } } })).toBe(0)
        expect(await admin.user.count({ where: { organizationId: { in: orgs } } })).toBe(0)
        expect(await admin.organization.count({ where: { id: { in: orgs } } })).toBe(0)
      }
      cleanup.push({ action: "isolated-owner-fixture-removal-and-absence", status: admin ? "PASS" : "NOT RUN" })
    } catch { cleanup.push({ action: "isolated-owner-fixture-removal", status: "FAIL" }) }
    for (const [name, client] of [["app", app], ["owner", admin]] as const) {
      try { if (client) await client.$disconnect(); cleanup.push({ action: name + "-disconnect", status: "PASS" }) }
      catch { cleanup.push({ action: name + "-disconnect", status: "FAIL" }) }
    }
    const paths = ["src/__tests__/lib-workforce-policy-future-window-postgres.test.ts", "src/lib/workforce/policy-future-window-read.ts",
      "src/lib/workforce/policy-future-window-preview.ts", "src/app/api/v1/workforce/configuration/policies/[id]/window-preview/route.ts"]
    const sourceBindings = await Promise.all(paths.map(async path => { const raw = await readFile(path); return { path, bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") } }))
    const directory = process.env.WF_POLICY_VERSION_BROWSER_OUTPUT_DIR || "artifacts/workforce-policy-version-browser"
    await mkdir(directory, { recursive: true })
    await writeFile(directory + "/future-window-postgres-receipt.json", JSON.stringify({
      status: passed.length === 4 && cleanup.every(row => row.status === "PASS") ? "PASS" : "FAIL",
      candidateHead: process.env.WF_POLICY_VERSION_BROWSER_HEAD_SHA, checkedMergeSha: process.env.GITHUB_SHA,
      completedAt: new Date().toISOString(), cases: passed, requiredCases: 4, sourceBindings, cleanup,
      boundary: "Disposable real PostgreSQL loader/RR/SELECT-only/RLS only; owner fixture replacement/removal is not a canonical policy writer or production mutation.",
    }, null, 2) + "\n", { flag: "wx" })
    expect(cleanup.every(row => row.status === "PASS")).toBe(true)
  })
})
