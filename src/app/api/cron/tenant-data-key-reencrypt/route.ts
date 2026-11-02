/**
 * Moves PII written under the derived tenant key (v1 column values, "t1" file
 * envelopes) to each organization's stored data key (v2, "d<N>"), stage 2b of
 * PII encryption (`src/lib/crypto/tenant-data-keys.ts`).
 *
 *   cron-trigger.sh "/api/cron/tenant-data-key-reencrypt"                    → dry run, counts only
 *   cron-trigger.sh "/api/cron/tenant-data-key-reencrypt?apply=1&limit=2000" → rewrites up to 2000 values and 2000 files
 *
 * A dry run is the default and writes nothing; it does not even create data
 * keys. Writing needs `apply=1` and is meant to run after a fresh database
 * and runtime-files backup, on the owner's word. Each call rewrites at most
 * `limit` column values and `limit` files; repeat while `hasMore` is true.
 * Every rewrite checks that the row still holds what was read and every file
 * is replaced atomically after a verified round trip, so repeating or
 * interrupting a run is safe.
 *
 * The response carries counts only: totals, and what is left on the derived
 * key per organization (organization ids and numbers — no names, values or
 * paths). `appendOnlyColumns` are v1 values in tables whose rows a trigger
 * forbids rewriting; they stay readable under the derived key.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { isTenantPiiMasterKeyConfigured } from "@/lib/crypto/tenant-pii-encryption"
import { countV1ColumnValues, emptyColumnSweepCounts, reencryptTenantColumns } from "@/lib/crypto/tenant-data-key-reencrypt"
import { rekeyTenantFiles } from "@/lib/crypto/tenant-file-backfill"
import { tenantFileLocations } from "@/lib/crypto/tenant-file-locations"

const DEFAULT_LIMIT = 500
const HARD_CAP = 5000

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? Math.min(value, HARD_CAP) : DEFAULT_LIMIT
}

export async function POST(req: NextRequest) {
  // Every organization's rows and files; the bypass scope covers the run. Key
  // loads open their own per-organization scope.
  return runWithRlsBypass(async () => {
    const cronError = requireCronAuth(req)
    if (cronError) return cronError

    if (!isTenantPiiMasterKeyConfigured()) {
      return NextResponse.json({ error: "TENANT_PII_MASTER_KEY is not configured" }, { status: 500 })
    }

    const url = new URL(req.url)
    const dryRun = url.searchParams.get("apply") !== "1"
    const limit = parseLimit(url.searchParams.get("limit"))

    try {
      const columns = dryRun ? { hasMore: false, counts: emptyColumnSweepCounts() } : await reencryptTenantColumns({ limit })
      const files = await rekeyTenantFiles(tenantFileLocations(), { limit, dryRun })
      const left = await countV1ColumnValues()

      const organizations: Record<string, { columns: number; appendOnlyColumns: number; files: number }> = {}
      const row = (orgId: string) => (organizations[orgId] ??= { columns: 0, appendOnlyColumns: 0, files: 0 })
      for (const [orgId, n] of left.rewritable) row(orgId).columns = n
      for (const [orgId, n] of left.appendOnly) row(orgId).appendOnlyColumns = n
      for (const [orgId, n] of Object.entries(files.derivedKeyFilesByOrganization)) row(orgId).files = n

      return NextResponse.json({
        success: true,
        data: {
          dryRun,
          limit,
          hasMore: columns.hasMore || files.hasMore,
          columns: columns.counts,
          files: files.totals,
          remainingOnDerivedKey: organizations,
        },
      })
    } catch (error) {
      console.error("[cron/tenant-data-key-reencrypt] error:", error instanceof Error ? error.message : "unknown")
      return NextResponse.json({ error: "Re-encryption run failed" }, { status: 500 })
    }
  })
}
