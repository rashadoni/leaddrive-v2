/**
 * Brings into the CRM the replies a team typed in the Instagram app before the webhook kept them
 * (`backfillInstagramAppReplies` in `src/lib/inbox/instagram-app-replies-backfill.ts`).
 *
 *   cron-trigger.sh "/api/cron/instagram-app-replies-backfill?org=<id>&since=2026-11-11"          → counts only
 *   cron-trigger.sh "/api/cron/instagram-app-replies-backfill?org=<id>&since=2026-11-11&apply=1"  → writes
 *
 * One organisation per run, named explicitly; `since` no further back than 14 days. Writing needs
 * `apply=1`. A reply already in the CRM is recognised, so repeating is safe. Counts only in the answer.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { BACKFILL_MAX_DAYS, backfillInstagramAppReplies } from "@/lib/inbox/instagram-app-replies-backfill"

export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  const url = new URL(req.url)
  const organizationId = url.searchParams.get("org")?.trim()
  const since = new Date(url.searchParams.get("since") ?? "")
  if (!organizationId) return NextResponse.json({ error: "org is required" }, { status: 400 })
  if (Number.isNaN(since.getTime()) || since.getTime() > Date.now()
    || since.getTime() < Date.now() - BACKFILL_MAX_DAYS * 86_400_000) {
    return NextResponse.json({ error: `since must be a date within the last ${BACKFILL_MAX_DAYS} days` }, { status: 400 })
  }
  try {
    const report = await backfillInstagramAppReplies({
      organizationId, since, dryRun: url.searchParams.get("apply") !== "1",
    })
    return NextResponse.json({ success: true, data: report })
  } catch (error) {
    console.error("[cron/instagram-app-replies-backfill] error:", error instanceof Error ? error.message : "unknown")
    return NextResponse.json({ error: "Backfill run failed" }, { status: 500 })
  }
}
