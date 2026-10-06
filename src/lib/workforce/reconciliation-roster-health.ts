import type { PrismaClient } from "@prisma/client"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"

type Control = Pick<PrismaClient, "$transaction">
type Reason = "VISIBILITY_UNVERIFIED" | "ROSTER_LIMIT" | "PROJECTION_LIMIT" | "INVALID_SNAPSHOT" | "DATABASE_UNAVAILABLE"
const unavailable = (reason: Reason) => ({
  status: "UNKNOWN" as const, coverage: "UNAVAILABLE" as const, reason,
  alerts: ["RECONCILIATION_COVERAGE_UNAVAILABLE"],
})

function stringList(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === "string") {
    try { value = JSON.parse(value) } catch { return false }
  }
  return Array.isArray(value) && value.every(item => typeof item === "string")
}

function validEntitlement(row: Record<string, unknown>): boolean {
  return (row.plan == null || typeof row.plan === "string")
    && stringList(row.addons) && stringList(row.features)
    && (row.modules == null || (typeof row.modules === "object" && !Array.isArray(row.modules)
      && Object.values(row.modules).every(value => typeof value === "boolean")))
}

/** Dormant read-only diagnostic. Caller supplies an already-authorized control
 * client; this function never grants access or installs a monitoring transport.
 * A role subject to RLS is refused, even if a policy currently appears permissive.
 */
export async function readWorkforceEligibleRosterHealth(db: Control) {
  try {
    return await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`
      const visibility = await tx.$queryRaw<Array<{ visible: boolean }>>`
        SELECT NOT row_security_active('public.organizations'::regclass)
          AND NOT row_security_active('public.workforce_reconciliation_tenant_states'::regclass)
          AND (SELECT relkind = 'r' FROM pg_class WHERE oid = 'public.organizations'::regclass)
          AND (SELECT relkind = 'r' FROM pg_class WHERE oid = 'public.workforce_reconciliation_tenant_states'::regclass) AS visible
      `
      if (visibility.length !== 1 || visibility[0].visible !== true) return unavailable("VISIBILITY_UNVERIFIED")
      const rows = await tx.$queryRaw<Array<{ count: number; bytes: bigint; observedAt: string; records: Array<Record<string, unknown>> | null }>>`
        WITH roster AS MATERIALIZED (
          SELECT o.id, jsonb_build_object(
            'active', o."isActive", 'plan', o.plan, 'addons', o.addons, 'features', o.features, 'modules', o.modules,
            'tracked', s."organizationId" IS NOT NULL, 'attempted', s."lastAttemptAt" IS NOT NULL,
            'completed', s."lastCompletedAt" IS NOT NULL,
            'outcome', COALESCE(s."lastOutcome", 'NEVER'),
            'due', COALESCE(s."dueAt", o."createdAt") <= transaction_timestamp(),
            'staleCompletion', COALESCE(s."lastCompletedAt" < transaction_timestamp() - interval '2 hours', false),
            'invalid', s."organizationId" IS NOT NULL AND (s."dueAt" IS NULL OR s."lastOutcome" IS NULL
              OR (s."lastOutcome" = 'RUNNING' AND s."lastAttemptAt" IS NULL))
          ) AS value
          FROM public.organizations o
          LEFT JOIN public.workforce_reconciliation_tenant_states s ON s."organizationId" = o.id
          WHERE o."isActive" OR s."organizationId" IS NOT NULL
          ORDER BY o.id COLLATE "C" LIMIT 10001
        ), budget AS (
          SELECT count(*)::integer AS count, COALESCE(sum(octet_length(value::text)), 0)::bigint AS bytes FROM roster
        )
        SELECT count, bytes,
          to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "observedAt",
          CASE WHEN count <= 10000 AND bytes <= 4194304
            THEN COALESCE((SELECT jsonb_agg(value ORDER BY id COLLATE "C") FROM roster), '[]'::jsonb)
            ELSE NULL END AS records FROM budget
      `
      if (rows.length !== 1) return unavailable("INVALID_SNAPSHOT")
      const snapshot = rows[0]
      if (snapshot.count > 10000) return unavailable("ROSTER_LIMIT")
      if (snapshot.bytes > BigInt(4194304)) return unavailable("PROJECTION_LIMIT")
      if (!snapshot.records || snapshot.records.length !== snapshot.count) return unavailable("INVALID_SNAPSHOT")
      const counts = { eligible: 0, trackedEligible: 0, neverAttempted: 0, neverMatched: 0,
        running: 0, expiredAttempts: 0, failed: 0, due: 0, staleCompleted: 0, excludedTracked: 0 }
      const outcomes = ["NEVER", "RUNNING", "MATCHED", "MISMATCH", "INCOMPLETE", "FENCED_OUT", "VERSION_EXHAUSTED", "UNKNOWN"]
      for (const row of snapshot.records) {
        if (["active", "tracked", "attempted", "completed", "due", "staleCompletion", "invalid"].some(key => typeof row[key] !== "boolean")) return unavailable("INVALID_SNAPSHOT")
        if (row.active && !validEntitlement(row)) return unavailable("INVALID_SNAPSHOT")
        const eligible = row.active && isTenantCapabilityEnabled("workforce-hrm", row)
        if (!eligible) { if (row.tracked) counts.excludedTracked++; continue }
        if (row.invalid || typeof row.outcome !== "string" || !outcomes.includes(row.outcome)) return unavailable("INVALID_SNAPSHOT")
        counts.eligible++
        if (row.tracked) counts.trackedEligible++
        if (!row.attempted) counts.neverAttempted++
        if (!row.completed) counts.neverMatched++
        if (row.due) counts.due++
        if (row.staleCompletion) counts.staleCompleted++
        if (row.outcome === "RUNNING") { if (row.due) counts.expiredAttempts++; else counts.running++ }
        if (!["NEVER", "RUNNING", "MATCHED"].includes(row.outcome)) counts.failed++
      }
      const alerts = [
        ...(counts.neverAttempted ? ["RECONCILIATION_UNATTEMPTED"] : []),
        ...(counts.neverMatched ? ["RECONCILIATION_NEVER_MATCHED"] : []),
        ...(counts.failed ? ["RECONCILIATION_FAILURE"] : []),
        ...(counts.expiredAttempts || counts.staleCompleted ? ["RECONCILIATION_STALE"] : []),
      ]
      return { status: counts.eligible === 0 ? "NO_ELIGIBLE" as const : alerts.length ? "ATTENTION" as const : "CLEAR" as const,
        coverage: "ELIGIBLE_ROSTER_SNAPSHOT" as const, observedAt: snapshot.observedAt, counts, alerts }
    }, { isolationLevel: "RepeatableRead", timeout: 10000 })
  } catch { return unavailable("DATABASE_UNAVAILABLE") }
}
