import { Prisma } from "@prisma/client"
import type { WorkforceReconciliationSnapshot } from "@/lib/workforce/reconciliation"
import { assertWorkforceExportAuditRecord, type WorkforceExportAuditRecord } from "@/lib/workforce/reconciliation-export-audit"
import { assertWorkforceReconciliationScheduleSubjects } from "@/lib/workforce/reconciliation-schedule-subject"

export type WorkforceSweepTransaction = Pick<Prisma.TransactionClient, "$queryRaw"> & { $transaction?: never }
type Row = Record<string, unknown>
const PAGE = 128
const KIND_BYTES = 1_048_576
const TOTAL_BYTES = 4_194_304
const failure = (code: "INPUT_INVALID" | "CONTEXT_REQUIRED" | "READ_FAILED" | "OVERFLOW" | "SOURCE_INVALID" | "AUDIT_REFERENCE_INVALID") => new Error(`WORKFORCE_SWEEP_${code}`)
function id(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 191 }
function instant(value: unknown): Date {
  if (typeof value !== "string") throw failure("SOURCE_INVALID")
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw failure("SOURCE_INVALID")
  return date
}
function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw failure("SOURCE_INVALID")
  instant(`${value}T00:00:00.000Z`)
  return value
}

// Only fixed source-controlled SQL fragments enter Prisma.raw below.
function utc(column: string, day = false): string {
  return `CASE WHEN "${column}" IS NULL THEN NULL WHEN isfinite("${column}") AND extract(year FROM "${column}") BETWEEN 1 AND 9999 THEN to_char("${column}", '${day ? "YYYY-MM-DD" : 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'}') ELSE 'INVALID' END`
}
const scoped = `'id', "id", 'organizationId', "organizationId"`
const agent = `${scoped}, 'agentId', "agentId"`
const sources = [
  { kind: "workdays", table: "mtm_agent_workdays", fields: `${agent}, 'workDate', ${utc("workDate", true)}, 'startedAt', ${utc("startedAt")}` },
  { kind: "events", table: "mtm_agent_workday_events", fields: `${agent}, 'workdayId', "workdayId"` },
  { kind: "transitions", table: "workforce_site_transitions", fields: `${agent}, 'workdayId', "workdayId"` },
  { kind: "evidence", table: "workforce_attendance_evidence", fields: `${scoped}, 'workdayEventId', "workdayEventId", 'siteTransitionId', "siteTransitionId"` },
  { kind: "assessments", table: "workforce_evidence_assessments", fields: `${scoped}, 'evidenceId', "evidenceId"` },
  { kind: "exceptions", table: "workforce_exception_cases", fields: `${agent}, 'workdayId', "workdayId", 'workdayEventId', "workdayEventId", 'evidenceId', "evidenceId", 'segmentId', "segmentId", 'expectedWorkDate', ${utc("expectedWorkDate", true)}` },
  { kind: "approvals", table: "workforce_timesheet_approvals", fields: `${agent}, 'periodStart', ${utc("periodStart", true)}, 'periodEnd', ${utc("periodEnd", true)}, 'recordKind', "recordKind"::text, 'revision', "revision", 'supersedesId', "supersedesId", 'calculationVersion', "calculationVersion", 'rowsHash', "rowsHash", 'factsHash', "factsHash", 'rows', "rows", 'approvedAt', ${utc("approvedAt")}` },
  { kind: "exports", table: "mtm_audit_logs", fields: `${agent}, 'entityId', "entityId", 'action', "action", 'entity', "entity", 'metadataKind', "metadataKind", 'data', CASE WHEN jsonb_typeof("newData") = 'object' THEN jsonb_build_object('approvalId', "newData"->'approvalId', 'recordKind', "newData"->'recordKind', 'revision', "newData"->'revision', 'periodStart', "newData"->'periodStart', 'periodEnd', "newData"->'periodEnd', 'rowsHash', "newData"->'rowsHash', 'factsHash', "newData"->'factsHash', 'format', "newData"->'format', 'recipient', "newData"->'recipient') ELSE NULL END` },
] as const

/**
 * Entire visible tenant, not a date window: every kernel source is independently
 * enumerated, including orphan roots. Protected row keys stay inside this call.
 * One supplied authorized READ ONLY REPEATABLE READ transaction owns all pages.
 * Hard supported size: <=1000 rows and 1MiB/kind, <=4MiB total. Refuse, never truncate.
 * A later invocation must restart; no cross-transaction row cursor is accepted.
 */
