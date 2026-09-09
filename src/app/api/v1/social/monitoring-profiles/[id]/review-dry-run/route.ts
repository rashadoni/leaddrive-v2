import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { loadDiscoveryAutoReviewReport } from "@/lib/social/discovery-auto-review-report"
import { loadLatestDiscoveryAutoReviewRun } from "@/lib/social/discovery-auto-review-apply"

type RouteContext = { params: Promise<{ id: string }> }

const subjectIdSchema = z.string().trim().min(1).max(160)

/**
 * Read-only preview of the automatic discovery resolver.
 *
 * This route never calls a provider and never mutates an ingest envelope. It
 * lets an operator inspect the exact decision funnel and frozen fingerprint
 * before explicitly confirming the separate apply action.
 */
export const GET = withRlsAuth<RouteContext>("social", "read", async (
  _req: NextRequest,
  auth,
  context,
) => {
  const parsed = subjectIdSchema.safeParse((await context.params).id)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_monitoring_subject_id" }, { status: 400 })
  }

  const [report, latestRun] = await Promise.all([
    loadDiscoveryAutoReviewReport(auth.orgId, parsed.data),
    loadLatestDiscoveryAutoReviewRun(auth.orgId, parsed.data),
  ])
  if (!report) {
    return NextResponse.json({ error: "monitoring_subject_not_found" }, { status: 404 })
  }

  return NextResponse.json({ success: true, data: { ...report, latestRun } })
})
