import type { Prisma } from "@prisma/client"
import type { WorkforceReconciliationSnapshot } from "@/lib/workforce/reconciliation"
import { readWorkforceReconciliationApprovalGroup } from "@/lib/workforce/reconciliation-approval-group"

type ExportSnapshot = Pick<WorkforceReconciliationSnapshot, "approvals" | "exports">
// Excludes an ordinary pooled PrismaClient at the type boundary as well.
type ReadTransaction = Pick<Prisma.TransactionClient, "$queryRaw"> & { $transaction?: never }
export type WorkforceExportAuditRecord = {
  agentId: unknown; entityId: unknown; action: unknown; entity: unknown; metadataKind: unknown
  data: Record<string, unknown> | null
}
const ACTION = "WORKFORCE_TIMESHEET_APPROVED_EXPORT_VIEWED"
const KIND = "workforce_timesheet_export"
const invalid = () => new Error("WORKFORCE_EXPORT_AUDIT_INVALID")
function id(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 191
}
function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

type ValidatedAudit = WorkforceExportAuditRecord & {
  agentId: string; entityId: string
  data: { approvalId: string; periodStart: string; periodEnd: string; revision: number
    recordKind: "APPROVAL" | "CORRECTION"; rowsHash: string; factsHash: string
    format: "workforce-approved-timesheet-v1"; recipient: "SESSION_DIRECT_DOWNLOAD" }
}

/** Shared strict projection contract for window and full-sweep readers. */
export function assertWorkforceExportAuditRecord(audit: WorkforceExportAuditRecord): asserts audit is ValidatedAudit {
  const data = audit.data
  if (audit.action !== ACTION || audit.metadataKind !== KIND || audit.entity !== "workforce_timesheet_approval"
    || !id(audit.agentId) || !id(audit.entityId) || !data || !id(data.approvalId)
    || data.approvalId !== audit.entityId || !day(data.periodStart) || !day(data.periodEnd)
    || data.periodStart > data.periodEnd || !Number.isSafeInteger(data.revision) || (data.revision as number) < 1
    || !["APPROVAL", "CORRECTION"].includes(data.recordKind as string)
    || typeof data.rowsHash !== "string" || !/^[a-f0-9]{64}$/.test(data.rowsHash)
    || typeof data.factsHash !== "string" || !/^[a-f0-9]{64}$/.test(data.factsHash)
    || data.format !== "workforce-approved-timesheet-v1" || data.recipient !== "SESSION_DIRECT_DOWNLOAD") throw invalid()
}

/**
 * Dormant reader of prepared/audited direct downloads, NOT delivery receipts.
 * The caller must supply one authorized, read-only repeatable-read (or serializable)
 * transaction for every query, including group reads. This never establishes RLS.
 * A <=31-day window is accepted whole or refused: no pagination/cursor commit.
 * Roots come from audit records, not an inner join to surviving approvals.
 */
