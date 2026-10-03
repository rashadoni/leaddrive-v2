import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Prisma, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readWorkforceExceptionCaseReport } from "@/lib/workforce/exception-case-report-read"

// Disposable hosted PostgreSQL proof; isolated fixture only, never production.
// Tests recorded request/ledger links; does not call/activate terminal or approval writers,
// and does not prove workday application from an isolated ledger insert.
const databaseUrl = process.env.WORKFORCE_EXCEPTION_LOCK_TEST_DATABASE_URL
// Match existing optional whole-suite fixtures: absent URL skips this suite.
// BOTH mandatory hosted PostgreSQL lanes must explicitly run this file with the URL.
const postgresDescribe = databaseUrl ? describe : describe.skip
const suffix = randomUUID().replaceAll("-", "")
const schema = `workforce_report_${suffix}`
const applicationRole = `workforce_report_app_${suffix.slice(0, 16)}`
const applicationPassword = `ReportApplication_${suffix}`
const orgA = "report-org-a"
const orgB = "report-org-b"
const restrictedTables = [
  "workforce_exception_cases", "workforce_exception_decisions",
  "workforce_exception_employee_responses", "mtm_hrm_requests", "workforce_time_corrections",
] as const
const migrationNames = {
  hrm: "20260716070000_mtm_mobile_messages_documents_hrm",
  h3: "20260828223000_workforce_h3_foundation",
  direct: "20260828230000_workforce_direct_correction_contract",
  cases: "20260830170000_workforce_exception_case_lifecycle",
  responses: "20260830200000_workforce_exception_employee_responses",
  links: "20260831113000_workforce_exception_correction_request_link",
  expected: "20260901003000_workforce_no_show_expected_date",
  revisions: "20260927014000_workforce_exception_case_revisions",
  decisionIndex: "20260927014200_workforce_exception_case_revisions_decision_index",
  responseIndex: "20260927014250_workforce_exception_case_revisions_response_index",
}
let observer: PrismaClient | undefined
let app: PrismaClient | undefined
let roleCreated = false
let schemaCreated = false

