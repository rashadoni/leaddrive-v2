import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { withJobLease } from "@/lib/cron/job-lease"
import { runWithRlsBypass } from "@/lib/rls-context"
import { runInboxLearning } from "@/lib/inbox/learning/run"

/**
 * Inbox AI training (lib/inbox/learning/run): every five minutes, in the jobs process. One run at a
 * time — two would draft the same answer twice and pay for it twice.
 */
export async function POST(req: NextRequest) {
  const authError = requireCronAuth(req)
  if (authError) return authError
  try {
    const result = await runWithRlsBypass(() =>
      withJobLease({ name: "inbox-learning", ttlMs: 15 * 60_000 }, () => runInboxLearning({ now: new Date() })),
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[inbox-learning cron]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
