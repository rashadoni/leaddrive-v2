
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const BASE = "409e4fc98f1522bf7f60a30941f26c9e36a2eb13"
const MIGRATION = "prisma/migrations/20261004201500_support_sla_calendar_snapshots/migration.sql"
const hash = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")
const check = (ok, code) => { if (!ok) throw new Error(code) }

function guard(outputDirectory) {
  const e = process.env
  check(e.CI === "true" && e.GITHUB_ACTIONS === "true" && e.SUPPORT_EVIDENCE_TARGET_MODE === "ephemeral"
    && e.SUPPORT_AUDIT_ACCEPTANCE === "ephemeral-audit-20261004-v1", "AUDIT_PG_CONTEXT")
  const url = new URL(e.DATABASE_URL || "")
  check(["postgresql:", "postgres:"].includes(url.protocol) && ["localhost", "127.0.0.1"].includes(url.hostname)
    && url.port === "5432" && url.pathname === "/support_ux_evidence" && url.username === "postgres"
    && !url.search && !url.hash, "AUDIT_PG_TARGET")
  const sha = e.GITHUB_SHA
  check(/^[a-f0-9]{40}$/.test(sha || "") && sha === e.SUPPORT_EVIDENCE_COMMIT
    && execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() === sha, "AUDIT_PG_SHA")
  const output = path.resolve("artifacts", "support-ux", sha)
  check(path.resolve(outputDirectory) === output, "AUDIT_PG_OUTPUT")
  return { url, sha, output }
}

