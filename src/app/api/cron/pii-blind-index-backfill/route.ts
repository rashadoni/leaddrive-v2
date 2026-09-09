/**
 * Slice-3 blind-index backfill cron.
 *
 * Drains rows where `<col>BlindIndex IS NULL` across the four wired
 * entities (citizens, health_patients, policy_holders, beneficiaries),
 * computes the HMAC via `blindIndexForTenant`, and writes it back.
 * See `src/lib/crypto/blind-index-backfill.ts` for the pure helper.
 *
 * Scheduling:
 *   • Hourly is appropriate while a fresh wave of legacy rows is in
 *     play. After the first 24h the WHERE filter returns near-empty
 *     and the cron's a no-op.
 *   • Each run caps at `maxRowsPerEntity` rows (default 200) per
 *     table so the request stays inside Vercel's 30s budget. If
 *     `hasMore: true` is in the response, schedule the next run
 *     immediately rather than waiting for the hourly tick.
 *
 * Safety:
 *   • Bearer-style cron secret via `x-cron-secret` or
 *     `Authorization: Bearer ...`. Mirrors the other cron routes.
 *   • `TENANT_PII_MASTER_KEY` must be set or `softDecryptForTenant`
 *     fails — we surface that as a 500 rather than silently writing
 *     bogus hashes.
 *   • No PHI / PII in the response — only counts.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import {
  runBlindIndexBackfill,
  type BackfillTable,
} from "@/lib/crypto/blind-index-backfill"
import {
  recordComplianceAccess,
  type ComplianceRecordType,
} from "@/lib/audit/compliance-audit"
import { runWithRlsBypass } from "@/lib/rls-context"

const DEFAULT_MAX_PER_ENTITY = 200
const HARD_CAP = 1000

/**
 * Map physical table → compliance record-type. Drives the audit-log
 * `recordType` so HIPAA / state DOI / FOIA queries against the log
 * can filter by jurisdiction.
 *
 *   • citizens  → R8 public-sector  → FOIA
 *   • health_patients → R2 health   → PHI (HIPAA)
 *   • policy_holders + beneficiaries → R7 insurance → PII (state DOI)
 */
const RECORD_TYPE: Record<BackfillTable, ComplianceRecordType> = {
  citizens: "foia",
  health_patients: "phi",
  policy_holders: "pii",
  beneficiaries: "pii",
}

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  if (!process.env.TENANT_PII_MASTER_KEY) {
    // softDecryptForTenant would still happily return raw plaintext as
    // a fallback — but blindIndexForTenant requires the key, so without
    // it every backfill write would error inside the loop. Fail fast.
    return NextResponse.json(
      { error: "TENANT_PII_MASTER_KEY is not configured" },
      { status: 500 },
    )
  }

  const url = new URL(req.url)
  const limitRaw = url.searchParams.get("maxRowsPerEntity")
  const maxRowsPerEntity = (() => {
    if (!limitRaw) return DEFAULT_MAX_PER_ENTITY
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return DEFAULT_MAX_PER_ENTITY
    return Math.min(n, HARD_CAP)
  })()

  try {
    const result = await runBlindIndexBackfill(prisma, { maxRowsPerEntity })

    // HIPAA / state DOI / FOIA traceability: write one
    // compliance_audit_log row per (entity × tenant) with the count
    // of rows the system touched. `action: "write"` because the
    // column value did change; `metadata.systemBackfill: true` so
    // forensic queries can distinguish "system reconciled an index"
    // from "a user wrote new data".
    //
    // Use `Promise.allSettled` (not `Promise.all` + not bare `void`):
    //   • allSettled — one tenant's audit failure does NOT block the
    //     others. Compliance gap on a single tenant is preferable to
    //     a compliance gap on all tenants because one of them errored.
    //   • Not bare `void` — that creates unhandled rejections that
    //     leak as console noise + miss the `await`-style structured
    //     error handling. With allSettled we surface failures inline
    //     and count them.
    //   • `recordComplianceAccess` is internally try/catch + returns
    //     null on failure (helper contract), so rejections here are
    //     rare — usually only on a Prisma-client-level outage that
    //     would also break the main backfill.
    const auditTasks: Array<Promise<string | null>> = []
    for (const entity of result.perEntity) {
      const recordType = RECORD_TYPE[entity.table]
      // Slice-3 ext: each (table × column) gets its own audit row.
      // Column name surfaces in metadata so a forensic query can
      // distinguish "fullNameBlindIndex backfill" from "taxIdBlindIndex
      // backfill" on the same table. Use template-literal derivation
      // (not a ternary) so adding a new `BackfillColumn` value
      // automatically derives the right index-column name without
      // needing to update this site.
      const indexColumn = `${entity.column}BlindIndex`
      for (const [orgId, count] of Object.entries(entity.updatedByOrg)) {
        if (count <= 0) continue
        auditTasks.push(
          recordComplianceAccess({
            organizationId: orgId,
            userId: null, // system-cron path — see schema comment
            action: "write",
            recordType,
            recordTable: entity.table,
            recordId: null, // batch operation, not single-row
            metadata: {
              // Forensic discriminator: filter audit rows where the
              // mutation came from the slice-3 reconciliation cron
              // vs an operator-driven write. `compliance_audit_log`
              // already records `occurredAt`, so no redundant
              // timestamp here.
              systemBackfill: true,
              column: indexColumn,
              rowsUpdated: count,
            },
          }),
        )
      }
    }
    const auditResults = await Promise.allSettled(auditTasks)
    const auditWritesEnqueued = auditTasks.length
    const auditWritesSucceeded = auditResults.filter(
      (r) => r.status === "fulfilled" && r.value !== null,
    ).length
    const auditWritesFailed = auditWritesEnqueued - auditWritesSucceeded
    if (auditWritesFailed > 0) {
      console.error(
        `[cron/pii-blind-index-backfill] ${auditWritesFailed}/${auditWritesEnqueued} audit writes failed`,
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        maxRowsPerEntity,
        auditWritesEnqueued,
        auditWritesSucceeded,
        auditWritesFailed,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error("[cron/pii-blind-index-backfill] error:", err)
    return NextResponse.json(
      { error: "Backfill run failed" },
      { status: 500 },
    )
  }
  })
}
