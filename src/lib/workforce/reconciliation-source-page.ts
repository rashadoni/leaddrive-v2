import { Prisma } from "@prisma/client"
import type { WorkforceReconciliationSnapshot } from "@/lib/workforce/reconciliation"
import { workforceReconciliationSources, type WorkforceSweepTransaction } from "@/lib/workforce/reconciliation-snapshot"
import { assertWorkforceExportAuditRecord, type WorkforceExportAuditRecord } from "@/lib/workforce/reconciliation-export-audit"

export type WorkforceSourceKind = keyof WorkforceReconciliationSnapshot
export type WorkforceSourceRow = Record<string, unknown>
export const validSourceId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 191
const fail = () => new Error("WORKFORCE_DENSE_SOURCE_INVALID")
function instant(value: unknown): Date {
  if (typeof value !== "string") throw fail()
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw fail()
  return date
}
export function sourceDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail()
  instant(`${value}T00:00:00.000Z`)
  return value
}

/** Protected projection, same authorized snapshot; missing ID lookups remain absent. */
export async function readWorkforceSourceRows(tx: WorkforceSweepTransaction, organizationId: string, kind: WorkforceSourceKind,
  input: { after?: string | null; limit?: number; ids?: readonly string[] } = {}): Promise<WorkforceSourceRow[]> {
  const limit = input.limit ?? 128
  if (!validSourceId(organizationId) || !Number.isInteger(limit) || limit < 1 || limit > 1000
    || (input.after != null && !validSourceId(input.after))
    || (input.ids && (input.ids.length > 1000 || input.ids.some(id => !validSourceId(id))))) throw fail()
  if ("$transaction" in tx) throw new Error("WORKFORCE_DENSE_CONTEXT_REQUIRED")
  if (input.ids?.length === 0) return []
  const source = workforceReconciliationSources.find(s => s.kind === kind)
  if (!source) throw fail()
  let result: Array<{ count: number; context: boolean; records: WorkforceSourceRow[] | null }>
  try {
    result = await tx.$queryRaw<typeof result>(Prisma.sql`
      WITH roots AS MATERIALIZED (
        SELECT id AS key, jsonb_build_object(${Prisma.raw(source.fields)}) AS value
        FROM ${Prisma.raw(`"${source.table}"`)} WHERE "organizationId" = ${organizationId}
        ${input.ids ? Prisma.sql`AND id IN (${Prisma.join(input.ids)})` : input.after == null ? Prisma.empty : Prisma.sql`AND id COLLATE "C" > ${input.after}::text COLLATE "C"`}
        ${kind === "exports" ? Prisma.sql`AND (action = 'WORKFORCE_TIMESHEET_APPROVED_EXPORT_VIEWED' OR "metadataKind" = 'workforce_timesheet_export')` : Prisma.empty}
        ORDER BY id COLLATE "C" LIMIT ${limit}
      ), budget AS (
        SELECT count(*)::integer AS count,
          COALESCE(sum(octet_length(value::text)),0)+2*count(*) AS bytes,
          COALESCE(bool_and(octet_length(value::text) <= ${kind === "exports" ? 4096 : 1048576}),true) AS fits FROM roots
      )
      SELECT count, (current_setting('transaction_read_only')='on' AND current_setting('transaction_isolation') IN ('repeatable read','serializable')) AS context,
        CASE WHEN bytes <= 1048576 AND fits THEN COALESCE((SELECT jsonb_agg(value ORDER BY key COLLATE "C") FROM roots),'[]'::jsonb) ELSE NULL END AS records FROM budget
    `)
  } catch { throw new Error("WORKFORCE_DENSE_READ_FAILED") }
  const page = result[0]
  if (!page || result.length !== 1 || !page.context) throw new Error("WORKFORCE_DENSE_CONTEXT_REQUIRED")
  if (page.records === null) throw new Error("WORKFORCE_DENSE_PAGE_OVERFLOW")
  if (page.records.length !== page.count || page.count > limit) throw fail()
  const seen = new Set<string>()
  for (const row of page.records) {
    if (!validSourceId(row.id) || row.organizationId !== organizationId || seen.has(row.id)) throw fail()
    seen.add(row.id)
    if (["workdays","events","transitions","exceptions","approvals"].includes(kind) && !validSourceId(row.agentId)) throw fail()
    if (["events","transitions"].includes(kind) && !validSourceId(row.workdayId)) throw fail()
    if (kind === "assessments" && !validSourceId(row.evidenceId)) throw fail()
    for (const key of ["agentId","workdayId","workdayEventId","siteTransitionId","evidenceId","segmentId","supersedesId"]) {
      if (key in row && row[key] !== null && !validSourceId(row[key])) throw fail()
    }
    if (kind === "workdays") { row.workDate = sourceDate(row.workDate); row.startedAt = instant(row.startedAt) }
    if (kind === "exceptions" && row.expectedWorkDate !== null) row.expectedWorkDate = sourceDate(row.expectedWorkDate)
    if (kind === "approvals") {
      row.periodStart = instant(`${sourceDate(row.periodStart)}T00:00:00.000Z`)
      row.periodEnd = instant(`${sourceDate(row.periodEnd)}T00:00:00.000Z`)
      row.approvedAt = instant(row.approvedAt)
    }
    if (kind === "exports") assertWorkforceExportAuditRecord(row as unknown as WorkforceExportAuditRecord)
  }
  return page.records
}
