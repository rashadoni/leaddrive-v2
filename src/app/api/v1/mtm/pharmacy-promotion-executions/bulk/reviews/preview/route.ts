import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { getMtmSettings } from "@/lib/mtm-settings"
import {
  pharmacyPromotionBulkReviewInclude,
  preparePharmacyPromotionBulkReview,
} from "@/lib/mtm/pharmacy-promotion-bulk-review"
import { PharmacyPromotionBulkReviewPreviewSchema } from "@/lib/mtm/pharmacy-promotion-validators"

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth) => {
  if (auth.principal === "mobile") {
    const forbidden = requireMobileCapability(auth, "TEAM_DECIDE")
    if (forbidden) return forbidden
  }
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })
  const parsed = PharmacyPromotionBulkReviewPreviewSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid bulk review preview",
      code: "MTM_PHARMACY_BULK_REVIEW_INVALID",
    }, { status: 400 })
  }
  const body = parsed.data
  const ids = [...body.executionIds].sort()
  const executions = await prisma.mtmPharmacyPromotionExecution.findMany({
    where: {
      id: { in: ids },
      organizationId: auth.orgId,
      ...(actor.scopedAgentIds === null ? {} : { agentId: { in: [...actor.scopedAgentIds] } }),
    },
    include: pharmacyPromotionBulkReviewInclude,
    orderBy: { id: "asc" },
  })
  // Privacy-safe: do not reveal which selected ID is outside tenant/scope.
  if (executions.length !== ids.length) return NextResponse.json({ error: "Not found" }, { status: 404 })
  try {
    const settings = await getMtmSettings(auth.orgId)
    const prepared = preparePharmacyPromotionBulkReview({
      executions,
      actor,
      reviewerUserId: auth.userId,
      level: body.level,
      decision: body.decision,
      reason: body.reason,
      postingEnabled: settings.pharmacyPromotionPostingEnabled,
    })
    return NextResponse.json({
      success: true,
      data: {
        preview: prepared.preview,
        previewHash: prepared.previewHash,
        selectionHash: prepared.selectionHash,
        versions: prepared.versions,
        generatedAt: new Date(),
      },
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTM_PHARMACY_BULK_REVIEW_PREVIEW_FAILED"
    if (code.endsWith("_DENIED") || code === "MTM_PHARMACY_DISTINCT_REVIEWER_REQUIRED") {
      return NextResponse.json({ error: "Bulk review is not permitted", code }, { status: 403 })
    }
    return NextResponse.json({ error: "Bulk review preview is unavailable", code }, { status: 409 })
  }
})
