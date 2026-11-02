/**
 * Names Messenger / Instagram conversations that still show the sender's numeric id
 * (`src/lib/social/meta-sender-names-backfill.ts`).
 *
 *   cron-trigger.sh "/api/cron/meta-sender-names"                  → dry run: asks Meta, writes nothing, counts
 *   cron-trigger.sh "/api/cron/meta-sender-names?apply=1&limit=50" → writes the names it found
 *
 * Only digits are ever replaced by a name. Repeat while `hasMore`. The response carries counts only.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { backfillMetaSenderNames } from "@/lib/social/meta-sender-names-backfill"

const DEFAULT_LIMIT = 50
const HARD_CAP = 300

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? Math.min(value, HARD_CAP) : DEFAULT_LIMIT
}

export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const url = new URL(req.url)
  const dryRun = url.searchParams.get("apply") !== "1"
  const limit = parseLimit(url.searchParams.get("limit"))
  try {
    const report = await backfillMetaSenderNames({ dryRun, limit })
    return NextResponse.json({ success: true, data: { ...report, limit } })
  } catch (error) {
    console.error("[cron/meta-sender-names] error:", error instanceof Error ? error.message : "unknown")
    return NextResponse.json({ error: "Backfill run failed" }, { status: 500 })
  }
}
