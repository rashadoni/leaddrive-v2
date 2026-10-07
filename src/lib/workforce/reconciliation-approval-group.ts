import type { PrismaClient } from "@prisma/client"
import type { WorkforceReconciliationSnapshot } from "@/lib/workforce/reconciliation"

type Approval = WorkforceReconciliationSnapshot["approvals"][number]
type StoredApproval = Omit<Approval, "periodStart" | "periodEnd" | "approvedAt"> & {
  periodStart: string
  periodEnd: string
  approvedAt: string
}

function id(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 191
}

function day(value: Date): string | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null
  const iso = value.toISOString()
  return /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(iso) ? iso.slice(0, 10) : null
}

/**
 * Dormant dependency reader; no runtime caller or cursor write. The supplied
 * client must already be authorized for this tenant. This does not set RLS or
 * bypass it. One SQL statement includes every visible revision of the exact
 * group, including ancestors and successors of the selected root.
 *
 * Completeness is limited to that statement's MVCC snapshot, not an entire
 * multi-page scan. More than 1,000 rows or 1 MiB of serialized approval-array JSON refuses
 * the group before any approval payload crosses the database boundary.
 */
export async function readWorkforceReconciliationApprovalGroup(
  db: Pick<PrismaClient, "$queryRaw">,
  input: {
    organizationId: string
    agentId: string
    periodStart: Date
    periodEnd: Date
    rootApprovalId: string
  },
): Promise<WorkforceReconciliationSnapshot["approvals"]> {
  // Capture caller-owned mutable dates and fields before the first await.
  const { organizationId, agentId, rootApprovalId } = input
  const periodStart = day(input.periodStart)
  const periodEnd = day(input.periodEnd)
  if (!id(organizationId) || !id(agentId) || !id(rootApprovalId)
    || !periodStart || !periodEnd || periodStart > periodEnd) {
    throw new Error("WORKFORCE_APPROVAL_GROUP_INPUT_INVALID")
  }

  let response: Array<{ count: number; bytes: bigint; rootPresent: boolean; approvals: StoredApproval[] | null }>
  try {
    response = await db.$queryRaw<typeof response>`
      WITH bounded AS MATERIALIZED (
        SELECT "id", "organizationId", "agentId",
          to_char("periodStart", 'YYYY-MM-DD') AS "periodStart",
          to_char("periodEnd", 'YYYY-MM-DD') AS "periodEnd",
          "recordKind"::text AS "recordKind", "revision", "supersedesId",
          "calculationVersion", "rowsHash", "factsHash", "rows",
          to_char("approvedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "approvedAt"
        FROM "workforce_timesheet_approvals"
        WHERE "organizationId" = ${organizationId} AND "agentId" = ${agentId}
          AND "periodStart" = ${periodStart}::date AND "periodEnd" = ${periodEnd}::date
        ORDER BY "revision", "id"
        LIMIT 1001
      ), budget AS (
        SELECT count(*)::integer AS count,
          (COALESCE(sum(octet_length(to_jsonb(bounded)::text)), 0) + 2 * count(*))::bigint AS bytes,
          COALESCE(bool_or("id" = ${rootApprovalId}), false) AS "rootPresent"
        FROM bounded
      )
      SELECT count, bytes, "rootPresent",
        CASE WHEN count <= 1000 AND bytes <= 1048576 AND "rootPresent"
          THEN (SELECT jsonb_agg(to_jsonb(bounded) ORDER BY "revision", "id") FROM bounded)
          ELSE NULL END AS approvals
      FROM budget
    `
  } catch {
    // Do not forward Prisma/SQL details, identifiers or stored payloads.
    throw new Error("WORKFORCE_APPROVAL_GROUP_READ_FAILED")
  }
  const result = response[0]
  if (!result || response.length !== 1) throw new Error("WORKFORCE_APPROVAL_GROUP_READ_FAILED")
  if (result.count > 1000 || result.bytes > BigInt(1048576)) {
    throw new Error("WORKFORCE_APPROVAL_GROUP_OVERFLOW")
  }
  if (!result.rootPresent || !result.approvals || result.approvals.length !== result.count) {
    throw new Error("WORKFORCE_APPROVAL_GROUP_UNAVAILABLE")
  }
  // Retain corrupt revision/hash/link values for the kernel; never repair them.
  return result.approvals.map((row) => ({
    ...row,
    periodStart: new Date(`${row.periodStart}T00:00:00.000Z`),
    periodEnd: new Date(`${row.periodEnd}T00:00:00.000Z`),
    approvedAt: new Date(row.approvedAt),
  }))
}
