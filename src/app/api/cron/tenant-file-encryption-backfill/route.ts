/**
 * Seals customer files uploaded before encryption at rest
 * (`src/lib/crypto/tenant-file-backfill.ts`).
 *
 *   cron-trigger.sh "/api/cron/tenant-file-encryption-backfill"                    → dry run, counts only
 *   cron-trigger.sh "/api/cron/tenant-file-encryption-backfill?apply=1&limit=2000" → seals up to 2000 files
 *
 * A dry run is the default: writing needs `apply=1`, and it is meant to run
 * after a fresh runtime-files backup. Each call seals at most `limit` files;
 * repeat while `hasMore` is true. Already sealed files are skipped, so
 * repeating or interrupting a run is safe.
 *
 * The tenant of every file comes from the same place its reader takes it:
 * the `<orgId>` directory for path-encoded uploads, the owning row for bare
 * stored names. Files without an owning row are counted, never touched.
 * Thumbnails run after photos, so a sealed cache entry stays newer than its
 * sealed original.
 *
 * The response carries counts only — no names, paths or tenants.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { isTenantPiiMasterKeyConfigured } from "@/lib/crypto/tenant-pii-encryption"
import { sealLegacyTenantFiles } from "@/lib/crypto/tenant-file-backfill"
import { tenantFileLocations } from "@/lib/crypto/tenant-file-locations"

const DEFAULT_LIMIT = 500
const HARD_CAP = 5000

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? Math.min(value, HARD_CAP) : DEFAULT_LIMIT
}

export async function POST(req: NextRequest) {
  // Owner lookups span every tenant; the bypass scope covers the whole run,
  // including each location's lazy `list()`.
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
    const report = await sealLegacyTenantFiles(tenantFileLocations(), { limit, dryRun })
    return NextResponse.json({ success: true, data: { ...report, limit } })
  } catch (error) {
    console.error("[cron/tenant-file-encryption-backfill] error:", error instanceof Error ? error.message : "unknown")
    return NextResponse.json({ error: "Backfill run failed" }, { status: 500 })
  }
  })
}
