import { randomUUID, createHash } from "node:crypto"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { Prisma, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readWorkforcePolicyEmployeeImpact } from "@/lib/workforce/policy-employee-impact-read"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"

const enabled = process.env.WF_POLICY_IMPACT_POSTGRES === "1"
const pgDescribe = enabled ? describe : describe.skip
const suffix = randomUUID(), orgs = [0, 1].map(n => `impact-org-${n}-${suffix}`)
const actor = `impact-actor-${suffix}`, teams = [0, 1].map(n => `impact-team-${n}-${suffix}`)
const employees = [0, 1, 2].map(n => `impact-employee-${n}-${suffix}`)
const baseline = `impact-baseline-${suffix}`, override = `impact-override-${suffix}`
const draft = `impact-draft-${suffix}`, teamDraft = `impact-team-draft-${suffix}`
const observedAt = new Date(), today = new Date(observedAt.toISOString().slice(0, 10) + "T00:00:00Z")
const day = (n: number) => new Date(today.getTime() + n * 86400000)
const key = (n: number) => day(n).toISOString().slice(0, 10)
const definition = { expectedWorkSeconds: 28800, lateGraceSeconds: 0, undertimeToleranceSeconds: 0,
  overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null, opaque: "PRIVATE_RECORDED_DEFINITION" }
