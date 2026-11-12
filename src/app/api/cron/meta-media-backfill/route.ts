/**
 * Keeps the files of Instagram / Messenger messages that still hold Meta's link
 * (`backfillMetaMediaMessages` in `src/lib/inbox/meta-media.ts`).
 *
 *   cron-trigger.sh "/api/cron/meta-media-backfill"                  → dry run, counts only
 *   cron-trigger.sh "/api/cron/meta-media-backfill?apply=1&limit=50" → keeps up to 50 files
 *
 *   cron-trigger.sh "/api/cron/meta-media-backfill?mode=repair[&apply=1]"  → messages that kept
 *     Facebook's «unsupported browser» page instead of the file (#1567); the file is fetched again
 *
 * Writing needs `apply=1`. A kept message no longer matches, so repeating is safe; a link Meta no
 * longer serves stays and is counted as `failed`. The response carries counts only.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { isTenantPiiMasterKeyConfigured } from "@/lib/crypto/tenant-pii-encryption"
import { backfillMetaMediaMessages, repairMetaMediaMessages } from "@/lib/inbox/meta-media"

const DEFAULT_LIMIT = 50
const HARD_CAP = 500

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? Math.min(value, HARD_CAP) : DEFAULT_LIMIT
}

export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  if (!isTenantPiiMasterKeyConfigured()) {
    return NextResponse.json({ error: "TENANT_PII_MASTER_KEY is not configured" }, { status: 500 })
  }
  const url = new URL(req.url)
  try {
    const options = { dryRun: url.searchParams.get("apply") !== "1", limit: parseLimit(url.searchParams.get("limit")) }
    const report = url.searchParams.get("mode") === "repair"
      ? await repairMetaMediaMessages(options)
      : await backfillMetaMediaMessages(options)
    return NextResponse.json({ success: true, data: report })
  } catch (error) {
    console.error("[cron/meta-media-backfill] error:", error instanceof Error ? error.message : "unknown")
    return NextResponse.json({ error: "Backfill run failed" }, { status: 500 })
  }
}