export async function readWorkforceReconciliationSnapshot(
  tx: WorkforceSweepTransaction,
  organizationId: string,
): Promise<WorkforceReconciliationSnapshot> {
  if (!id(organizationId)) throw failure("INPUT_INVALID")
  if ("$transaction" in tx) throw failure("CONTEXT_REQUIRED")
  const raw: Record<keyof WorkforceReconciliationSnapshot, Row[]> = {
    workdays: [], events: [], transitions: [], evidence: [], assessments: [], exceptions: [], approvals: [], exports: [],
  }
  let totalBytes = 0
  for (const source of sources) {
    let previous: string | null = null
    let kindBytes = 0
    const seen = new Set<string>()
    for (;;) {
      let result: Array<{ count: number; bytes: bigint; context: boolean; records: Row[] | null }>
      try {
        result = await tx.$queryRaw<typeof result>(Prisma.sql`
          WITH roots AS MATERIALIZED (
            SELECT "id" AS key, jsonb_build_object(${Prisma.raw(source.fields)}) AS value
            FROM ${Prisma.raw(`"${source.table}"`)}
            WHERE "organizationId" = ${organizationId}
              AND (${previous}::text IS NULL OR "id" COLLATE "C" > ${previous}::text COLLATE "C")
              ${source.kind === "exports" ? Prisma.sql`AND ("action" = 'WORKFORCE_TIMESHEET_APPROVED_EXPORT_VIEWED' OR "metadataKind" = 'workforce_timesheet_export')` : Prisma.empty}
            ORDER BY "id" COLLATE "C" LIMIT ${PAGE}
          ), budget AS (
            SELECT count(*)::integer AS count,
              (COALESCE(sum(octet_length(value::text)), 0) + 2*count(*))::bigint AS bytes,
              COALESCE(bool_and(octet_length(value::text) <= ${source.kind === "exports" ? 4096 : KIND_BYTES}), true) AS fits
            FROM roots
          )
          SELECT count, bytes,
            (current_setting('transaction_isolation') IN ('repeatable read', 'serializable')
              AND current_setting('transaction_read_only') = 'on') AS context,
            CASE WHEN bytes <= ${KIND_BYTES} AND fits
              THEN COALESCE((SELECT jsonb_agg(value ORDER BY key COLLATE "C") FROM roots), '[]'::jsonb)
              ELSE NULL END AS records FROM budget
        `)
      } catch { throw failure("READ_FAILED") }
      const page = result[0]
      if (!page || result.length !== 1) throw failure("READ_FAILED")
      if (!page.context) throw failure("CONTEXT_REQUIRED")
      kindBytes += Number(page.bytes)
      totalBytes += Number(page.bytes)
      if (page.records === null || kindBytes > KIND_BYTES || totalBytes > TOTAL_BYTES
        || raw[source.kind].length + page.count > 1000) throw failure("OVERFLOW")
      if (page.records.length !== page.count || page.count > PAGE) throw failure("SOURCE_INVALID")
      for (const row of page.records) {
        if (!id(row.id) || row.organizationId !== organizationId || seen.has(row.id)) throw failure("SOURCE_INVALID")
        if (["workdays", "events", "transitions", "exceptions", "approvals"].includes(source.kind) && !id(row.agentId)) throw failure("SOURCE_INVALID")
        if (["events", "transitions"].includes(source.kind) && !id(row.workdayId)) throw failure("SOURCE_INVALID")
        if (source.kind === "assessments" && !id(row.evidenceId)) throw failure("SOURCE_INVALID")
        seen.add(row.id)
        for (const field of ["agentId", "workdayId", "workdayEventId", "siteTransitionId", "evidenceId", "segmentId", "supersedesId"]) {
          if (field in row && row[field] !== null && !id(row[field])) throw failure("SOURCE_INVALID")
        }
        raw[source.kind].push(row)
      }
      if (page.count < PAGE) break // includes the empty-page proof for exact multiples
      previous = page.records.at(-1)!.id as string
    }
  }
  for (const row of raw.workdays) { row.workDate = date(row.workDate); row.startedAt = instant(row.startedAt) }
  for (const row of raw.exceptions) { if (row.expectedWorkDate !== null) row.expectedWorkDate = date(row.expectedWorkDate) }
  for (const row of raw.approvals) {
    row.periodStart = instant(`${date(row.periodStart)}T00:00:00.000Z`)
    row.periodEnd = instant(`${date(row.periodEnd)}T00:00:00.000Z`)
    row.approvedAt = instant(row.approvedAt)
  }
  const snapshot = raw as unknown as WorkforceReconciliationSnapshot
  const approvalById = new Map(snapshot.approvals.map(row => [row.id, row]))
  const exports: WorkforceReconciliationSnapshot["exports"][number][] = []
  for (const row of raw.exports) {
    const audit = row as unknown as WorkforceExportAuditRecord
    assertWorkforceExportAuditRecord(audit)
    const root = approvalById.get(audit.data.approvalId)
    if (!root || root.agentId !== audit.agentId || root.revision !== audit.data.revision || root.recordKind !== audit.data.recordKind
      || root.periodStart.toISOString().slice(0, 10) !== audit.data.periodStart
      || root.periodEnd.toISOString().slice(0, 10) !== audit.data.periodEnd) throw failure("AUDIT_REFERENCE_INVALID")
    exports.push({ approvalId: root.id, organizationId, agentId: audit.agentId,
      approvalRowsHash: audit.data.rowsHash, approvalFactsHash: audit.data.factsHash })
  }
  const complete = { ...snapshot, exports }
  if (Buffer.byteLength(JSON.stringify(complete), "utf8") > TOTAL_BYTES
    || Buffer.byteLength(JSON.stringify(complete.approvals), "utf8") > KIND_BYTES) throw failure("OVERFLOW")
  await assertWorkforceReconciliationScheduleSubjects(tx, organizationId, complete)
  return complete
}
