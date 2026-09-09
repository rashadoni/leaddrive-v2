import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { getMtmSettings } from "@/lib/mtm-settings"
import { preparePharmacyPromotionReview } from "@/lib/mtm/pharmacy-promotion-review"
import { PharmacyPromotionReviewPreviewSchema } from "@/lib/mtm/pharmacy-promotion-validators"

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withMtmRlsAuth<RouteContext>("mtm", "write", async (req, auth, context) => {
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
  const { id } = await context.params
  const parsed = PharmacyPromotionReviewPreviewSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid review preview",
      code: "MTM_PHARMACY_REVIEW_INVALID",
    }, { status: 400 })
  }
  const execution = await prisma.mtmPharmacyPromotionExecution.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      ...(actor.scopedAgentIds === null ? {} : { agentId: { in: [...actor.scopedAgentIds] } }),
    },
    include: {
      formula: true,
      approvalPolicy: true,
      reviews: {
        select: { level: true, decision: true, reviewerAgentId: true, reviewerUserId: true },
      },
    },
  })
  if (!execution) return NextResponse.json({ error: "Not found" }, { status: 404 })
  try {
    const settings = await getMtmSettings(auth.orgId)
    const prepared = preparePharmacyPromotionReview({
      execution,
      actor,
      reviewerUserId: auth.userId,
      parameters: parsed.data,
      postingEnabled: settings.pharmacyPromotionPostingEnabled,
    })
    return NextResponse.json({
      success: true,
      data: {
        preview: prepared.preview,
        previewHash: prepared.previewHash,
        generatedAt: new Date(),
      },
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTM_PHARMACY_REVIEW_PREVIEW_FAILED"
    if (code.endsWith("_DENIED") || code === "MTM_PHARMACY_DISTINCT_REVIEWER_REQUIRED") {
      return NextResponse.json({ error: "Review is not permitted", code }, { status: 403 })
    }
    return NextResponse.json({ error: "Review preview is unavailable", code }, { status: 409 })
  }
})
