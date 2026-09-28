import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { judgeAmbiguousAliasRejections } from "@/lib/social/ai-relevance-judge-pass"

/**
 * The relevance judge's background pass, which until now had no caller at all:
 * the code existed, was tested, and never ran, so nothing was ever restored to
 * a client's feed (2026-09-28).
 *
 * It only ever adds a second signal to records the string matcher already
 * rejected — a confident "about_subject" hands the row back to the live
 * relevance evaluation, and every other answer leaves it rejected. That makes
 * a late, repeated or overlapping tick harmless.
 *
 * The deadline keeps one tick inside its schedule: the pass stops asking when
 * it is reached and the remaining rows wait for the next one, rather than a
 * run stretching over the following tick.
 */
const TICK_BUDGET_MS = 60_000

export async function POST(req: NextRequest) {
  const authError = requireCronAuth(req)
  if (authError) return authError

  try {
    const result = await judgeAmbiguousAliasRejections({
      deadlineAt: new Date(Date.now() + TICK_BUDGET_MS),
    })
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error("[social relevance judge cron]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
