import { randomUUID, createHash } from "node:crypto"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { Prisma, PrismaClient } from "@prisma/client"
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { restoreWorkforcePolicyAsDraft } from "@/lib/workforce/policy-restore-draft"
import { createWorkforcePolicyDraft, updateWorkforcePolicyDraft, activateWorkforcePolicyDraft } from "@/lib/workforce/configuration-management"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
import { workforcePolicyScopeLock } from "@/lib/workforce/policy-draft-write"

// Actual SQL is opt-in only on this dedicated GitHub-hosted disposable server.
const enabled = process.env.WF_POLICY_RESTORE_POSTGRES === "1"
const pgDescribe = enabled ? describe : describe.skip
const suffix = randomUUID(), orgs = [`restore-a-${suffix}`, `restore-b-${suffix}`]
const users = orgs.map((_, n) => `restore-user-${n}-${suffix}`), teams = orgs.map((_, n) => `restore-team-${n}-${suffix}`)
const sourceIds = orgs.map((_, n) => `restore-source-${n}-${suffix}`)
const teamSourceId = `restore-team-source-${suffix}`
const definition = { expectedWorkSeconds: 0, lateGraceSeconds: 0, undertimeToleranceSeconds: 0,
  overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null, opaque: { retained: [null, 0, { futureRule: true }] } }
const definitionHash = workforcePolicyDefinitionHash(definition)
const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z")
const day = (offset: number) => new Date(today.getTime() + offset * 86400000)
const key = (offset: number) => day(offset).toISOString().slice(0, 10)
const cases: string[] = [], lockObservations: Array<{ waitersRequired: number; waitersObserved: number }> = []
let admin: PrismaClient, sameCreation: Awaited<ReturnType<typeof restoreWorkforcePolicyAsDraft>>
const operation = (label: string) => `restore-${label}-${suffix}`
const draft = (label: string) => ({ operationId: operation(label), name: "Restored disposable draft", effectiveFrom: key(30),
  expectedSourceVersion: 1, expectedSourceDefinitionHash: definitionHash })
const restore = (label: string, sourcePolicyId = sourceIds[0], actor = users[0]) => runWithTenant(orgs[0], () =>
  restoreWorkforcePolicyAsDraft({ organizationId: orgs[0], sourcePolicyId, draft: draft(label), audit: { actorUserId: actor } }))
