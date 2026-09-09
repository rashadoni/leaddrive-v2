import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import {
  DiscoveryAutoReviewApplyError,
  rollbackDiscoveryAutoReviewRun,
} from "@/lib/social/discovery-auto-review-apply"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"

type RouteContext = { params: Promise<{ id: string; runId: string }> }

const idSchema = z.string().trim().min(1).max(160)
const rollbackSchema = z.object({
  idempotencyKey: z.string().uuid(),
}).strict()

export const POST = withSocialMonitoringMutationFence<RouteContext>("social", "write", async (
  req: NextRequest,
  auth,
  context,
) => {
  if (!["admin", "superadmin"].includes(auth.role)) {
    return NextResponse.json({ error: "admin_required" }, { status: 403 })
  }
  const guard = guardInteractiveJsonMutation(req)
  if (guard) return guard

  const params = await context.params
  const subjectId = idSchema.safeParse(params.id)
  const runId = idSchema.safeParse(params.runId)
  if (!subjectId.success || !runId.success) {
    return NextResponse.json({ error: "invalid_review_apply_run_id" }, { status: 400 })
  }
  const parsed = rollbackSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_review_rollback_request" }, { status: 400 })
  }

  try {
    const result = await rollbackDiscoveryAutoReviewRun({
      organizationId: auth.orgId,
      subjectId: subjectId.data,
      runId: runId.data,
      requestedBy: auth.userId,
      idempotencyKey: parsed.data.idempotencyKey,
    })
    return NextResponse.json({ success: true, data: { run: result.run } })
  } catch (error) {
    if (error instanceof DiscoveryAutoReviewApplyError) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    console.error("[social-discovery-review-rollback] failed", error)
    return NextResponse.json({ error: "review_apply_rollback_failed" }, { status: 500 })
  }
})