export async function readWorkforceReconciliationExportAuditWindow(
  tx: ReadTransaction,
  input: { organizationId: string; startInclusive: Date; endExclusive: Date },
): Promise<ExportSnapshot> {
  if ("$transaction" in tx) throw new Error("WORKFORCE_EXPORT_AUDIT_CONTEXT_REQUIRED")
  const { organizationId } = input
  const start = input.startInclusive instanceof Date ? input.startInclusive.getTime() : NaN
  const end = input.endExclusive instanceof Date ? input.endExclusive.getTime() : NaN
  if (!id(organizationId) || !Number.isFinite(start) || !Number.isFinite(end)
    || start >= end || end - start > 31 * 86_400_000
    || new Date(start).getUTCFullYear() < 1 || new Date(end).getUTCFullYear() > 9999) {
    throw new Error("WORKFORCE_EXPORT_AUDIT_INPUT_INVALID")
  }
  const startIso = new Date(start).toISOString()
  const endIso = new Date(end).toISOString()
  let result: Array<{ count: number; context: boolean; records: WorkforceExportAuditRecord[] | null }>
  try {
    result = await tx.$queryRaw<typeof result>`
      WITH roots AS MATERIALIZED (
        SELECT row_number() OVER (ORDER BY "createdAt", "id") AS ordinal,
          "agentId", "entityId", "action", "entity", "metadataKind",
          CASE WHEN jsonb_typeof("newData") = 'object' THEN jsonb_build_object(
            'approvalId', "newData"->'approvalId', 'recordKind', "newData"->'recordKind',
            'revision', "newData"->'revision', 'periodStart', "newData"->'periodStart',
            'periodEnd', "newData"->'periodEnd', 'rowsHash', "newData"->'rowsHash',
            'factsHash', "newData"->'factsHash', 'format', "newData"->'format',
            'recipient', "newData"->'recipient') ELSE NULL END AS data
        FROM "mtm_audit_logs"
        WHERE "organizationId" = ${organizationId}
          AND "createdAt" >= ${startIso}::timestamp AND "createdAt" < ${endIso}::timestamp
          AND ("action" = ${ACTION} OR "metadataKind" = ${KIND})
        ORDER BY "createdAt", "id" LIMIT 101
      ), budget AS (
        SELECT count(*)::integer AS count,
          COALESCE(bool_and(octet_length(to_jsonb(roots)::text) <= 4096), true) AS fits
        FROM roots
      )
      SELECT count,
        (current_setting('transaction_isolation') IN ('repeatable read', 'serializable')
          AND current_setting('transaction_read_only') = 'on') AS context,
        CASE WHEN count <= 100 AND fits
          THEN COALESCE((SELECT jsonb_agg(to_jsonb(roots) ORDER BY ordinal) FROM roots), '[]'::jsonb)
          ELSE NULL END AS records
      FROM budget
    `
  } catch {
    throw new Error("WORKFORCE_EXPORT_AUDIT_READ_FAILED")
  }
  const batch = result[0]
  if (!batch || result.length !== 1) throw new Error("WORKFORCE_EXPORT_AUDIT_READ_FAILED")
  if (!batch.context) throw new Error("WORKFORCE_EXPORT_AUDIT_CONTEXT_REQUIRED")
  if (batch.count > 100 || batch.records === null) throw new Error("WORKFORCE_EXPORT_AUDIT_OVERFLOW")
  if (batch.records.length !== batch.count) throw invalid()

  const approvals: ExportSnapshot["approvals"][number][] = []
  const exports: ExportSnapshot["exports"][number][] = []
  const groups = new Map<string, ExportSnapshot["approvals"]>()
  let approvalBytes = 0
  for (const audit of batch.records) {
    assertWorkforceExportAuditRecord(audit)
    const data = audit.data

    const key = JSON.stringify([audit.agentId, data.periodStart, data.periodEnd])
    let group = groups.get(key)
    if (!group) {
      // Missing/cross-scope roots refuse; they are never filtered out by a join.
      group = await readWorkforceReconciliationApprovalGroup(tx, {
        organizationId, agentId: audit.agentId, rootApprovalId: data.approvalId,
        periodStart: new Date(`${data.periodStart}T00:00:00.000Z`),
        periodEnd: new Date(`${data.periodEnd}T00:00:00.000Z`),
      })
      approvalBytes += Buffer.byteLength(JSON.stringify(group), "utf8")
      if (approvals.length + group.length > 1000 || approvalBytes > 1048576) {
        throw new Error("WORKFORCE_EXPORT_AUDIT_OVERFLOW")
      }
      groups.set(key, group)
      approvals.push(...group)
    }
    const root = group.find(row => row.id === data.approvalId)
    if (!root || root.revision !== data.revision || root.recordKind !== data.recordKind) throw invalid()
    exports.push({ approvalId: data.approvalId, organizationId, agentId: audit.agentId,
      approvalRowsHash: data.rowsHash, approvalFactsHash: data.factsHash })
  }
  return { approvals, exports }
}