const futureDefinition = { ...definition, expectedWorkSeconds: 36000 }
let owner: PrismaClient, reader: PrismaClient
const cases: string[] = [], fingerprints: Array<{ case: string; before: string; after: string; tables: number }> = []
const readTables = ["workforce_policies", "mtm_settings", "mtm_agents", "workforce_employee_team_memberships"]
function target(value: string | undefined, role: string) {
  if (!value) throw new Error("Employee impact disposable database URL missing")
  const url = new URL(value)
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/workforce_manager_today_browser" || url.username !== role) throw new Error("Employee impact requires exact disposable loopback role/database")
  return url
}
async function scoped<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, org: string | null = orgs[0]) {
  return reader.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${org ?? ""}, true)`
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`
    await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`
    return fn(tx)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 })
}
const read = (tx: Prisma.TransactionClient, policyId = draft, organizationId = orgs[0]) =>
  readWorkforcePolicyEmployeeImpact(tx, { policyId, organizationId, observedAt })
async function contextAbsent() {
  const [row] = await reader.$queryRaw<Array<{ tenant: string | null; bypass: string | null }>>`
    SELECT current_setting('app.org_id',true) AS tenant,current_setting('app.rls_bypass',true) AS bypass`
  expect(row.tenant === null || row.tenant === "").toBe(true); expect(row.bypass).not.toBe("on")
}
async function facts() {
  // Every public tenant table, including empty ones; no employee payload is emitted.
  const tables = await owner.$queryRaw<Array<{ table: string }>>`
    SELECT table_name AS "table" FROM information_schema.columns
    WHERE table_schema='public' AND column_name='organizationId' ORDER BY table_name`
  const rows: unknown[] = []
  for (const { table } of tables) {
    if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error("Unsafe fixture table identifier")
    const entries = await owner.$queryRaw<Array<{ value: unknown }>>(Prisma.sql`
      SELECT to_jsonb(t) AS value FROM ${Prisma.raw(`"public"."${table}"`)} t
      WHERE t."organizationId" IN (${Prisma.join(orgs)}) ORDER BY to_jsonb(t)::text`)
    rows.push({ table, entries })
  }
  rows.push({ organizations: await owner.organization.findMany({ where: { id: { in: orgs } }, orderBy: { id: "asc" } }) })
  return { hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"), tables: tables.length + 1 }
}
async function unchanged(label: string, fn: () => Promise<void>) {
  const before = await facts(); await fn(); const after = await facts()
  expect(after).toEqual(before); fingerprints.push({ case: label, before: before.hash, after: after.hash, tables: before.tables })
  await contextAbsent(); cases.push(label)
}
async function removeMemberships(ids: string[]) {
  // Owner-only fixture maintenance, exact guard restored in this transaction.
  await owner.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
    await tx.$executeRaw`ALTER TABLE workforce_employee_team_memberships DISABLE TRIGGER workforce_employee_team_memberships_immutable`
    await tx.workforceEmployeeTeamMembership.deleteMany({ where: { organizationId: { in: orgs }, id: { in: ids } } })
    await tx.$executeRaw`ALTER TABLE workforce_employee_team_memberships ENABLE TRIGGER workforce_employee_team_memberships_immutable`
  })
}

pgDescribe("hosted employee impact SELECT-only coherent PostgreSQL projection", () => {
  beforeAll(async () => {
    expect(process.env.GITHUB_ACTIONS).toBe("true"); expect(process.env.CI).toBe("true")
    expect(process.env.NODE_ENV).not.toBe("production")
    expect(process.env.WF_POLICY_IMPACT_HEAD_SHA).toMatch(/^[a-f0-9]{40}$/)
    expect(process.env.GITHUB_SHA).toMatch(/^[a-f0-9]{40}$/)
    expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(process.env.GITHUB_SHA)
    execFileSync("git", ["merge-base", "--is-ancestor", process.env.WF_POLICY_IMPACT_HEAD_SHA!, "HEAD"])
    const adminUrl = target(process.env.ADMIN_DATABASE_URL, "postgres")
    const url = target(process.env.WF_POLICY_IMPACT_READ_DATABASE_URL, "wf_policy_impact_reader")
    expect(target(process.env.EVENT_PLATFORM_TEST_DATABASE_URL, "postgres").href).toBe(adminUrl.href)
    expect([url.protocol, url.host, url.pathname, url.search]).toEqual([adminUrl.protocol, adminUrl.host, adminUrl.pathname, adminUrl.search])
    url.searchParams.set("connection_limit", "1")
    owner = new PrismaClient({ datasourceUrl: adminUrl.toString() }); reader = new PrismaClient({ datasourceUrl: url.toString() })
    for (const [n, id] of orgs.entries()) {
      await owner.organization.create({ data: { id, name: "Impact disposable fixture", slug: `impact-${n}-${suffix}` } })
      await owner.mtmSetting.create({ data: { organizationId: id, key: "timezone", value: "UTC" } })
    }
    await owner.user.create({ data: { id: actor, organizationId: orgs[0], email: `impact-${suffix}@example.test`,
      name: "Impact fixture actor", role: "admin", passwordHash: randomUUID() } })
    await owner.mtmTeam.createMany({ data: teams.map((id, n) => ({ id, organizationId: orgs[0], name: `Impact team ${n}`, code: id })) })
    await owner.mtmAgent.createMany({ data: employees.map((id, n) => ({ id, organizationId: orgs[0], name: `PRIVATE_EMPLOYEE_${n}`,
      role: (["AGENT", "MANAGER", "ADMIN"] as const)[n], status: "ACTIVE", teamId: teams[0] })) })
    await owner.mtmAgent.create({ data: { organizationId: orgs[0], name: "PRIVATE_INACTIVE", status: "INACTIVE" } })
    await owner.workforceEmployeeTeamMembership.createMany({ data: [
      { id: `impact-member-0-${suffix}`, organizationId: orgs[0], agentId: employees[0], teamId: teams[0], effectiveAt: day(-30), source: "FIXTURE" },
      { id: `impact-member-1-${suffix}`, organizationId: orgs[0], agentId: employees[1], teamId: null, effectiveAt: day(-30), source: "FIXTURE" },
      { id: `impact-member-after-${suffix}`, organizationId: orgs[0], agentId: employees[1], teamId: teams[0], effectiveAt: day(31), source: "FIXTURE" },
    ] })
    const common = { organizationId: orgs[0], name: "Recorded impact fixture", definition,
      definitionHash: workforcePolicyDefinitionHash(definition), provenance: "TENANT_ADMIN" as const, createdByUserId: actor }
    await owner.workforcePolicy.createMany({ data: [
      { ...common, id: baseline, version: 1, status: "ACTIVE", effectiveFrom: day(-365), activatedAt: day(-365), activatedByUserId: actor },
      { ...common, id: override, teamId: teams[0], version: 1, status: "ACTIVE", effectiveFrom: day(-365), activatedAt: day(-365), activatedByUserId: actor },
      { ...common, id: draft, version: 2, status: "DRAFT", effectiveFrom: day(30), definition: futureDefinition,
        definitionHash: workforcePolicyDefinitionHash(futureDefinition) },
      { ...common, id: teamDraft, teamId: teams[0], version: 2, status: "DRAFT", effectiveFrom: day(30), definition: futureDefinition,
        definitionHash: workforcePolicyDefinitionHash(futureDefinition) },
    ] })
    await owner.mtmAgent.create({ data: { id: `impact-foreign-${suffix}`, organizationId: orgs[1], name: "PRIVATE_FOREIGN", status: "ACTIVE" } })
    await owner.workforceEmployeeTeamMembership.create({ data: { organizationId: orgs[1], agentId: `impact-foreign-${suffix}`,
      effectiveAt: day(-30), source: "FIXTURE" } })
    await owner.workforcePolicy.create({ data: { organizationId: orgs[1], name: "Foreign impact fixture", version: 1, status: "ACTIVE",
      effectiveFrom: day(-365), activatedAt: day(-365), definition, definitionHash: workforcePolicyDefinitionHash(definition),
      provenance: "SYSTEM_PROVISIONING", systemProfileVersion: "fixture-only" } })
  }, 30000)

  it("projects all ACTIVE directory roles using history with team override and no mutable-team fallback", async () => {
    await unchanged("real-active-directory-history-org-and-team-projections", async () => {
      const org = await scoped(tx => read(tx)), team = await scoped(tx => read(tx, teamDraft))
      expect(org?.counts).toMatchObject({ directoryEmployees: 3, selectedDraft: 2, unchangedSelection: 1,
        teamOverride: 1, missingMembership: 1, calculationChanged: 2, noPolicyBefore: 0, noPolicyAfter: 0 })
      expect(org?.groups).toHaveLength(1); expect(org?.groups[0].count).toBe(2)
      expect(org?.groups[0].fields[0]).toMatchObject({ before: 28800, after: 36000, deltaSeconds: 7200 })
      expect(org?.groups[0].fields[4]).toMatchObject({ before: null, after: null, deltaSeconds: null, changed: false })
      expect(team?.counts).toMatchObject({ directoryEmployees: 3, selectedDraft: 1, outsideDraftTeam: 2, unchangedSelection: 2 })
      expect(JSON.stringify([org, team])).not.toMatch(/PRIVATE_EMPLOYEE|PRIVATE_INACTIVE|PRIVATE_FOREIGN|PRIVATE_RECORDED_DEFINITION/)
      for (const id of employees) expect(JSON.stringify([org, team])).not.toContain(id)
    })
  })

  it("enforces real SELECT-only privileges and populated two-tenant FORCE RLS", async () => {
    await unchanged("four-table-populated-force-rls-select-only", async () => {
      for (const table of readTables) {
        const [role] = await reader.$queryRaw<Array<{ bypass: boolean; super: boolean; owner: boolean; read: boolean; write: boolean; enabled: boolean; forced: boolean }>>`
          SELECT r.rolbypassrls AS bypass,r.rolsuper AS super,c.relowner=r.oid AS owner,
            has_table_privilege(current_user,c.oid,'SELECT') AS read,
            (has_table_privilege(current_user,c.oid,'INSERT') OR has_table_privilege(current_user,c.oid,'UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE')) AS write,
            c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced
          FROM pg_roles r,pg_class c WHERE r.rolname=current_user AND c.relname=${table} AND c.relnamespace='public'::regnamespace`
        expect(role).toEqual({ bypass: false, super: false, owner: false, read: true, write: false, enabled: true, forced: true })
        for (const org of orgs) {
          const count = (tx: Prisma.TransactionClient, filter?: string) => tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
            SELECT count(*) FROM ${Prisma.raw(`"public"."${table}"`)} WHERE "organizationId"=${filter ?? org}`)
          expect((await owner.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*) FROM ${Prisma.raw(`"public"."${table}"`)} WHERE "organizationId"=${org}`))[0].count).toBeGreaterThan(0n)
          expect((await scoped(tx => count(tx), org))[0].count).toBeGreaterThan(0n)
          expect((await scoped(tx => count(tx, orgs.find(id => id !== org)), org))[0].count).toBe(0n)
          expect((await scoped(tx => count(tx), null))[0].count).toBe(0n)
        }
        await expect(scoped(tx => tx.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw(`"public"."${table}"`)} SET "id"="id" WHERE "organizationId"=${orgs[0]}`)))
          .rejects.toMatchObject({ code: "P2010", meta: { code: "42501" } })
      }
      expect(await scoped(tx => read(tx), orgs[1])).toBeNull(); expect(await scoped(tx => read(tx), null)).toBeNull()
    })
  })

  it("retains one coherent RR snapshot through concurrent draft, timezone, directory and membership commit", async () => {
    let release!: () => void, reached!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve }), firstRead = new Promise<void>(resolve => { reached = resolve })
    const pending = scoped(async tx => {
      expect((await tx.workforcePolicy.findFirst({ where: { id: draft }, select: { effectiveFrom: true } }))?.effectiveFrom).toEqual(day(30))
      reached(); await barrier; return read(tx)
    })
    const addedId = `impact-concurrent-${suffix}`
    try {
      await Promise.race([firstRead, pending.then(() => { throw new Error("Impact snapshot barrier not reached") })])
      await owner.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`
        await tx.workforcePolicy.update({ where: { id: draft }, data: { effectiveFrom: day(40) } })
        await tx.mtmSetting.update({ where: { organizationId_key: { organizationId: orgs[0], key: "timezone" } }, data: { value: "Asia/Baku" } })
        await tx.mtmAgent.update({ where: { id: employees[2] }, data: { status: "INACTIVE", teamId: null } })
        await tx.workforceEmployeeTeamMembership.create({ data: { id: addedId, organizationId: orgs[0], agentId: employees[0], teamId: null,
          effectiveAt: day(10), source: "FIXTURE_OWNER_CONCURRENT" } })
      })
      release(); const old = await pending, fresh = await scoped(tx => read(tx))
      expect(old?.draft.effectiveFrom).toBe(key(30)); expect(old?.timezone).toBe("UTC")
      expect(old?.counts).toMatchObject({ directoryEmployees: 3, selectedDraft: 2, teamOverride: 1, missingMembership: 1 })
      expect(fresh?.draft.effectiveFrom).toBe(key(40)); expect(fresh?.timezone).toBe("Asia/Baku")
      expect(fresh?.counts).toMatchObject({ directoryEmployees: 2, selectedDraft: 1, teamOverride: 1, missingMembership: 0 })
      await contextAbsent(); cases.push("coherent-repeatable-read-four-fact-concurrent-commit")
    } finally {
      release(); await pending.catch(() => undefined); await removeMemberships([addedId])
      await owner.workforcePolicy.update({ where: { id: draft }, data: { effectiveFrom: day(30) } })
      await owner.mtmSetting.update({ where: { organizationId_key: { organizationId: orgs[0], key: "timezone" } }, data: { value: "UTC" } })
      await owner.mtmAgent.update({ where: { id: employees[2] }, data: { status: "ACTIVE", teamId: teams[0] } })
    }
  }, 25000)

  it("does not retain row or advisory locks after resolving membership inside its open transaction", async () => {
    let release!: () => void, reached!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { reached = resolve })
    const pending = scoped(async tx => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
      expect((await read(tx))?.counts.directoryEmployees).toBe(3)
      const locks = await owner.$queryRaw<Array<{ type: string; mode: string }>>`
        SELECT locktype AS type,mode FROM pg_locks WHERE pid=${pid} AND granted
          AND (locktype IN ('advisory','tuple') OR (locktype='relation' AND relation IN (
            'mtm_agents'::regclass,'workforce_employee_team_memberships'::regclass,'workforce_policies'::regclass)))`
      expect(locks.every(row => row.type === "relation" && row.mode === "AccessShareLock")).toBe(true)
      reached(); await barrier
    })
    try {
      await Promise.race([ready, pending.then(() => { throw new Error("Impact lock barrier not reached") })])
      await owner.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`
        await tx.mtmAgent.update({ where: { id: employees[0] }, data: { teamId: teams[1] } })
        // FOR SHARE on a membership would block this owner maintenance UPDATE.
        await tx.$executeRaw`ALTER TABLE workforce_employee_team_memberships DISABLE TRIGGER workforce_employee_team_memberships_immutable`
        await tx.workforceEmployeeTeamMembership.update({ where: { id: `impact-member-0-${suffix}` }, data: { source: "FIXTURE_OWNER_LOCK_PROBE" } })
        await tx.$executeRaw`ALTER TABLE workforce_employee_team_memberships ENABLE TRIGGER workforce_employee_team_memberships_immutable`
      })
      release(); await pending; await contextAbsent(); cases.push("observed-access-share-only-independent-owner-write-completes")
    } finally {
      release(); await pending.catch(() => undefined)
      await owner.mtmAgent.update({ where: { id: employees[0] }, data: { teamId: teams[0] } })
      await owner.$transaction(async tx => {
        await tx.$executeRaw`ALTER TABLE workforce_employee_team_memberships DISABLE TRIGGER workforce_employee_team_memberships_immutable`
        await tx.workforceEmployeeTeamMembership.update({ where: { id: `impact-member-0-${suffix}` }, data: { source: "FIXTURE" } })
        await tx.$executeRaw`ALTER TABLE workforce_employee_team_memberships ENABLE TRIGGER workforce_employee_team_memberships_immutable`
      })
    }
  }, 25000)

  it("accepts the complete100 employee cohort and refuses a real101st employee without partial data", async () => {
    const ids = Array.from({ length: 97 }, (_, n) => `impact-cap-employee-${n}-${suffix}`), extra = `impact-cap-extra-employee-${suffix}`
    try {
      await owner.mtmAgent.createMany({ data: ids.map(id => ({ id, organizationId: orgs[0], name: "PRIVATE_CAP", status: "ACTIVE" as const })) })
      await unchanged("real-100-employee-complete-positive", async () => {
        expect((await scoped(tx => read(tx)))?.counts).toMatchObject({ directoryEmployees: 100, selectedDraft: 99, missingMembership: 98 })
      })
      await owner.mtmAgent.create({ data: { id: extra, organizationId: orgs[0], name: "PRIVATE_SENTINEL", status: "ACTIVE" } })
      await unchanged("real-101-employee-fail-closed", async () => {
        await expect(scoped(tx => read(tx))).rejects.toMatchObject({ code: "WORKFORCE_POLICY_IMPACT_LIMIT_EXCEEDED" })
      })
    } finally { await owner.mtmAgent.deleteMany({ where: { organizationId: orgs[0], id: { in: [...ids, extra] } } }) }
  }, 25000)

  it("accepts100 global ACTIVE policies and refuses the real101st sentinel even in another team", async () => {
    const ids = Array.from({ length: 98 }, (_, n) => `impact-cap-policy-${n}-${suffix}`), extra = `impact-cap-extra-policy-${suffix}`
    const common = { organizationId: orgs[0], teamId: teams[1], name: "Impact cap", status: "ACTIVE" as const,
      definition, definitionHash: workforcePolicyDefinitionHash(definition), activatedAt: day(-1000),
      provenance: "TENANT_ADMIN" as const, createdByUserId: actor, activatedByUserId: actor }
    try {
      await owner.workforcePolicy.createMany({ data: ids.map((id, n) => ({ ...common, id, version: n + 1, effectiveFrom: day(-500 + n), effectiveTo: day(-500 + n) })) })
      await unchanged("real-100-global-policy-complete-positive", async () => { expect((await scoped(tx => read(tx)))?.counts.selectedDraft).toBe(2) })
      await owner.workforcePolicy.create({ data: { ...common, id: extra, version: 99, effectiveFrom: day(-402), effectiveTo: day(-402) } })
      await unchanged("real-101-global-policy-fail-closed", async () => {
        await expect(scoped(tx => read(tx))).rejects.toMatchObject({ code: "WORKFORCE_POLICY_IMPACT_LIMIT_EXCEEDED" })
      })
    } finally { await owner.workforcePolicy.deleteMany({ where: { organizationId: orgs[0], id: { in: [...ids, extra] } } }) }
  }, 25000)

  it("rolls back an integrity rejection with all tenant business facts and GUC cleanup preserved", async () => {
    try {
      await owner.workforcePolicy.update({ where: { id: draft }, data: { definitionHash: "0".repeat(64) } })
      await unchanged("damaged-hash-rejection-rollback-no-dml-no-context-leak", async () => {
        await expect(scoped(tx => read(tx))).rejects.toMatchObject({ code: "WORKFORCE_POLICY_IMPACT_INTEGRITY_INVALID" })
      })
    } finally { await owner.workforcePolicy.update({ where: { id: draft }, data: { definitionHash: workforcePolicyDefinitionHash(futureDefinition) } }) }
  })

  afterAll(async () => {
    const cleanup: Array<{ action: string; status: string }> = []
    try {
      if (owner) {
        await owner.$transaction(async tx => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
          await tx.$executeRaw`ALTER TABLE workforce_employee_team_memberships DISABLE TRIGGER workforce_employee_team_memberships_immutable`
          await tx.workforceEmployeeTeamMembership.deleteMany({ where: { organizationId: { in: orgs } } })
          await tx.$executeRaw`ALTER TABLE workforce_employee_team_memberships ENABLE TRIGGER workforce_employee_team_memberships_immutable`
          await tx.workforcePolicy.deleteMany({ where: { organizationId: { in: orgs } } })
          await tx.mtmSetting.deleteMany({ where: { organizationId: { in: orgs } } })
          await tx.mtmAgent.deleteMany({ where: { organizationId: { in: orgs } } })
          await tx.mtmTeam.deleteMany({ where: { organizationId: { in: orgs } } })
          await tx.user.deleteMany({ where: { organizationId: { in: orgs } } })
          await tx.organization.deleteMany({ where: { id: { in: orgs } } })
        })
        const where = { organizationId: { in: orgs } }
        expect(await owner.workforcePolicy.count({ where })).toBe(0)
        expect(await owner.mtmSetting.count({ where })).toBe(0)
        expect(await owner.mtmAgent.count({ where })).toBe(0)
        expect(await owner.workforceEmployeeTeamMembership.count({ where })).toBe(0)
        expect(await owner.mtmTeam.count({ where })).toBe(0)
        expect(await owner.user.count({ where })).toBe(0)
        expect(await owner.organization.count({ where: { id: { in: orgs } } })).toBe(0)
        const [guard] = await owner.$queryRaw<Array<{ enabled: string }>>`
          SELECT tgenabled AS enabled FROM pg_trigger WHERE tgrelid='workforce_employee_team_memberships'::regclass
            AND tgname='workforce_employee_team_memberships_immutable'`
        expect(guard.enabled).toBe("O")
      }
      cleanup.push({ action: "scoped-owner-fixture-removal-absence-guard-enabled", status: owner ? "PASS" : "NOT RUN" })
    } catch { cleanup.push({ action: "scoped-owner-fixture-removal", status: "FAIL" }) }
    for (const [name, client] of [["reader", reader], ["owner", owner]] as const) {
      try { if (client) await client.$disconnect(); cleanup.push({ action: name + "-disconnect", status: client ? "PASS" : "NOT RUN" }) }
      catch { cleanup.push({ action: name + "-disconnect", status: "FAIL" }) }
    }
    const paths = ["src/__tests__/lib-workforce-policy-employee-impact-postgres.test.ts", "src/lib/workforce/policy-employee-impact-read.ts",
      "src/lib/workforce/policy-employee-impact-preview.ts", "src/app/api/v1/workforce/configuration/policies/[id]/employee-impact/route.ts",
      "scripts/ci/fixtures/workforce-policy-employee-impact.sql", "scripts/ci/fixtures/workforce-manager-today-browser.sql",
      "scripts/ci/fixtures/workforce-policy-version-browser.sql", "prisma/schema.prisma",
      ".github/workflows/workforce-policy-employee-impact-evidence.yml", "src/lib/workforce/policy-definition.ts",
      "src/lib/workforce/policy-resolution.ts", "src/lib/workforce/policy-future-window-preview.ts", "src/lib/timezone.ts",
      "src/lib/mtm-settings.ts", "src/lib/mtm/mobile-week.ts", "src/lib/with-workforce-rls-auth.ts", "src/lib/with-rls.ts",
      "src/lib/api-auth.ts", "src/lib/workforce/sensitive-response.ts", "src/lib/workforce/sensitive-operation-log.ts",
      "prisma/migrations/20260828223000_workforce_h3_foundation/migration.sql", "prisma/migrations/20260829114500_workforce_future_only_lifecycle/migration.sql",
      "prisma/migrations/20260829140000_workforce_system_provisioning_defaults/migration.sql", "prisma/migrations/20260830130000_workforce_employee_team_membership_history/migration.sql"]
    const sourceBindings = await Promise.all(paths.map(async path => { const raw = await readFile(path); return { path, bytes: raw.length,
      sha256: createHash("sha256").update(raw).digest("hex") } }))
    const directory = process.env.WF_POLICY_IMPACT_OUTPUT_DIR || "artifacts/workforce-policy-employee-impact"
    await mkdir(directory, { recursive: true })
    await writeFile(directory + "/employee-impact-postgres-receipt.json", JSON.stringify({
      status: cases.length === 9 && cleanup.every(row => row.status === "PASS") ? "PASS" : "FAIL",
      candidateHead: process.env.WF_POLICY_IMPACT_HEAD_SHA, checkedMergeSha: process.env.GITHUB_SHA,
      completedAt: new Date().toISOString(), cases, requiredCases: 9, fingerprints, sourceBindings, cleanup,
      boundary: "Real disposable SELECT-only loader/RR/RLS/limits. Owner setup/replacements/guard-disabled cleanup are fixture maintenance, not canonical writers, employment prediction, activation or production mutation.",
    }, null, 2) + "\n", { flag: "wx" })
    expect(cases).toHaveLength(9); expect(cleanup.every(row => row.status === "PASS")).toBe(true)
  })
})
