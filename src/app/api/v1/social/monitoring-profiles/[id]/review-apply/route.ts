import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import {
  applyDiscoveryAutoReviewPlan,
  DiscoveryAutoReviewApplyError,
} from "@/lib/social/discovery-auto-review-apply"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"

type RouteContext = { params: Promise<{ id: string }> }

const subjectIdSchema = z.string().trim().min(1).max(160)
const applySchema = z.object({
  idempotencyKey: z.string().uuid(),
  mode: z.enum(["REJECT_ONLY", "SAFE_RESOLVE"]),
  resolverVersion: z.string().trim().min(1).max(120),
  planFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedLinks: z.number().int().min(1).max(10_000),
  expectedRows: z.number().int().min(1).max(100_000),
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

  const subjectId = subjectIdSchema.safeParse((await context.params).id)
  if (!subjectId.success) {
    return NextResponse.json({ error: "invalid_monitoring_subject_id" }, { status: 400 })
  }
  const parsed = applySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_review_apply_request" }, { status: 400 })
  }

  try {
    const result = await applyDiscoveryAutoReviewPlan({
      organizationId: auth.orgId,
      subjectId: subjectId.data,
      requestedBy: auth.userId,
      ...parsed.data,
    })
    return NextResponse.json(
      { success: true, data: { run: result.run } },
      { status: result.idempotent ? 200 : 201 },
    )
  } catch (error) {
    if (error instanceof DiscoveryAutoReviewApplyError) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    console.error("[social-discovery-review-apply] failed", error)
    return NextResponse.json({ error: "review_apply_failed" }, { status: 500 })
  }
})