// Invoke only from the independently authenticated ephemeral browser harness.
export async function runAuditPostgresEvidence({ admin, context, orgId, actorId, outputDirectory }) {
  const { url, sha, output } = guard(outputDirectory)
  const org = await admin.organization.findUnique({ where: { id: orgId }, select: { slug: true, name: true } })
  check(org?.slug === "support-evidence" && org.name === "Northstar Support Lab", "AUDIT_PG_DEMO")
  check(await admin.user.findFirst({ where: { id: actorId, organizationId: orgId, role: "admin" }, select: { id: true } }), "AUDIT_PG_ACTOR")
  const { PrismaClient } = await import("@prisma/client")
  const receipt = { version: 1, candidateHead: sha, baseSchemaCommit: BASE, status: "RUNNING", cases: [], cleanup: "NOT_RUN",
    limitations: ["Disposable service superuser; not a physical non-bypass-role RLS proof.", "No production data, backfill, external delivery or activation."] }
  let stage = "preflight", control, scratch, scratchName, temp
  let created = false, constraintTable = null, constraintName = null
  const tickets = [], macros = []
  const pass = (id, checks) => receipt.cases.push({ id, status: "PASS", checks })
  async function ddl(client, sql) {
    check(guard(outputDirectory).url.href === url.href, "AUDIT_PG_TARGET_CHANGED")
    return client.$executeRawUnsafe(sql)
  }
  async function apply(macroId, ticketId, requestId, actions, status = 200) {
    const res = await context.post(`/api/v1/ticket-macros/${macroId}/apply`, { data: { ticketId, requestId, expectedActions: actions }, timeout: 60_000 })
    check(res.status() === status, "AUDIT_MACRO_HTTP_STATUS")
    const body = await res.json()
    check(status === 200 ? body.success === true : body.code === "MACRO_APPLY_FAILED", "AUDIT_MACRO_HTTP_RESULT")
  }
  async function createCase(actions) {
    const ticketId = randomUUID(), macroId = randomUUID()
    await admin.ticket.create({ data: { id: ticketId, organizationId: orgId, ticketNumber: `AUDIT-PG-${ticketId}`, subject: "Synthetic transaction", status: "new", tags: ["preserve"] } })
    tickets.push(ticketId)
    await admin.ticketMacro.create({ data: { id: macroId, organizationId: orgId, name: "Synthetic transaction", actions, createdBy: actorId } })
    macros.push(macroId)
    return { ticketId, macroId }
  }
  async function state(ticketId, macroId) {
    return {
      ticket: await admin.ticket.findUnique({ where: { id: ticketId }, select: { status: true, tags: true } }),
      macro: await admin.ticketMacro.findUnique({ where: { id: macroId }, select: { usageCount: true } }),
      comments: await admin.ticketComment.findMany({ where: { ticketId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { comment: true, isInternal: true } }),
      audits: await admin.auditLog.findMany({ where: { organizationId: orgId, entityType: "ticket_macro_application", entityId: ticketId }, select: { id: true, newValue: true } }),
    }
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", BASE, sha], { stdio: "pipe" })
    const schema = execFileSync("git", ["show", `${BASE}:prisma/schema.prisma`], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })
    check(!schema.includes("slaCalendarSnapshot") && !schema.includes("businessCalendar"), "AUDIT_BASE_CHANGED")
    const migration = await readFile(MIGRATION, "utf8")
    const statements = migration.split("\n").filter(line => !line.trim().startsWith("--")).join("\n").split(";").map(s => s.trim()).filter(Boolean)
    check(statements.length === 2 && statements[0] === 'ALTER TABLE "sla_policies" ADD COLUMN "businessCalendar" JSONB'
      && statements[1] === 'ALTER TABLE "tickets" ADD COLUMN "slaCalendarSnapshot" JSONB', "AUDIT_MIGRATION_CHANGED")
    receipt.migrationSha256 = hash(migration); receipt.baseSchemaSha256 = hash(schema)
    const controlUrl = new URL(url); controlUrl.pathname = "/postgres"
    control = new PrismaClient({ datasourceUrl: controlUrl.href })
    scratchName = "support_audit_upgrade_" + randomBytes(12).toString("hex")
    const exists = await control.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${scratchName}) AS present`
    check(exists[0]?.present === false, "AUDIT_DB_ALREADY_EXISTS")
    stage = "upgrade-create-database"
    await ddl(control, `CREATE DATABASE "${scratchName}"`); created = true
    const scratchUrl = new URL(url); scratchUrl.pathname = "/" + scratchName
    scratch = new PrismaClient({ datasourceUrl: scratchUrl.href })
    await ddl(scratch, "CREATE EXTENSION IF NOT EXISTS vector")
    check(path.isAbsolute(process.env.RUNNER_TEMP || ""), "AUDIT_TEMP_REQUIRED")
    temp = await mkdtemp(path.join(process.env.RUNNER_TEMP, "support-audit-upgrade-"))
    const legacyFile = path.join(temp, "schema.prisma")
    await writeFile(legacyFile, schema, { mode: 0o600 })
    stage = "upgrade-full-base-schema"
    const setup = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--schema", legacyFile, "--skip-generate"], {
      env: { ...process.env, DATABASE_URL: scratchUrl.href }, encoding: "utf8", timeout: 240_000, maxBuffer: 2 * 1024 * 1024,
    })
    check(setup.status === 0 && !setup.error && !setup.signal, "AUDIT_SCHEMA_SETUP_FAILED")
    stage = "upgrade-seed-history"
    const historyOrg = randomUUID()
    await scratch.organization.create({ data: { id: historyOrg, name: "Synthetic migration history", slug: "audit-history-" + randomBytes(6).toString("hex") } })
    for (const status of ["open", "resolved", "closed"]) {
      await scratch.$executeRaw`
        INSERT INTO tickets (id, "organizationId", "ticketNumber", subject, status, "slaDueAt", "slaFirstResponseDueAt", "firstResponseAt", "resolvedAt", "closedAt", "updatedAt")
        VALUES (${randomUUID()}, ${historyOrg}, ${"HISTORY-" + status}, 'Synthetic preserved history', ${status},
          '2026-09-18T14:00:00Z'::timestamptz, '2026-09-18T10:00:00Z'::timestamptz,
          '2026-09-18T09:30:00Z'::timestamptz,
          ${status === "open" ? null : new Date("2026-09-18T13:45:00Z")},
          ${status === "closed" ? new Date("2026-09-18T15:00:00Z") : null},
          '2026-09-18T15:00:00Z'::timestamptz)`
    }
    for (const working of [true, false]) {
      await scratch.$executeRaw`INSERT INTO sla_policies (id, "organizationId", name, priority, "firstResponseHours", "resolutionHours", "businessHoursOnly")
        VALUES (${randomUUID()}, ${historyOrg}, 'Synthetic legacy SLA', ${working ? "high" : "low"}, 1.5, 4, ${working})`
    }
    const beforeT = await scratch.$queryRaw`SELECT to_jsonb(t) AS value FROM tickets t ORDER BY id`
    const beforeP = await scratch.$queryRaw`SELECT to_jsonb(p) AS value FROM sla_policies p ORDER BY id`
    stage = "upgrade-actual-migration"
    for (const sql of statements) await ddl(scratch, sql)
    const afterT = await scratch.$queryRaw`SELECT to_jsonb(t) - 'slaCalendarSnapshot' AS value FROM tickets t ORDER BY id`
    const afterP = await scratch.$queryRaw`SELECT to_jsonb(p) - 'businessCalendar' AS value FROM sla_policies p ORDER BY id`
    check(hash(beforeT) === hash(afterT) && hash(beforeP) === hash(afterP), "AUDIT_HISTORY_CHANGED")
    const newT = await scratch.ticket.findMany({ where: { organizationId: historyOrg }, select: { slaCalendarSnapshot: true, slaDueAt: true } })
    const newP = await scratch.slaPolicy.findMany({ where: { organizationId: historyOrg }, select: { businessCalendar: true } })
    check(newT.length === 3 && newT.every(r => r.slaCalendarSnapshot === null && r.slaDueAt?.toISOString() === "2026-09-18T14:00:00.000Z")
      && newP.length === 2 && newP.every(r => r.businessCalendar === null), "AUDIT_UPGRADE_DEFAULTS")
    const columns = await scratch.$queryRaw`SELECT is_nullable, column_default, data_type FROM information_schema.columns WHERE table_schema='public'
      AND ((table_name='tickets' AND column_name='slaCalendarSnapshot') OR (table_name='sla_policies' AND column_name='businessCalendar'))`
    check(columns.length === 2 && columns.every(r => r.is_nullable === "YES" && r.column_default === null && r.data_type === "jsonb"), "AUDIT_UPGRADE_COLUMNS")
    pass("actual-migration-preserves-history", { fullBaseSchema: true, actualMigration: true, historicalTickets: 3, historicalPolicies: 2,
      wholeRowsPreserved: true, nullSnapshots: true, currentClientReadsUpgrade: true, historicalStatuses: ["open", "resolved", "closed"] })

    stage = "macro-concurrent-replay"
    const actions = [{ type: "add_comment", value: "Synthetic concurrent public" }, { type: "add_internal_note", value: "Synthetic concurrent internal" }, { type: "add_tag", value: "audit-concurrent" }]
    const item = await createCase(actions), requestId = randomUUID()
    await Promise.all([apply(item.macroId, item.ticketId, requestId, actions), apply(item.macroId, item.ticketId, requestId, actions)])
    let result = await state(item.ticketId, item.macroId)
    check(result.macro.usageCount === 1 && result.comments.length === 2
      && result.comments.filter(r => r.isInternal).length === 1 && result.comments.filter(r => !r.isInternal).length === 1
      && result.audits.length === 1 && result.audits[0].id === "macro_" + hash([orgId, actorId, item.ticketId, requestId])
      && result.ticket.tags.filter(t => t === "audit-concurrent").length === 1, "AUDIT_CONCURRENT_DUPLICATE")
    check(Object.keys(result.audits[0].newValue).sort().join(",") === "actionTypes,macroId,requestDigest", "AUDIT_RECEIPT_CONTENT")
    const beforeReplay = hash(result)
    await apply(item.macroId, item.ticketId, requestId, actions)
    result = await state(item.ticketId, item.macroId)
    check(hash(result) === beforeReplay, "AUDIT_REPLAY_MUTATED")
    pass("same-id-concurrency-replay", { simultaneousRequests: 2, replayRequests: 1, publicComments: 1, internalNotes: 1, usageCount: 1, receipts: 1 })

    for (const point of ["audit", "usage"]) {
      stage = "macro-rollback-" + point
      const rollbackActions = [{ type: "add_comment", value: "Synthetic rollback public" }, { type: "set_status", value: "in_progress" }, { type: "add_tag", value: "must-rollback" }]
      const fixture = await createCase(rollbackActions)
      constraintName = "audit_failure_" + randomBytes(8).toString("hex")
      constraintTable = point === "audit" ? "audit_logs" : "ticket_macros"
      const expression = point === "audit" ? `"entityId" IS DISTINCT FROM '${fixture.ticketId}'` : `id <> '${fixture.macroId}' OR "usageCount" = 0`
      await ddl(admin, `ALTER TABLE "${constraintTable}" ADD CONSTRAINT "${constraintName}" CHECK (${expression})`)
      const before = await state(fixture.ticketId, fixture.macroId)
      const rollbackRequestId = randomUUID()
      try {
        await apply(fixture.macroId, fixture.ticketId, rollbackRequestId, rollbackActions, 500)
        check(hash(before) === hash(await state(fixture.ticketId, fixture.macroId)), "AUDIT_ROLLBACK_INCOMPLETE")
      } finally {
        await ddl(admin, `ALTER TABLE "${constraintTable}" DROP CONSTRAINT "${constraintName}"`)
        constraintName = null; constraintTable = null
      }
      stage = "macro-recovery-" + point
      await apply(fixture.macroId, fixture.ticketId, rollbackRequestId, rollbackActions)
      const recovered = await state(fixture.ticketId, fixture.macroId)
      check(recovered.ticket.status === "in_progress" && recovered.ticket.tags.includes("preserve")
        && recovered.ticket.tags.filter(tag => tag === "must-rollback").length === 1
        && recovered.comments.length === 1 && recovered.comments[0].isInternal === false
        && recovered.comments[0].comment === "Synthetic rollback public"
        && recovered.macro.usageCount === 1 && recovered.audits.length === 1
        && recovered.audits[0].id === "macro_" + hash([orgId, actorId, fixture.ticketId, rollbackRequestId]),
      "AUDIT_ROLLBACK_RECOVERY_FAILED")
      pass("rollback-at-" + point, { commentsRolledBack: true, ticketRolledBack: true, receiptRolledBack: true,
        usageUnchanged: true, sameRequestSucceedsAfterConstraintRemoved: true })
    }
    receipt.status = "PASS"
  } catch {
    receipt.status = "FAIL"; receipt.failureStage = stage
  } finally {
    try {
      if (constraintName) await ddl(admin, `ALTER TABLE "${constraintTable}" DROP CONSTRAINT "${constraintName}"`)
      if (tickets.length) {
        await admin.auditLog.deleteMany({ where: { organizationId: orgId, entityId: { in: tickets } } })
        await admin.ticketComment.deleteMany({ where: { ticketId: { in: tickets } } })
        await admin.ticket.deleteMany({ where: { organizationId: orgId, id: { in: tickets } } })
      }
      if (macros.length) await admin.ticketMacro.deleteMany({ where: { organizationId: orgId, id: { in: macros } } })
      await scratch?.$disconnect()
      if (created) await ddl(control, `DROP DATABASE "${scratchName}"`)
      receipt.cleanup = "PASS"
    } catch {
      receipt.cleanup = "FAIL"; receipt.status = "FAIL"
    } finally {
      await control?.$disconnect().catch(() => { receipt.cleanup = "FAIL"; receipt.status = "FAIL" })
      if (temp) await rm(temp, { recursive: true, force: true }).catch(() => { receipt.cleanup = "FAIL"; receipt.status = "FAIL" })
      receipt.finishedAt = new Date().toISOString()
      await mkdir(output, { recursive: true })
      await writeFile(path.join(output, "audit-postgres-evidence.json"), JSON.stringify(receipt, null, 2) + "\n")
    }
  }
  check(receipt.status === "PASS" && receipt.cleanup === "PASS" && receipt.cases.length === 4, "AUDIT_POSTGRES_EVIDENCE_FAILED")
  return { passed: true, caseCount: receipt.cases.length }
}
