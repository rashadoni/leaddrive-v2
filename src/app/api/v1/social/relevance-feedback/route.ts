import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import {
  getWeeklySocialRelevanceQualityReport,
  recordSocialRelevanceFeedback,
  SOCIAL_RELEVANCE_FEEDBACK_TYPES,
} from "@/lib/social/relevance-feedback"

const feedbackSchema = z.object({
  mentionId: z.string().trim().min(1).max(128),
  subjectId: z.string().trim().min(1).max(128),
  feedbackType: z.enum(SOCIAL_RELEVANCE_FEEDBACK_TYPES),
})

const reportQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(52).default(12),
  subjectId: z.string().trim().min(1).max(128).optional(),
  platform: z.string().trim().min(1).max(40).optional(),
})

export const POST = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth) => {
  const parsed = feedbackSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid relevance feedback" }, { status: 400 })
  }

  try {
    const feedback = await recordSocialRelevanceFeedback(auth.orgId, auth.userId, parsed.data)
    await logAudit(
      auth.orgId,
      "upsert",
      "social_relevance_feedback",
      feedback.id,
      `${parsed.data.feedbackType}:${parsed.data.mentionId}:${parsed.data.subjectId}`,
    )
    return NextResponse.json({ success: true, data: feedback }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record relevance feedback"
    const status = message.endsWith("not found") ? 404 : 400
    return NextResponse.json({ error: message }, { status })
  }
})

export const GET = withRlsAuth("social", "read", async (req: NextRequest, auth) => {
  const parsed = reportQuerySchema.safeParse({
    weeks: req.nextUrl.searchParams.get("weeks") ?? undefined,
    subjectId: req.nextUrl.searchParams.get("subjectId") ?? undefined,
    platform: req.nextUrl.searchParams.get("platform") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid report query" }, { status: 400 })
  }

  const since = new Date(Date.now() - parsed.data.weeks * 7 * 24 * 60 * 60 * 1000)
  const report = await getWeeklySocialRelevanceQualityReport(auth.orgId, since, {
    subjectId: parsed.data.subjectId,
    platform: parsed.data.platform,
  })
  return NextResponse.json({ success: true, data: report })
})