function target(value: string | undefined, role: string) {
  if (!value) throw new Error("Dedicated restore PostgreSQL URL missing")
  const url = new URL(value)
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/workforce_manager_today_browser" || url.username !== role) throw new Error("Restore SQL requires its exact disposable loopback database/role")
  return url
}
async function policyAndAuditFacts() {
  return { policies: await admin.workforcePolicy.findMany({ where: { organizationId: { in: orgs } }, orderBy: { id: "asc" } }),
    audits: await admin.mtmAuditLog.findMany({ where: { organizationId: { in: orgs } }, orderBy: { id: "asc" } }) }
}
async function preservedFacts() {
  return {
    sources: await admin.workforcePolicy.findMany({ where: { id: { in: [...sourceIds, teamSourceId] } }, orderBy: { id: "asc" } }),
    settings: await admin.mtmSetting.findMany({ where: { organizationId: { in: orgs } }, orderBy: { id: "asc" } }),
    users: await admin.user.findMany({ where: { organizationId: { in: orgs } }, orderBy: { id: "asc" } }),
    teams: await admin.mtmTeam.findMany({ where: { organizationId: { in: orgs } }, orderBy: { id: "asc" } }),
    agents: await admin.mtmAgent.findMany({ where: { organizationId: { in: orgs } }, orderBy: { id: "asc" } }),
    workdays: await admin.mtmAgentWorkday.findMany({ where: { organizationId: { in: orgs } }, orderBy: { id: "asc" } }),
    snapshots: await admin.workforcePolicySnapshot.findMany({ where: { organizationId: { in: orgs } }, orderBy: { id: "asc" } }),
  }
}
async function observeConcurrentWaits<T>(teamId: string | null, expected: number, start: () => Promise<T>, additionalTeamId?: string): Promise<T> {
  let ready!: () => void, release!: () => void
  const held = new Promise<void>(resolve => { ready = resolve }), stop = new Promise<void>(resolve => { release = resolve })
  const barrier = admin.$transaction(async tx => {
    const locks = [workforcePolicyScopeLock(orgs[0], teamId), ...(additionalTeamId ? [workforcePolicyScopeLock(orgs[0], additionalTeamId)] : [])].sort()
    for (const lock of locks) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`
    ready(); await stop
  }, { timeout: 10000 })
  await held
  const pending = start(); pending.catch(() => {})
  try {
    const deadline = Date.now() + 1800
    let observed = 0
    while (Date.now() < deadline) {
      const [row] = await admin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_locks l
        JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.usename='wf_policy_restore'`
      observed = Number(row.n)
      if (observed >= expected) break
      await new Promise(resolve => setTimeout(resolve, 15))
    }
    lockObservations.push({ waitersRequired: expected, waitersObserved: observed }); expect(observed).toBeGreaterThanOrEqual(expected)
  } finally { release(); await barrier }
  return pending
}
async function assertNoTenantAcrossAllFourConnections() {
  let release!: () => void, allReady!: () => void
  const stop = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { allReady = resolve })
  const observed: Array<{ pid: number; tenant: string | null; bypass: string | null }> = []
  const pending = Promise.all(Array.from({ length: 4 }, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const [row] = await tx.$queryRaw<Array<{ pid: number; tenant: string | null; bypass: string | null }>>`
      SELECT pg_backend_pid() AS pid,current_setting('app.org_id',true) AS tenant,current_setting('app.rls_bypass',true) AS bypass`
    observed.push(row); if (observed.length === 4) allReady(); await stop
  }, { maxWait: 5000, timeout: 10000 })))
  pending.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Four connection barrier not reached")), 5000) })])
    expect(new Set(observed.map(row => row.pid)).size).toBe(4)
    for (const row of observed) { expect(row.tenant == null || row.tenant === "").toBe(true); expect(row.bypass).not.toBe("on") }
  } finally { if (timer) clearTimeout(timer); release(); await pending }
  return observed.map(row => ({ pid: row.pid, tenantAbsent: !row.tenant, bypassAbsent: row.bypass !== "on" }))
}

