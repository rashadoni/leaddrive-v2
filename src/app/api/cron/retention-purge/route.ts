import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"

/**
 * Retention expiry for the two audit trails (F-08, and the schedule half of
 * F-10). Policy lives in docs/isms/ISMS-12-retention.md; this route enforces it.
 *
 * A retention period is an obligation in BOTH directions. Deleting early
 * destroys evidence; keeping past the period is the half everyone forgets, and
 * it is the half a regulator asks about — data no longer needed is nothing but
 * risk.
 *
 * Both tables are append-only by database trigger, so each delete has to opt in
 * through its own session flag. The flags are deliberately separate: a tenant
 * purge must not silently acquire the right to erase the compliance trail, and
 * scheduled expiry must not acquire the right to erase business audit rows
 * belonging to a live tenant.
 */

const AUDIT_LOG_RETENTION_DAYS = 3 * 365
const COMPLIANCE_LOG_RETENTION_DAYS = 3 * 365

/** Bounded per run so one sweep cannot lock the tables for minutes. */
const BATCH = 5_000

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const auditCutoff = cutoff(AUDIT_LOG_RETENTION_DAYS)
  const complianceCutoff = cutoff(COMPLIANCE_LOG_RETENTION_DAYS)

  try {
    // SET LOCAL scopes each flag to its own transaction, so neither escapes into
    // any other query on the pooled connection.
    const auditDeleted = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.audit_log_purge = 'on'`)
      return tx.$executeRawUnsafe(
        `DELETE FROM "audit_logs" WHERE id IN (
           SELECT id FROM "audit_logs" WHERE "createdAt" < $1 LIMIT ${BATCH}
         )`,
        auditCutoff,
      )
    }, { timeout: 120_000, maxWait: 10_000 })

    const complianceDeleted = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.compliance_audit_purge = 'on'`)
      return tx.$executeRawUnsafe(
        `DELETE FROM "compliance_audit_log" WHERE id IN (
           SELECT id FROM "compliance_audit_log" WHERE "occurredAt" < $1 LIMIT ${BATCH}
         )`,
        complianceCutoff,
      )
    }, { timeout: 120_000, maxWait: 10_000 })

    // Logged rather than silent: "nothing was deleted" and "the job never ran"
    // look identical otherwise, and the second is the one that matters.
    console.log(
      `[retention-purge] audit_logs=${auditDeleted} compliance_audit_log=${complianceDeleted} ` +
      `auditCutoff=${auditCutoff.toISOString()} complianceCutoff=${complianceCutoff.toISOString()}`
    )

    return NextResponse.json({
      success: true,
      data: {
        auditLogsDeleted: auditDeleted,
        complianceAuditLogDeleted: complianceDeleted,
        auditCutoff: auditCutoff.toISOString(),
        complianceCutoff: complianceCutoff.toISOString(),
        batchLimit: BATCH,
        // A full batch means more rows remain; the next run continues.
        moreLikely: auditDeleted >= BATCH || complianceDeleted >= BATCH,
      },
    })
  } catch (e) {
    console.error("[retention-purge] failed:", e)
    return NextResponse.json({ error: "Retention purge failed" }, { status: 500 })
  }
}
