import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { processSocialMonitoringRunJobs } from "@/lib/social/monitoring-run-job"
import { withJobLease } from "@/lib/cron/job-lease"
import { autoTriageStoredReviewEnvelopes } from "@/lib/social/automatic-review-backfill"

const CRON_WALL_CLOCK_BUDGET_MS = 10 * 60_000
const CRON_TOTAL_ITEM_BUDGET = 3
const AUTO_REVIEW_RESERVED_BUDGET_MS = 60_000
const AUTO_REVIEW_TICK_BUDGET_MS = 45_000
const AUTO_REVIEW_LIMIT = 25
const AUTO_REVIEW_AI_LIMIT = 10
const AUTO_REVIEW_LEASE_MS = 2 * 60_000
// Проход судьи (#646) ОТКЛЮЧЁН: на проде он вернул в ленту чужих тёзок, потому
// что не знал страну объекта. Подробности и условия возврата — в
// subject-relevance.ts у hasSecondSignal.

export async function POST(request: NextRequest) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  const organizationId = request.nextUrl.searchParams.get("organizationId")?.trim() || undefined
  const limit = Math.min(
    Math.max(Number.parseInt(request.nextUrl.searchParams.get("limit") || "5", 10) || 5, 1),
    20,
  )
  const maxItemsPerJob = Math.min(
    Math.max(Number.parseInt(request.nextUrl.searchParams.get("maxItemsPerJob") || "3", 10) || 3, 1),
    10,
  )

  try {
    const requestStartedAt = Date.now()
    const routeDeadlineAt = new Date(requestStartedAt + CRON_WALL_CLOCK_BUDGET_MS)
    const jobDeadlineAt = new Date(routeDeadlineAt.getTime() - AUTO_REVIEW_RESERVED_BUDGET_MS)
    const data = await runWithRlsBypass(async () => {
      const jobs = await processSocialMonitoringRunJobs({
        organizationId,
        limit,
        maxItemsPerJob,
        maxItemsTotal: CRON_TOTAL_ITEM_BUDGET,
        deadlineAt: jobDeadlineAt,
      })
      const automaticReviewDeadlineAt = new Date(Math.min(
        routeDeadlineAt.getTime(),
        Date.now() + AUTO_REVIEW_TICK_BUDGET_MS,
      ))
      const automaticReviewLease = await withJobLease(
        { name: "social-monitoring-automatic-review", ttlMs: AUTO_REVIEW_LEASE_MS },
        () => autoTriageStoredReviewEnvelopes({
          organizationId,
          limit: AUTO_REVIEW_LIMIT,
          aiLimit: AUTO_REVIEW_AI_LIMIT,
          deadlineAt: automaticReviewDeadlineAt,
        }),
      )
      return {
        ...jobs,
        automaticReview: automaticReviewLease.status === "completed"
          ? { status: "completed" as const, ...automaticReviewLease.value }
          : { status: "skipped" as const, reason: automaticReviewLease.reason },
      }
    })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[cron/social-monitoring-run-jobs] error", error)
    return NextResponse.json({ error: "Social monitoring run-job cron failed" }, { status: 500 })
  }
}