pgDescribe("mandatory hosted real restore writer PostgreSQL", () => {
  beforeAll(async () => {
    expect(process.env.GITHUB_ACTIONS).toBe("true"); expect(process.env.CI).toBe("true"); expect(process.env.NODE_ENV).not.toBe("production")
    expect(process.env.WF_POLICY_RESTORE_HEAD_SHA).toMatch(/^[a-f0-9]{40}$/)
    const owner = target(process.env.ADMIN_DATABASE_URL, "postgres"), app = target(process.env.DATABASE_URL, "wf_policy_restore")
    expect(target(process.env.EVENT_PLATFORM_TEST_DATABASE_URL, "postgres").href).toBe(owner.href)
    expect(app.host).toBe(owner.host); expect(app.searchParams.get("connection_limit")).toBe("4")
    admin = new PrismaClient({ datasourceUrl: owner.toString() })
    for (let n = 0; n < 2; n++) {
      await admin.organization.create({ data: { id: orgs[n], name: "Restore isolated fixture", slug: `restore-${n}-${suffix}` } })
      await admin.user.create({ data: { id: users[n], organizationId: orgs[n], email: `restore-${n}-${suffix}@example.test`, name: "Fixture creator", role: "admin", passwordHash: randomUUID() } })
      await admin.mtmTeam.create({ data: { id: teams[n], organizationId: orgs[n], code: `restore-${n}-${suffix}`, name: "Fixture team" } })
      await admin.mtmSetting.create({ data: { organizationId: orgs[n], key: "timezone", value: "UTC" } })
      await admin.workforcePolicy.create({ data: { id: sourceIds[n], organizationId: orgs[n], version: 1, status: "ACTIVE", name: "Recorded source",
        effectiveFrom: day(-365), definition, definitionHash, provenance: "TENANT_ADMIN", createdByUserId: users[n], activatedByUserId: users[n], activatedAt: day(-365) } })
      await admin.mtmAuditLog.create({ data: { organizationId: orgs[n], actorUserId: users[n], action: "FIXTURE_HISTORY", entity: "fixture", entityId: "fixture" } })
      const agent = await admin.mtmAgent.create({ data: { organizationId: orgs[n], name: "Snapshot fixture employee", teamId: teams[n] } })
      const workday = await admin.mtmAgentWorkday.create({ data: { organizationId: orgs[n], agentId: agent.id, workDate: day(-2), startedAt: day(-2) } })
      await admin.workforcePolicySnapshot.create({ data: { organizationId: orgs[n], policyId: sourceIds[n], workdayId: workday.id, agentId: agent.id,
        workDate: day(-2), policyVersion: 1, definition, definitionHash, expectedWorkSeconds: 0, lateGraceSeconds: 0,
        undertimeToleranceSeconds: 0, overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null } })
    }
    await admin.workforcePolicy.create({ data: { id: teamSourceId, organizationId: orgs[0], teamId: teams[0], version: 1, status: "RETIRED",
      name: "Recorded team source", effectiveFrom: day(-365), effectiveTo: day(-30), definition, definitionHash, provenance: "TENANT_ADMIN",
      createdByUserId: users[0], activatedByUserId: users[0], activatedAt: day(-365), retiredAt: day(-30) } })
  })

  it("has enabled actual anchor/check/index and published guards, restricted nonowner role, populated two-tenant FORCE-RLS denial", async () => {
    const [role] = await admin.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean; owner: boolean }>>`
      SELECT r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,c.relowner=r.oid AS owner FROM pg_roles r,pg_class c
      WHERE r.rolname='wf_policy_restore' AND c.oid='public.workforce_policies'::regclass`
    expect(Object.values(role)).toEqual([false, false, false, false, false])
    const guards = await admin.$queryRaw<Array<{ tgname: string; tgenabled: string }>>`SELECT tgname,tgenabled FROM pg_trigger
      WHERE tgrelid='public.workforce_policies'::regclass AND NOT tgisinternal ORDER BY tgname`
    for (const name of ["workforce_policies_restore_anchor_guard", "workforce_policies_published_definition_guard", "workforce_policies_published_definition_delete_guard"]) {
      expect(guards.find(row => row.tgname === name)?.tgenabled).toBe("O")
    }
    const checks = await admin.$queryRaw<Array<{ conname: string; convalidated: boolean }>>`SELECT conname,convalidated FROM pg_constraint
      WHERE conrelid='public.workforce_policies'::regclass`
    expect(checks.find(row => row.conname === "workforce_policies_restore_anchor_check")?.convalidated).toBe(true)
    const tables = ["workforce_policies", "mtm_audit_logs", "mtm_settings", "mtm_teams", "users", "workforce_policy_snapshots"]
    for (const table of tables) {
      const [catalog] = await admin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=${"public." + table}::regclass`
      expect(catalog).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
      for (const own of orgs) await runWithTenant(own, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const [row] = await tx.$queryRaw<Array<{ own: bigint; foreign: bigint }>>(Prisma.sql`SELECT count(*) FILTER (WHERE "organizationId"=${own}) AS own,
          count(*) FILTER (WHERE "organizationId"<>${own}) AS foreign FROM ${Prisma.raw('"' + table + '"')}`)
        expect(Number(row.own)).toBeGreaterThan(0); expect(Number(row.foreign)).toBe(0)
      }))
      const rows: Array<{ n: bigint }> = await prisma.$queryRaw(Prisma.sql`SELECT count(*) AS n FROM ${Prisma.raw('"' + table + '"')}`)
      expect(Number(rows[0].n)).toBe(0)
    }
    const permissions = await admin.$queryRaw<Array<{ write: boolean; remove: boolean; schema: boolean }>>`SELECT
      has_table_privilege('wf_policy_restore','workforce_policies','UPDATE') AS write,
      has_table_privilege('wf_policy_restore','workforce_policies','DELETE') AS remove,
      has_schema_privilege('wf_policy_restore','public','CREATE') AS schema`
    expect(permissions[0]).toEqual({ write: false, remove: false, schema: false })
    await assertNoTenantAcrossAllFourConnections(); cases.push("actual-ddl-role-populated-two-tenant-force-rls")
  })

  it("two actual same-operation concurrent calls visibly wait on the legacy lock then create one draft and one audit", async () => {
    const before = await preservedFacts()
    const results = await observeConcurrentWaits(null, 2, () => Promise.all([restore("same"), restore("same")]))
    expect(results.map(row => row.replayed).sort()).toEqual([false, true])
    expect(results[0].creation).toEqual(results[1].creation); sameCreation = results[0]
    const rows = await admin.workforcePolicy.findMany({ where: { organizationId: orgs[0], restoreOperationId: operation("same") } })
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ definition, definitionHash, status: "DRAFT", provenance: "TENANT_ADMIN", createdByUserId: users[0], systemProfileVersion: null })
    expect(await admin.mtmAuditLog.count({ where: { organizationId: orgs[0], entityId: operation("same") } })).toBe(1)
    expect(await preservedFacts()).toEqual(before); cases.push("same-operation-observed-concurrency-one-draft-one-audit")
  })

  it("different operation keys serialize with the actual legacy public creator and allocate consecutive scope versions", async () => {
    const before = await preservedFacts(), latest = await admin.workforcePolicy.findFirst({ where: { organizationId: orgs[0], teamId: null }, orderBy: { version: "desc" } })
    const results = await observeConcurrentWaits(null, 3, () => Promise.all([restore("different-a"), restore("different-b"),
      runWithTenant(orgs[0], () => createWorkforcePolicyDraft({ organizationId: orgs[0], createdByUserId: users[0], audit: { actorUserId: users[0] },
        draft: { name: "Legacy draft unchanged", effectiveFrom: key(40), definition } }))]))
    const versions = results.map(row => "creation" in row ? row.creation.version : row.version).sort((a, b) => a - b)
    expect(versions).toEqual([latest!.version + 1, latest!.version + 2, latest!.version + 3])
    const legacy = results[2]
    expect("creation" in legacy).toBe(false)
    const audits = await admin.mtmAuditLog.findMany({ where: { organizationId: orgs[0], entityId: legacy.id } })
    expect(audits).toHaveLength(1); expect(audits[0].action).toBe("WORKFORCE_POLICY_DRAFT_CREATED"); expect(audits[0].actorUserId).toBeNull()
    expect(await preservedFacts()).toEqual(before); cases.push("different-keys-and-real-legacy-creator-monotonic-version")
  })

  it("real audit INSERT failure rolls back the draft/anchor and full policy/audit fingerprints", async () => {
    const before = await policyAndAuditFacts(), facts = await preservedFacts()
    await admin.$executeRawUnsafe(`CREATE FUNCTION wf_fixture_restore_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId"='${operation("rollback")}' THEN RAISE EXCEPTION 'Fixture audit insert rejected' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$`)
    await admin.$executeRawUnsafe("CREATE TRIGGER wf_fixture_restore_fail_audit BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION wf_fixture_restore_fail_audit()")
    try {
      await expect(restore("rollback")).rejects.toBeInstanceOf(Error)
      expect(await policyAndAuditFacts()).toEqual(before); expect(await preservedFacts()).toEqual(facts)
      expect(await admin.workforcePolicy.count({ where: { restoreOperationId: operation("rollback") } })).toBe(0)
    } finally {
      await admin.$executeRawUnsafe("DROP TRIGGER wf_fixture_restore_fail_audit ON mtm_audit_logs")
      await admin.$executeRawUnsafe("DROP FUNCTION wf_fixture_restore_fail_audit()")
    }
    await assertNoTenantAcrossAllFourConnections(); cases.push("real-audit-failure-atomic-rollback-and-context-absence")
  })

  it("same operation raced against two different source scopes yields one creation and one conflicting request", async () => {
    const before = await preservedFacts()
    const results = await observeConcurrentWaits(null, 2, () => Promise.allSettled([restore("different-scope"), restore("different-scope", teamSourceId)]), teams[0])
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1)
    const rejected = results.find(row => row.status === "rejected")
    expect(rejected?.status === "rejected" ? rejected.reason.code : null).toBe("WORKFORCE_POLICY_RESTORE_OPERATION_CONFLICT")
    expect(await admin.workforcePolicy.count({ where: { organizationId: orgs[0], restoreOperationId: operation("different-scope") } })).toBe(1)
    expect(await admin.mtmAuditLog.count({ where: { organizationId: orgs[0], entityId: operation("different-scope") } })).toBe(1)
    expect(await preservedFacts()).toEqual(before); cases.push("same-key-different-scope-real-race-one-create-one-conflict")
  })

  it("anchor identity rejects retrofit, identity updates/delete and initial published/system anchoring while legacy DRAFTs remain unanchored", async () => {
    const id = sameCreation.creation.policyId
    for (const column of ["restoreOperationId", "restoreRequestHash", "id", "organizationId", "teamId", "createdByUserId", "createdAt", "version"]) {
      const value = column === "version" ? '"version"+1' : column === "createdAt" ? '"createdAt"+interval \'1 second\'' : "'changed'"
      await expect(admin.$executeRawUnsafe(`UPDATE workforce_policies SET "${column}"=${value} WHERE id='${id}'`)).rejects.toMatchObject({ meta: { code: "55000" } })
    }
    await expect(admin.workforcePolicy.delete({ where: { id } })).rejects.toBeInstanceOf(Error)
    const legacy = await admin.workforcePolicy.findFirstOrThrow({ where: { organizationId: orgs[0], name: "Legacy draft unchanged" } })
    expect(legacy.restoreOperationId).toBeNull(); expect(legacy.restoreRequestHash).toBeNull()
    await expect(admin.$executeRaw`UPDATE workforce_policies SET "restoreOperationId"=${operation("retrofit")},"restoreRequestHash"=${"a".repeat(64)} WHERE id=${legacy.id}`).rejects.toMatchObject({ meta: { code: "55000" } })
    for (const status of ["ACTIVE", "RETIRED"] as const) await expect(admin.workforcePolicy.create({ data: { organizationId: orgs[0], teamId: teams[0],
      version: 100, name: "Invalid anchor", status, effectiveFrom: day(90), definition, definitionHash, provenance: "TENANT_ADMIN", createdByUserId: users[0],
      activatedByUserId: users[0], activatedAt: day(1), retiredAt: status === "RETIRED" ? day(2) : null,
      restoreOperationId: operation("published"), restoreRequestHash: "a".repeat(64) } })).rejects.toBeInstanceOf(Error)
    await expect(admin.workforcePolicy.create({ data: { organizationId: orgs[0], teamId: teams[0], version: 100, name: "System cannot restore", status: "DRAFT",
      effectiveFrom: day(90), definition, definitionHash, provenance: "SYSTEM_PROVISIONING", systemProfileVersion: "fixture", restoreOperationId: operation("system"), restoreRequestHash: "a".repeat(64) } })).rejects.toBeInstanceOf(Error)
    // An ordinary unanchored legacy DRAFT remains editable/deletable.
    await admin.workforcePolicy.update({ where: { id: legacy.id }, data: { name: "Legacy still editable" } })
    await admin.workforcePolicy.delete({ where: { id: legacy.id } })
    cases.push("durable-anchor-insert-only-identity-guard-legacy-behavior")
  })

  it("null-pair/hash checks and tenant operation uniqueness reject invalid anchored INSERTs", async () => {
    const common = { organizationId: orgs[0], teamId: teams[0], version: 100, name: "Invalid anchor", effectiveFrom: day(90), definition, definitionHash, createdByUserId: users[0] }
    for (const pair of [{ restoreOperationId: operation("one-null"), restoreRequestHash: null }, { restoreOperationId: null, restoreRequestHash: "a".repeat(64) },
      { restoreOperationId: "short", restoreRequestHash: "a".repeat(64) }, { restoreOperationId: operation("bad-hash"), restoreRequestHash: "bad" }]) {
      await expect(admin.workforcePolicy.create({ data: { ...common, ...pair } })).rejects.toBeInstanceOf(Error)
    }
    await expect(admin.workforcePolicy.create({ data: { ...common, restoreOperationId: operation("same"), restoreRequestHash: "a".repeat(64) } })).rejects.toMatchObject({ code: "P2002" })
    cases.push("null-pair-format-and-operation-unique-constraints")
  })

  it("actual legacy draft edits and activation preserve the anchor while exact replay remains a historical creation receipt", async () => {
    const id = sameCreation.creation.policyId, before = await admin.workforcePolicy.findUniqueOrThrow({ where: { id } })
    // Owner invokes existing canonical functions to exercise trigger compatibility;
    // restricted restore role still has no policy UPDATE/DELETE grant.
    await updateWorkforcePolicyDraft({ organizationId: orgs[0], policyId: id, draft: { name: "Edited after restore", effectiveFrom: key(50), definition: { ...definition, expectedWorkSeconds: 60 } }, audit: { actorUserId: users[0] }, db: admin })
    await activateWorkforcePolicyDraft({ organizationId: orgs[0], policyId: id, currentDateKey: key(0), audit: { actorUserId: users[0] }, db: admin })
    const after = await admin.workforcePolicy.findUniqueOrThrow({ where: { id } })
    expect(after.status).toBe("ACTIVE"); expect(after.definitionHash).not.toBe(definitionHash)
    expect(after.restoreOperationId).toBe(before.restoreOperationId); expect(after.restoreRequestHash).toBe(before.restoreRequestHash)
    const facts = await policyAndAuditFacts()
    const replay = await restore("same", sourceIds[0], users[0])
    expect(replay.replayed).toBe(true); expect(replay.creation).toEqual(sameCreation.creation); expect(replay.creation.statusAtCreation).toBe("DRAFT")
    expect(await policyAndAuditFacts()).toEqual(facts)
    cases.push("canonical-owner-edit-activation-compatible-historical-replay")
  })

  it("committed anchor with deliberately removed audit fails closed with no second draft", async () => {
    const result = await restore("missing-audit")
    await admin.$transaction(async tx => {
      await tx.$executeRawUnsafe("ALTER TABLE mtm_audit_logs DISABLE TRIGGER wf_fixture_restore_audit_guard")
      await tx.mtmAuditLog.deleteMany({ where: { organizationId: orgs[0], entityId: operation("missing-audit") } })
      await tx.$executeRawUnsafe("ALTER TABLE mtm_audit_logs ENABLE TRIGGER wf_fixture_restore_audit_guard")
    })
    const before = await policyAndAuditFacts()
    await expect(restore("missing-audit")).rejects.toMatchObject({ code: "WORKFORCE_POLICY_RESTORE_INTEGRITY_INVALID" })
    expect(await policyAndAuditFacts()).toEqual(before)
    expect(await admin.workforcePolicy.count({ where: { id: result.creation.policyId } })).toBe(1)
    cases.push("real-committed-anchor-missing-audit-no-replacement")
  })

  it("orphan and duplicate/malformed receipts fail closed without new policies or audits", async () => {
    const existing = await admin.mtmAuditLog.findFirstOrThrow({ where: { organizationId: orgs[0], entityId: operation("different-a") } })
    const data = existing.newData as Prisma.JsonObject
    await admin.mtmAuditLog.create({ data: { organizationId: orgs[0], actorUserId: users[0], action: existing.action, entity: existing.entity,
      entityId: operation("different-a"), metadataKind: existing.metadataKind, newData: data as Prisma.InputJsonValue } })
    let before = await policyAndAuditFacts()
    await expect(restore("different-a")).rejects.toMatchObject({ code: "WORKFORCE_POLICY_RESTORE_INTEGRITY_INVALID" })
    expect(await policyAndAuditFacts()).toEqual(before)
    for (const label of ["orphan", "malformed"]) {
      await admin.mtmAuditLog.create({ data: { organizationId: orgs[0], actorUserId: users[0], action: existing.action, entity: existing.entity,
        entityId: operation(label), metadataKind: existing.metadataKind,
        newData: label === "malformed" ? { bad: true } : { ...data, operationId: operation(label) } as Prisma.InputJsonValue } })
      before = await policyAndAuditFacts()
      await expect(restore(label)).rejects.toMatchObject({ code: "WORKFORCE_POLICY_RESTORE_INTEGRITY_INVALID" })
      expect(await policyAndAuditFacts()).toEqual(before)
    }
    cases.push("orphan-duplicate-malformed-receipts-no-write")
  })

  it("restores RETIRED TEAM scope exactly, handles changed request conflict and expired exact replay before the fresh-date gate", async () => {
    const before = await preservedFacts()
    const latest = await admin.workforcePolicy.findFirstOrThrow({ where: { organizationId: orgs[0], teamId: teams[0] }, orderBy: { version: "desc" } })
    const result = await restore("team", teamSourceId)
    expect(result.creation.teamId).toBe(teams[0]); expect(result.creation.version).toBe(latest.version + 1)
    await expect(runWithTenant(orgs[0], () => restoreWorkforcePolicyAsDraft({ organizationId: orgs[0], sourcePolicyId: teamSourceId,
      draft: { ...draft("team"), name: "Conflicting request" }, audit: { actorUserId: users[0] } }))).rejects.toMatchObject({ code: "WORKFORCE_POLICY_RESTORE_OPERATION_CONFLICT" })
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(day(90))
    try {
      expect((await restore("team", teamSourceId)).creation).toEqual(result.creation)
      await expect(restore("new-expired", teamSourceId)).rejects.toMatchObject({ code: "WORKFORCE_POLICY_RESTORE_NOT_FUTURE" })
    } finally { vi.useRealTimers() }
    expect(await preservedFacts()).toEqual(before); await assertNoTenantAcrossAllFourConnections()
    cases.push("retired-team-exactscope-conflict-clock-expired-replay")
  })

  afterAll(async () => {
    vi.useRealTimers()
    const cleanup: Array<{ action: string; status: string }> = []
    let cleanupFailed = false
    try {
      if (!admin) throw new Error("Owner fixture not initialized")
      await admin.$transaction(async tx => {
        // Named guards only, isolated owner only, transactional restoration before commit.
        await tx.$executeRawUnsafe("ALTER TABLE workforce_policies DISABLE TRIGGER workforce_policies_published_definition_delete_guard")
        await tx.$executeRawUnsafe("ALTER TABLE workforce_policies DISABLE TRIGGER workforce_policies_restore_anchor_guard")
        await tx.$executeRawUnsafe("ALTER TABLE mtm_audit_logs DISABLE TRIGGER wf_fixture_restore_audit_guard")
        await tx.workforcePolicySnapshot.deleteMany({ where: { organizationId: { in: orgs } } })
        await tx.mtmAgentWorkday.deleteMany({ where: { organizationId: { in: orgs } } })
        await tx.mtmAgent.deleteMany({ where: { organizationId: { in: orgs } } })
        await tx.mtmAuditLog.deleteMany({ where: { organizationId: { in: orgs } } })
        await tx.workforcePolicy.deleteMany({ where: { organizationId: { in: orgs } } })
        await tx.mtmSetting.deleteMany({ where: { organizationId: { in: orgs } } })
        await tx.mtmTeam.deleteMany({ where: { organizationId: { in: orgs } } })
        await tx.user.deleteMany({ where: { organizationId: { in: orgs } } })
        await tx.organization.deleteMany({ where: { id: { in: orgs } } })
        await tx.$executeRawUnsafe("ALTER TABLE workforce_policies ENABLE TRIGGER workforce_policies_published_definition_delete_guard")
        await tx.$executeRawUnsafe("ALTER TABLE workforce_policies ENABLE TRIGGER workforce_policies_restore_anchor_guard")
        await tx.$executeRawUnsafe("ALTER TABLE mtm_audit_logs ENABLE TRIGGER wf_fixture_restore_audit_guard")
      })
      expect(await admin.organization.count({ where: { id: { in: orgs } } })).toBe(0)
      const guards = await admin.$queryRaw<Array<{ tgenabled: string }>>`SELECT tgenabled FROM pg_trigger WHERE tgname IN
        ('workforce_policies_published_definition_delete_guard','workforce_policies_restore_anchor_guard','wf_fixture_restore_audit_guard')`
      expect(guards).toHaveLength(3); expect(guards.every(row => row.tgenabled === "O")).toBe(true)
      cleanup.push({ action: "owned-rows-removed-named-guards-restored", status: "PASS" })
      await assertNoTenantAcrossAllFourConnections(); cleanup.push({ action: "four-connection-context-absence", status: "PASS" })
    } catch { cleanupFailed = true; cleanup.push({ action: "owned-rows-or-guard-restoration", status: "FAIL" }) }
    for (const [name, client] of [["shared-app", prisma], ["owner", admin]] as const) {
      try { if (client) await client.$disconnect(); cleanup.push({ action: name + "-disconnect", status: "PASS" }) }
      catch { cleanupFailed = true; cleanup.push({ action: name + "-disconnect", status: "FAIL" }) }
    }
    const paths = ["src/__tests__/lib-workforce-policy-restore-postgres.test.ts", "src/lib/workforce/policy-restore-draft.ts", "src/lib/workforce/policy-draft-write.ts",
      "src/lib/workforce/configuration-management.ts", "src/lib/prisma.ts", "src/lib/rls-context.ts", "prisma/schema.prisma",
      "prisma/migrations/20261004073000_workforce_policy_restore_operation_anchor/migration.sql", "scripts/ci/fixtures/workforce-policy-restore-writer.sql"]
    const sourceBindings = await Promise.all(paths.map(async path => { const raw = await readFile(path); return { path, bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") } }))
    const directory = process.env.WF_POLICY_RESTORE_OUTPUT_DIR || "artifacts/workforce-policy-restore"
    await mkdir(directory, { recursive: true })
    await writeFile(directory + "/restore-postgres-receipt.json", JSON.stringify({ status: cases.length === 11 && !cleanupFailed ? "PASS" : "FAIL", requiredCases: 11, cases,
      candidateHead: process.env.WF_POLICY_RESTORE_HEAD_SHA, checkedMergeSha: process.env.GITHUB_SHA, completedAt: new Date().toISOString(), sourceBindings,
      lockObservations, cleanup, boundary: "Actual shared prisma+runWithTenant restore/legacy-create transactions on nonowner FORCE-RLS PostgreSQL. Owner canonical edit/activation tests only guard compatibility. Snapshots are populated owner fixtures with unchanged full-row assertions, not canonical resolver/snapshot writer acceptance. Date-only fake clock in expiry case; real PostgreSQL timers/queries. Extra audit immutability is fixture-only; audit removal deliberately verifies durable production anchor fail-closed." }, null, 2) + "\n", { flag: "wx" })
    expect(cleanupFailed).toBe(false)
  })
})