function migration(name: string): string {
  return readFileSync(join(process.cwd(), "prisma", "migrations", name, "migration.sql"), "utf8")
}
function extract(source: string, start: string, end = ";"): string {
  const from = source.indexOf(start)
  if (from < 0) throw new Error(`Required production statement absent: ${start}`)
  const to = source.indexOf(end, from)
  if (to < 0) throw new Error(`Required production statement unterminated: ${start}`)
  return source.slice(from, to + end.length)
}
function productionFunction(source: string, name: string): string {
  return extract(source, `CREATE OR REPLACE FUNCTION ${name}(`, "\n$$;")
}
function quoted(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error("Unsafe fixture identifier")
  return `"${value}"`
}
function clientUrl(role?: string): string {
  if (!databaseUrl) throw new Error("Report PostgreSQL fixture URL is unavailable")
  const url = new URL(databaseUrl)
  if (databaseUrl && (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/event_platform_test")) {
    throw new Error("Report test requires the isolated hosted event_platform_test loopback database")
  }
  if (role) { url.username = role; url.password = applicationPassword }
  url.searchParams.set("schema", schema)
  url.searchParams.set("connection_limit", "2")
  return url.toString()
}
async function settings(tx: Prisma.TransactionClient, organizationId?: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('search_path', ${`${schema},pg_catalog`}, true)`
  await tx.$executeRaw`SELECT set_config('TimeZone', 'UTC', true)`
  await tx.$executeRaw`SELECT set_config('app.org_id', ${organizationId ?? ""}, true)`
}
async function owner<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (!observer) throw new Error("Fixture owner unavailable")
  return observer.$transaction(async tx => { await settings(tx); return fn(tx) }, { timeout: 60_000 })
}
async function scoped<T>(organizationId: string | undefined, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (!app) throw new Error("Fixture app unavailable")
  return app.$transaction(async tx => { await settings(tx, organizationId); return fn(tx) }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 10_000,
  })
}
function window(day: number) {
  const startAt = new Date(Date.UTC(2025, 0, day))
  return { startAt, endAt: new Date(startAt.getTime() + 86_400_000) }
}
const agent = (org: string) => `${org}-agent`
const actor = (org: string) => `${org}-actor`
const workday = (org: string) => `${org}-workday`
async function createCase(tx: Prisma.TransactionClient, org: string, id: string, at: Date, kind = "NO_SHOW") {
  await tx.$executeRaw`INSERT INTO workforce_exception_cases
    ("id","organizationId","agentId","workdayId","kind","detectorVersion","deduplicationKey","createdAt")
    VALUES (${id},${org},${agent(org)},${workday(org)},${kind},'fixture-recorded-v1',${createHash("sha256").update(id).digest("hex")},${at})`
}
async function createRequest(tx: Prisma.TransactionClient, org: string, id: string, caseId: string | null,
  options: { type?: string; status?: string; workdayId?: string; agentId?: string } = {}) {
  await tx.$executeRaw`INSERT INTO mtm_hrm_requests
    ("id","organizationId","agentId","clientRequestId","type","status","startDate","endDate",
     "correctionWorkdayId","exceptionCaseId","requestedStartAt","reason","submittedAt","updatedAt")
    VALUES (${id},${org},${options.agentId ?? agent(org)},${`client-${id}`},
      ${options.type ?? "TIME_CORRECTION"}::"MtmHrmRequestType",${options.status ?? "APPROVED"}::"MtmHrmRequestStatus",
      '2025-01-01','2025-01-01',${options.workdayId ?? workday(org)},${caseId},'2025-01-01T08:00:00',
      'PRIVATE_FIXTURE_REASON',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
}
async function createCorrection(tx: Prisma.TransactionClient, org: string, id: string, requestId: string | null,
  options: { source?: "REQUEST_APPROVAL" | "DIRECT_MANAGER"; workdayId?: string; agentId?: string; actorUserId?: string; at?: Date } = {}) {
  const source = options.source ?? "REQUEST_APPROVAL"
  await tx.$executeRaw`INSERT INTO workforce_time_corrections
    ("id","organizationId","agentId","workdayId","requestId","source","requestHash","operationId",
      "actorUserId","reason","beforeFacts","afterFacts","occurredAt","createdAt")
    VALUES (${id},${org},${options.agentId ?? agent(org)},${options.workdayId ?? workday(org)},${requestId},
      ${source}::"WorkforceTimeCorrectionSource",${source === "DIRECT_MANAGER" ? "a".repeat(64) : null},${`operation-${id}`},
      ${options.actorUserId ?? actor(org)},'PRIVATE_FIXTURE_LEDGER_REASON','{"fixtureBoundary":0}'::jsonb,'{"fixtureBoundary":1}'::jsonb,
      CURRENT_TIMESTAMP,${options.at ?? new Date()})`
}
async function legacyHistory(tx: Prisma.TransactionClient, caseId: string, at: Date,
  entries: Array<{ code: string; ms: number; revision?: number }>) {
  // Explicit historical fixture import. Current trigger normally stamps server-time/revision;
  // bypass only USER triggers in this owner transaction, restore BEFORE commit. Constraints remain.
  // No terminal writer is enabled or accepted by this fixture import.
  await tx.$executeRawUnsafe("ALTER TABLE workforce_exception_decisions DISABLE TRIGGER USER")
  // On failure, PostgreSQL rolls back the owner transaction, including DISABLE.
  // No SQL may run after an abort: it would replace the original SQLSTATE with 25P02.
  for (const [index, entry] of entries.entries()) {
    const id = `${caseId}-decision-${index}`
    await tx.$executeRaw`INSERT INTO workforce_exception_decisions
        ("id","organizationId","caseId","caseRevision","operationId","decisionCode","reason","actorUserId","createdAt")
        VALUES (${id},${orgA},${caseId},${entry.revision ?? index + 1},${`operation-${id}`},${entry.code},
          'PRIVATE_FIXTURE_DECISION_REASON',${actor(orgA)},${new Date(at.getTime() + entry.ms)})`
  }
  await tx.$executeRawUnsafe("ALTER TABLE workforce_exception_decisions ENABLE TRIGGER USER")
}
async function fingerprints() {
  return owner(async tx => {
    const out: Array<{ table: string; count: number; sha256: string }> = []
    for (const table of restrictedTables) {
      const rows = await tx.$queryRawUnsafe<Array<{ value: unknown }>>(
        `SELECT row_to_json(t) AS value FROM ${quoted(table)} t ORDER BY "id" LIMIT 10001`,
      )
      expect(rows.length).toBeLessThanOrEqual(10000)
      out.push({ table, count: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex") })
    }
    return out
  })
}
async function read(day: number, org = orgA, tenant: string | null = orgA) {
  // Explicit null means unscoped; passing undefined would invoke the JS default.
  return scoped(tenant ?? undefined, tx => readWorkforceExceptionCaseReport(tx, { organizationId: org, ...window(day) }))
}
function sqlState(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError && typeof error.meta?.code === "string") return error.meta.code
  return undefined
}
async function rejected(state: string, fn: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  try { await owner(fn) } catch (error) { expect(sqlState(error)).toBe(state); return }
  throw new Error("Expected production constraint rejection")
}

postgresDescribe("bounded recorded exception report on real PostgreSQL", () => {
  beforeAll(async () => {
    observer = new PrismaClient({ datasourceUrl: clientUrl() })
    await observer.$executeRawUnsafe(`CREATE SCHEMA ${quoted(schema)}`); schemaCreated = true
    await observer.$executeRawUnsafe(`CREATE ROLE ${quoted(applicationRole)} LOGIN PASSWORD '${applicationPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`)
    roleCreated = true
    await observer.$executeRawUnsafe(`GRANT CONNECT ON DATABASE event_platform_test TO ${quoted(applicationRole)}`)
    await owner(async tx => {
      const src = Object.fromEntries(Object.entries(migrationNames).map(([key, name]) => [key, migration(name)]))
      const ddl = [
        'CREATE TABLE organizations ("id" TEXT PRIMARY KEY)',
        'CREATE TABLE users ("id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL REFERENCES organizations("id"),UNIQUE("organizationId","id"))',
        'CREATE TABLE mtm_agents ("id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL REFERENCES organizations("id"),"userId" TEXT,UNIQUE("organizationId","id"))',
        'CREATE TABLE mtm_agent_workdays ("id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL REFERENCES organizations("id"),"agentId" TEXT NOT NULL,"workDate" DATE NOT NULL,UNIQUE("organizationId","id"),FOREIGN KEY("organizationId","agentId") REFERENCES mtm_agents("organizationId","id"))',
        'CREATE TABLE mtm_agent_workday_events ("id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"agentId" TEXT,"workdayId" TEXT,UNIQUE("organizationId","id"))',
        'CREATE TABLE workforce_attendance_evidence ("id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workdayEventId" TEXT,"siteTransitionId" TEXT,UNIQUE("organizationId","id"))',
        'CREATE TABLE workforce_shift_segments ("id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,UNIQUE("organizationId","id"))',
        'CREATE TABLE workforce_site_transitions ("id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"agentId" TEXT,"workdayId" TEXT)',
        'CREATE TABLE workforce_workday_schedule_snapshots ("id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workdayId" TEXT,"segments" JSONB NOT NULL)',
        extract(src.hrm, 'CREATE TYPE "MtmHrmRequestType"'),
        extract(src.hrm, 'CREATE TYPE "MtmHrmRequestStatus"'),
        extract(src.h3, 'CREATE TYPE "WorkforceTimeCorrectionSource"'),
        extract(src.hrm, 'CREATE TABLE "mtm_hrm_requests"'),
        extract(src.cases, 'CREATE TABLE "workforce_exception_cases"'),
        extract(src.cases, 'CREATE TABLE "workforce_exception_decisions"'),
        extract(src.responses, 'CREATE TABLE "workforce_exception_employee_responses"'),
        extract(src.h3, 'CREATE TABLE "workforce_time_corrections"'),
        extract(src.links, 'ALTER TABLE "mtm_hrm_requests"\n  ADD COLUMN'),
        extract(src.expected, 'ALTER TABLE "workforce_exception_cases"\n  ADD COLUMN'),
        extract(src.expected, 'ALTER TABLE "workforce_exception_cases"\n  ADD CONSTRAINT'),
        'ALTER TABLE workforce_exception_decisions ADD COLUMN "policyRevisionId" TEXT',
        extract(src.revisions, 'ALTER TABLE "workforce_exception_decisions"'),
        extract(src.revisions, 'ALTER TABLE "workforce_exception_employee_responses"'),
        extract(src.revisions, 'ALTER TABLE "mtm_hrm_requests"'),
        'ALTER TABLE workforce_exception_decisions ALTER COLUMN "caseRevision" SET NOT NULL',
        extract(src.direct, 'ALTER TABLE "workforce_time_corrections"\n  ADD COLUMN'),
        extract(src.direct, 'ALTER TABLE "workforce_time_corrections"\n  ADD CONSTRAINT "workforce_time_corrections_request_hash_format"'),
        extract(src.direct, 'ALTER TABLE "workforce_time_corrections"\n  ADD CONSTRAINT "workforce_time_corrections_source_request_contract"'),
      ]
      for (const statement of ddl) await tx.$executeRawUnsafe(statement)
      const indexes = [
        [src.h3, 'mtm_hrm_requests_organizationId_id_key'],
        [src.hrm, 'mtm_hrm_requests_organizationId_agentId_clientRequestId_key'],
        [src.cases, 'workforce_exception_cases_organizationId_id_key'],
        [src.cases, 'workforce_exception_cases_deduplication_key'],
        [src.cases, 'workforce_exception_decisions_organizationId_id_key'],
        [src.cases, 'workforce_exception_decisions_operation_key'],
        [src.responses, 'workforce_exception_employee_responses_organizationId_id_key'],
        [src.responses, 'workforce_exception_employee_responses_agent_client_key'],
        [src.h3, 'workforce_time_corrections_organizationId_id_key'],
        [src.h3, 'workforce_time_corrections_operation_key'],
        [src.h3, 'workforce_time_corrections_request_key'],
      ]
      for (const [source, name] of indexes) await tx.$executeRawUnsafe(extract(source, `CREATE UNIQUE INDEX "${name}"`))
      // Equivalent key columns, ordinary CREATE INDEX on an isolated empty fixture;
      // does not claim production CREATE INDEX CONCURRENTLY rollout/replay.
      await tx.$executeRawUnsafe(extract(src.decisionIndex, 'CREATE UNIQUE INDEX CONCURRENTLY "workforce_exception_decisions_org_case_revision_key"').replace('CONCURRENTLY ', ''))
      // Actual production response lookup is NON-UNIQUE; multiple signals per cycle remain legal.
      await tx.$executeRawUnsafe(extract(src.responseIndex, 'CREATE INDEX CONCURRENTLY "workforce_exception_employee_responses_org_case_revision_idx"').replace('CONCURRENTLY ', ''))
      await tx.$executeRawUnsafe(extract(src.links, 'CREATE INDEX "mtm_hrm_requests_organizationId_exceptionCaseId_idx"'))
      for (const [source, table] of [[src.cases,"workforce_exception_cases"], [src.cases,"workforce_exception_decisions"], [src.responses,"workforce_exception_employee_responses"], [src.h3,"workforce_time_corrections"]]) {
        await tx.$executeRawUnsafe(extract(source, `ALTER TABLE "${table}"\n  ADD CONSTRAINT`))
      }
      await tx.$executeRawUnsafe(extract(src.links, 'ALTER TABLE "mtm_hrm_requests"\n  ADD CONSTRAINT'))
      const routines = [
        [src.expected,"workforce_validate_exception_case_insert"],
        [src.cases,"workforce_reject_exception_case_mutation"],
        [src.cases,"workforce_reject_exception_decision_mutation"],
        [src.responses,"workforce_reject_exception_employee_response_mutation"],
        [src.h3,"workforce_validate_h3_insert"], [src.h3,"workforce_reject_immutable_mutation"],
        [src.revisions,"workforce_next_exception_compatibility_timestamp"],
        [src.revisions,"workforce_assign_exception_decision_revision"],
        [src.revisions,"workforce_validate_exception_employee_response_insert"],
        [src.revisions,"workforce_validate_hrm_request_exception_link"],
      ]
      for (const [source, name] of routines) await tx.$executeRawUnsafe(productionFunction(source,name))
      for (const [source, name] of [
        [src.cases,"workforce_exception_cases_validate_insert"], [src.cases,"workforce_exception_cases_append_only"],
        [src.cases,"workforce_exception_decisions_append_only"], [src.revisions,"workforce_exception_decisions_assign_case_revision"],
        [src.responses,"workforce_exception_employee_responses_validate_insert"], [src.responses,"workforce_exception_employee_responses_append_only"],
        [src.links,"workforce_hrm_requests_validate_exception_link"], [src.h3,"workforce_time_corrections_validate_insert"],
        [src.h3,"workforce_time_corrections_append_only"],
      ]) await tx.$executeRawUnsafe(extract(source,`CREATE TRIGGER ${name}`))
      for (const table of restrictedTables) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${quoted(table)} ENABLE ROW LEVEL SECURITY`)
        await tx.$executeRawUnsafe(`ALTER TABLE ${quoted(table)} FORCE ROW LEVEL SECURITY`)
        await tx.$executeRawUnsafe(`CREATE POLICY workforce_report_tenant_select ON ${quoted(table)} FOR SELECT USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')`)
      }
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA ${quoted(schema)} TO ${quoted(applicationRole)}`)
      await tx.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA ${quoted(schema)} TO ${quoted(applicationRole)}`)
      for (const org of [orgA,orgB]) {
        await tx.$executeRaw`INSERT INTO organizations("id") VALUES (${org})`
        await tx.$executeRaw`INSERT INTO users("id","organizationId") VALUES (${actor(org)},${org})`
        await tx.$executeRaw`INSERT INTO mtm_agents("id","organizationId","userId") VALUES (${agent(org)},${org},${actor(org)})`
        await tx.$executeRaw`INSERT INTO mtm_agent_workdays("id","organizationId","agentId","workDate") VALUES (${workday(org)},${org},${agent(org)},'2025-01-01')`
        const id=`${org}-baseline-case`
        await createCase(tx,org,id,window(1).startAt,org===orgA?"NO_SHOW":"LATE_START")
        await tx.$executeRaw`INSERT INTO workforce_exception_decisions("id","organizationId","caseId","operationId","decisionCode","reason","actorUserId") VALUES (${`${org}-decision`},${org},${id},${`${org}-decision-operation`},'ACKNOWLEDGE','PRIVATE_FIXTURE_REASON',${actor(org)})`
        await tx.$executeRaw`INSERT INTO workforce_exception_employee_responses("id","organizationId","caseId","agentId","workdayId","responseCode","clientResponseId","actorUserId") VALUES (${`${org}-response`},${org},${id},${agent(org)},${workday(org)},'ACKNOWLEDGED',${`${org}-client-response`},${actor(org)})`
        await createRequest(tx,org,`${org}-request`,id)
        await createCorrection(tx,org,`${org}-correction`,`${org}-request`)
      }
    })
    app = new PrismaClient({ datasourceUrl: clientUrl(applicationRole) })
  },90_000)

  afterAll(async () => {
    const failures: unknown[]=[]
    try { await app?.$disconnect() } catch(error) { failures.push(error) }
    if(observer) {
      try { if(schemaCreated) await observer.$executeRawUnsafe(`DROP SCHEMA ${quoted(schema)} CASCADE`) } catch(error) { failures.push(error) }
      try { if(roleCreated) await observer.$executeRawUnsafe(`DROP OWNED BY ${quoted(applicationRole)}`) } catch(error) { failures.push(error) }
      try { if(roleCreated) await observer.$executeRawUnsafe(`DROP ROLE ${quoted(applicationRole)}`) } catch(error) { failures.push(error) }
      try { await observer.$disconnect() } catch(error) { failures.push(error) }
    }
    if(failures.length) throw new Error(`Report fixture cleanup rejected ${failures.length} owned actions`)
  },30_000)

  it("uses five populated forced-RLS tables with a nonowner readonly app, not zero-row vacuity",async()=>{
    const metadata=await scoped(undefined,tx=>tx.$queryRaw<Array<{table:string;enabled:boolean;forced:boolean;owner:string}>>`SELECT c.relname AS "table",c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,pg_get_userbyid(c.relowner) AS owner FROM pg_class c WHERE c.relnamespace=${schema}::regnamespace AND c.relname IN (${Prisma.join([...restrictedTables])}) ORDER BY c.relname`)
    expect(metadata).toHaveLength(5);expect(metadata.every(x=>x.enabled && x.forced && x.owner!==applicationRole)).toBe(true)
    await scoped(undefined,async tx=>{
      const [role]=await tx.$queryRaw<Array<{rolsuper:boolean;rolbypassrls:boolean;rolcreatedb:boolean;rolcreaterole:boolean;rolreplication:boolean;rolinherit:boolean;bypass:string|null}>>`SELECT r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolinherit,current_setting('app.rls_bypass',true) AS bypass FROM pg_roles r WHERE r.rolname=current_user`
      expect([role.rolsuper,role.rolbypassrls,role.rolcreatedb,role.rolcreaterole,role.rolreplication,role.rolinherit]).toEqual([false,false,false,false,false,false]);expect(role.bypass).not.toBe("on")
      for(const table of restrictedTables) {
        const [row]=await tx.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT count(*) AS count FROM ${quoted(table)}`)
        expect(Number(row.count)).toBe(0)
        const [permissions]=await tx.$queryRaw<Array<{write:boolean}>>`SELECT has_table_privilege(current_user,${`${schema}.${table}`},'INSERT,UPDATE,DELETE') AS write`
        expect(permissions.write).toBe(false)
      }
    })
    await owner(async tx=>{for(const table of restrictedTables) for(const org of [orgA,orgB]) {
      const [row]=await tx.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT count(*) AS count FROM ${quoted(table)} WHERE "organizationId"=$1`,org);expect(Number(row.count)).toBeGreaterThan(0)
    }})
    expect((await read(1,orgA,null)).summary.cases).toBe(0)
    expect((await read(1,orgB,orgA)).summary.cases).toBe(0)
    const a=await read(1);const b=await read(1,orgB,orgB)
    expect(a.summary).toMatchObject({cases:1,employees:1,employeeResponsesReceived:1});expect(a.byType.map(x=>x.type)).toEqual(["NO_SHOW"])
    expect(b.byType.map(x=>x.type)).toEqual(["LATE_START"])
    expect(a.recordedOutcomes.linkedCorrection).toMatchObject({cohortCases:1,recordedLinkedCorrectionCases:1,share:1})
    expect(JSON.stringify(a)).not.toMatch(/report-org-|PRIVATE_FIXTURE|baseline-case|latitude|longitude/)
  })

  it("deduplicates distinct valid request ledgers and excludes approved-only/direct/unlinked/nonapproved requests",async()=>{
    await owner(async tx=>{
      const at=window(2).startAt
      for(const id of ["dedup-valid","approved-only","direct-only","unlinked-only","pending-only","rejected-only","cancelled-only","leave-only","absence-only"]) await createCase(tx,orgA,id,at)
      for(const id of ["valid-request-1","valid-request-2"]) {await createRequest(tx,orgA,id,"dedup-valid");await createCorrection(tx,orgA,`ledger-${id}`,id)}
      await createRequest(tx,orgA,"approved-no-ledger","approved-only")
      await createCorrection(tx,orgA,"direct-ledger",null,{source:"DIRECT_MANAGER"})
      await createRequest(tx,orgA,"unlinked-request",null);await createCorrection(tx,orgA,"unlinked-ledger","unlinked-request")
      for(const status of ["PENDING","REJECTED","CANCELLED"]) await createRequest(tx,orgA,`nonapproved-${status}`,`${status.toLowerCase()}-only`,{status})
      for(const type of ["LEAVE","ABSENCE"]) await createRequest(tx,orgA,`other-type-${type}`,null,{type})
    })
    const result=await read(2)
    expect(result.recordedOutcomes.linkedCorrection).toMatchObject({cohortCases:9,recordedLinkedCorrectionCases:1,share:1/9})
    expect(result.recordedOutcomes.unavailable).toEqual({falsePositiveRate:"UNAVAILABLE_NO_APPROVED_OUTCOME_CLASSIFICATION",appealOverturnRate:"UNAVAILABLE_NO_APPROVED_OUTCOME_CLASSIFICATION"})
  })

  it("uses exact production enum/link/approval/FK/unique/append-only constraints for negative writes",async()=>{
    await rejected("23514",tx=>createRequest(tx,orgA,"bad-agent","report-org-a-baseline-case",{agentId:agent(orgB)}))
    await rejected("23514",tx=>createRequest(tx,orgA,"bad-workday","report-org-a-baseline-case",{workdayId:workday(orgB)}))
    await rejected("23514",tx=>createRequest(tx,orgA,"bad-type","report-org-a-baseline-case",{type:"LEAVE"}))
    await rejected("23514",tx=>createRequest(tx,orgA,"bad-foreign-case","report-org-b-baseline-case"))
    await rejected("23514",tx=>createCorrection(tx,orgA,"foreign-request-ledger","report-org-b-request"))
    await owner(tx=>createRequest(tx,orgA,"foreign-actor-unused-approved-request","report-org-a-baseline-case"))
    await rejected("23503",tx=>createCorrection(tx,orgA,"foreign-actor-ledger","foreign-actor-unused-approved-request",{actorUserId:actor(orgB)}))
    await owner(async tx=>{await createCase(tx,orgA,"negative-pending-case",window(9).startAt);await createRequest(tx,orgA,"negative-pending-request","negative-pending-case",{status:"PENDING"})})
    await rejected("23514",tx=>createCorrection(tx,orgA,"pending-ledger","negative-pending-request"))
    await rejected("23514",tx=>createCorrection(tx,orgA,"bad-ledger-agent","report-org-a-request",{agentId:agent(orgB)}))
    await rejected("23505",tx=>createCorrection(tx,orgA,"duplicate-request-ledger","report-org-a-request"))
    await rejected("55000",tx=>tx.$executeRaw`UPDATE workforce_time_corrections SET reason='changed' WHERE id='report-org-a-correction'`)
    await rejected("55000",tx=>tx.$executeRaw`DELETE FROM workforce_time_corrections WHERE id='report-org-a-correction'`)
    await rejected("55000",tx=>tx.$executeRaw`UPDATE mtm_hrm_requests SET "exceptionCaseId"=NULL WHERE id='report-org-a-request'`)
  })

  it("does not lose a valid second proof behind an explicitly malformed historical first proof",async()=>{
    await owner(async tx=>{
      await createCase(tx,orgA,"history-link",window(3).startAt)
      await tx.$executeRaw`INSERT INTO mtm_agent_workdays("id","organizationId","agentId","workDate") VALUES ('history-other-workday',${orgA},${agent(orgA)},'2025-01-02')`
      await createRequest(tx,orgA,"history-invalid-request","history-link")
      await tx.$executeRawUnsafe("ALTER TABLE workforce_time_corrections DISABLE TRIGGER USER")
      await createCorrection(tx,orgA,"aaa-history-malformed-ledger","history-invalid-request",{workdayId:"history-other-workday",at:window(1).startAt})
      await tx.$executeRawUnsafe("ALTER TABLE workforce_time_corrections ENABLE TRIGGER USER")
      await createRequest(tx,orgA,"history-valid-request","history-link");await createCorrection(tx,orgA,"zzz-history-valid-ledger","history-valid-request")
    })
    expect((await read(3)).recordedOutcomes.linkedCorrection).toMatchObject({cohortCases:1,recordedLinkedCorrectionCases:1,share:1})
    // Disabled USER trigger imported a legacy contradiction, not a permitted current correction.
    await rejected("23514",tx=>createCorrection(tx,orgA,"same-malformed-now-rejected","history-invalid-request",{workdayId:"history-other-workday"}))
  })

  it("validates complete revision/date/lifecycle histories and retains first resolution through reopen",async()=>{
    await owner(async tx=>{
      const at=window(4).startAt
      const histories: Array<[string,Array<{code:string;ms:number;revision?:number}>]>=[
        ["timing-reopen",[{code:"ACKNOWLEDGE",ms:1000},{code:"RESOLVE_NO_CHANGE",ms:4000},{code:"REOPEN_FOR_REVIEW",ms:5000},{code:"RESOLVE_WITH_CORRECTION",ms:9000}]],
        ["timing-second",[{code:"ACKNOWLEDGE",ms:2000},{code:"RESOLVE_WITH_CORRECTION",ms:6000}]],
        ["timing-equal",[{code:"ACKNOWLEDGE",ms:0},{code:"RESOLVE_NO_CHANGE",ms:0}]],
        ["timing-open",[]],
        ["timing-gap",[{code:"ACKNOWLEDGE",ms:1000},{code:"RESOLVE_NO_CHANGE",ms:2000,revision:3}]],
        ["timing-backwards",[{code:"ACKNOWLEDGE",ms:2000},{code:"RESOLVE_NO_CHANGE",ms:1000}]],
        ["timing-before-case",[{code:"ACKNOWLEDGE",ms:-1000}]],
        ["timing-unknown",[{code:"UNKNOWN_LEGACY",ms:1000}]],
        ["timing-illegal",[{code:"RESOLVE_NO_CHANGE",ms:1000}]],
        ["timing-truncated",Array.from({length:65},(_,n)=>({code:"ACKNOWLEDGE",ms:n}))],
        ["timing-invalid-after-resolve",[{code:"ACKNOWLEDGE",ms:1000},{code:"RESOLVE_NO_CHANGE",ms:2000},{code:"ACKNOWLEDGE",ms:3000}]],
      ]
      for(const [id,entries] of histories) {await createCase(tx,orgA,id,at);await legacyHistory(tx,id,at,entries)}
    })
    const result=await read(4)
    expect(result.summary).toMatchObject({cases:11,dataIntegrityReview:7})
    expect(result.recordedOutcomes.firstResolution).toMatchObject({sampleCount:3,unresolvedCases:1,integrityExcludedCases:7,minMs:0,maxMs:6000,meanMs:3333})
    await rejected("23505",async tx=>{
      await tx.$executeRawUnsafe("ALTER TABLE workforce_exception_decisions DISABLE TRIGGER USER")
      // Distinct PK and operation isolate the (org,case,revision) unique index.
      await tx.$executeRaw`INSERT INTO workforce_exception_decisions("id","organizationId","caseId","caseRevision","operationId","decisionCode","reason","actorUserId","createdAt") VALUES ('timing-second-distinct-duplicate-revision',${orgA},'timing-second',1,'distinct-operation-duplicate-revision','ACKNOWLEDGE','PRIVATE_FIXTURE_REASON',${actor(orgA)},${window(4).startAt})`
      // Reached only if insertion unexpectedly succeeds; rollback restores on failure.
      await tx.$executeRawUnsafe("ALTER TABLE workforce_exception_decisions ENABLE TRIGGER USER")
    })
    await owner(async tx=>{
      const [state]=await tx.$queryRaw<Array<{enabled:boolean}>>`SELECT bool_and(t.tgenabled='O') AS enabled FROM pg_trigger t WHERE t.tgrelid='workforce_exception_decisions'::regclass AND NOT t.tgisinternal`
      expect(state.enabled).toBe(true)
    })
  })

  it("reads a coherent repeatable snapshot across a committed fixture approval, without helper fact writes",async()=>{
    const at=window(5).startAt
    await owner(async tx=>{await createCase(tx,orgA,"snapshot-case",at);await createRequest(tx,orgA,"snapshot-request","snapshot-case",{status:"PENDING"})})
    let snapshotReady!:()=>void;let allowRead!:()=>void
    const ready=new Promise<void>(resolve=>{snapshotReady=resolve});const committed=new Promise<void>(resolve=>{allowRead=resolve})
    const oldRead=scoped(orgA,async tx=>{
      // Real SELECT establishes the RR snapshot; no query/Prisma mocks or interceptors.
      const cases=await tx.workforceExceptionCase.findMany({where:{organizationId:orgA,createdAt:at},select:{id:true}})
      expect(cases).toEqual([{id:"snapshot-case"}]);snapshotReady();await committed
      return readWorkforceExceptionCaseReport(tx,{organizationId:orgA,...window(5)})
    })
    let synchronizationError: unknown
    try {
      await Promise.race([ready,oldRead.then(()=>{throw new Error("Snapshot reader unexpectedly ended before synchronization")})])
      await owner(async tx=>{await tx.$executeRaw`UPDATE mtm_hrm_requests SET status='APPROVED' WHERE id='snapshot-request'`;await createCorrection(tx,orgA,"snapshot-ledger","snapshot-request")})
    } catch(error) {synchronizationError=error} finally {allowRead()}
    const oldResult=await oldRead // Always settle the reader, including writer failure.
    if(synchronizationError) throw synchronizationError
    expect(oldResult.recordedOutcomes.linkedCorrection.recordedLinkedCorrectionCases).toBe(0)
    const before=await fingerprints();expect((await read(5)).recordedOutcomes.linkedCorrection.recordedLinkedCorrectionCases).toBe(1);expect(await fingerprints()).toEqual(before)
    // This was a fixture request+ledger transaction, not an application/workday writer test.
  },30_000)

  it("returns null measurements for an empty cohort and leaves all five fixture facts unchanged",async()=>{
    const before=await fingerprints();const result=await read(6)
    expect(result.summary.cases).toBe(0)
    expect(result.recordedOutcomes.linkedCorrection).toMatchObject({cohortCases:0,recordedLinkedCorrectionCases:0,share:null})
    expect(result.recordedOutcomes.firstResolution).toMatchObject({sampleCount:0,unresolvedCases:0,integrityExcludedCases:0,minMs:null,maxMs:null,meanMs:null})
    expect(await fingerprints()).toEqual(before)
  })

  it("fails closed at the 5001-case sentinel without returning a truncated aggregate",async()=>{
    await owner(tx=>tx.$executeRaw`INSERT INTO workforce_exception_cases("id","organizationId","agentId","workdayId","kind","detectorVersion","deduplicationKey","createdAt") SELECT 'limit-case-'||n,${orgA},${agent(orgA)},${workday(orgA)},'NO_SHOW','fixture-recorded-v1',md5('limit-case-'||n)||md5('case-proof-'||n),${window(7).startAt} FROM generate_series(1,5001) n`)
    await expect(read(7)).rejects.toMatchObject({code:"WORKFORCE_EXCEPTION_REPORT_LIMIT_EXCEEDED"})
  },30_000)

  it("fails closed at 5001 exact valid request proofs even when all belong to one case",async()=>{
    await owner(async tx=>{
      await createCase(tx,orgA,"limit-proof-case",window(8).startAt)
      // Bulk historical fixture import; exact links/status/enums/FKs/checks remain valid.
      // Avoid compatibility timestamp rewriting 5001 historical requests serially;
      // no current application insert/approval writer acceptance is claimed here.
      await tx.$executeRawUnsafe("ALTER TABLE mtm_hrm_requests DISABLE TRIGGER USER")
      await tx.$executeRaw`INSERT INTO mtm_hrm_requests("id","organizationId","agentId","clientRequestId","type","status","startDate","endDate","correctionWorkdayId","exceptionCaseId","exceptionCaseRevision","requestedStartAt","reason","submittedAt","updatedAt") SELECT 'limit-request-'||n,${orgA},${agent(orgA)},'limit-client-'||n,'TIME_CORRECTION'::"MtmHrmRequestType",'APPROVED'::"MtmHrmRequestStatus",'2025-01-01','2025-01-01',${workday(orgA)},'limit-proof-case',0,'2025-01-01T08:00:00','PRIVATE_FIXTURE_REASON','2025-01-01T09:00:00','2025-01-01T09:00:00' FROM generate_series(1,5001) n`
      await tx.$executeRawUnsafe("ALTER TABLE mtm_hrm_requests ENABLE TRIGGER USER")
      await tx.$executeRaw`INSERT INTO workforce_time_corrections("id","organizationId","agentId","workdayId","requestId","source","operationId","actorUserId","reason","beforeFacts","afterFacts","occurredAt") SELECT 'limit-ledger-'||n,${orgA},${agent(orgA)},${workday(orgA)},'limit-request-'||n,'REQUEST_APPROVAL'::"WorkforceTimeCorrectionSource",'limit-operation-'||n,${actor(orgA)},'PRIVATE_FIXTURE_REASON','{"fixtureBoundary":0}'::jsonb,'{"fixtureBoundary":1}'::jsonb,'2025-01-01T09:00:00' FROM generate_series(1,5001) n`
    })
    await expect(read(8)).rejects.toMatchObject({code:"WORKFORCE_EXCEPTION_REPORT_LIMIT_EXCEEDED"})
  },60_000)
})
