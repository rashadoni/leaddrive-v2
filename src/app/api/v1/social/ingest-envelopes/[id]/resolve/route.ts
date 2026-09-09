import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { replayIngestEnvelope } from "@/lib/social/ingest-envelope-replay"
import { isOperatorActionableReviewEnvelope } from "@/lib/social/review-queue-policy"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"

const resolveSchema = z.object({
  action: z.enum(["accept", "reject"]),
  subjectId: z.string().trim().min(1).max(200).optional(),
})

/**
 * Operator resolution for REVIEW envelopes. Accept is an explicit review
 * override routed through the shared replay boundary (no provider fetch);
 * reject scrubs transient content the same way rejected observations are
 * stored — only status/reason/audit evidence survives.
 */
export const POST = withSocialMonitoringMutationFence("social", "write", async (
  req: NextRequest,
  auth,
  context: { params: Promise<{ id: string }> },
) => {
  const { id } = await context.params
  if (!id?.trim()) return NextResponse.json({ error: "Ingest envelope id is required" }, { status: 400 })
  const parsed = resolveSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid resolve action" }, { status: 400 })
  }

  const envelope = await prisma.ingestEnvelope.findFirst({
    where: { organizationId: auth.orgId, id },
    select: {
      id: true,
      acceptedMentionId: true,
      relevanceStatus: true,
      relevanceReason: true,
      contentKind: true,
      relevanceConfidence: true,
      purgedAt: true,
      purgeAt: true,
      updatedAt: true,
      discoveryAutoReviewDecisions: {
        where: { state: "SUPPRESSED" },
        select: { id: true },
        take: 1,
      },
    },
  })
  if (!envelope) return NextResponse.json({ error: "Ingest envelope not found" }, { status: 404 })
  if (envelope.discoveryAutoReviewDecisions.length > 0) {
    return NextResponse.json(
      { error: "review_apply_rollback_required" },
      { status: 409 },
    )
  }
  if (envelope.purgedAt || envelope.purgeAt <= new Date()) {
    return NextResponse.json({ error: "Ingest envelope has expired" }, { status: 409 })
  }
  if (
    envelope.relevanceStatus === "REVIEW"
    && !isOperatorActionableReviewEnvelope(envelope)
  ) {
    return NextResponse.json(
      { error: "ingest_envelope_owned_by_automatic_review" },
      { status: 409 },
    )
  }
  const idempotentAccept =
    parsed.data.action === "accept"
    && envelope.relevanceStatus === "ACCEPTED"
    && Boolean(envelope.acceptedMentionId)
  if (envelope.relevanceStatus !== "REVIEW" && !idempotentAccept) {
    return NextResponse.json({ error: "Ingest envelope is not awaiting review" }, { status: 409 })
  }

  if (parsed.data.action === "accept") {
    try {
      const result = await replayIngestEnvelope(auth.orgId, id, {
        reviewOverride: true,
        ...(parsed.data.subjectId ? { reviewSubjectId: parsed.data.subjectId } : {}),
        reviewActorId: auth.userId,
      })
      const accepted = result.status === "REPLAYED" || result.status === "ALREADY_ACCEPTED"
      const resultReason = "relevanceReason" in result
        && typeof result.relevanceReason === "string"
        ? result.relevanceReason
        : null
      const finalRelevanceStatus = accepted
        ? "ACCEPTED"
        : result.status === "REJECTED_BY_COMMENT_POLICY"
          ? "REJECTED"
          : "REVIEW"
      const finalRelevanceReason = accepted && envelope.relevanceStatus === "REVIEW"
        ? "operator_review_accept"
        : result.status === "REJECTED_BY_COMMENT_POLICY"
          ? resultReason ?? "automatic_review_positive_comment"
          : result.status === "QUEUED_FOR_AUTOMATIC_TRIAGE"
            ? resultReason ?? "comment_sentiment_requires_review"
            : envelope.relevanceReason
      const resolvedSubjectId = "reviewSubjectId" in result
        && typeof result.reviewSubjectId === "string"
        ? result.reviewSubjectId
        : result.status === "ALREADY_ACCEPTED"
          ? null
          : parsed.data.subjectId ?? null
      await logAudit(auth.orgId, "review_accept", "ingest_envelope", id, result.status, {
        oldValue: {
          relevanceStatus: envelope.relevanceStatus,
          relevanceReason: envelope.relevanceReason,
          relevanceConfidence: envelope.relevanceConfidence,
        },
        newValue: {
          relevanceStatus: finalRelevanceStatus,
          relevanceReason: finalRelevanceReason,
          acceptedMentionId: accepted ? result.mentionId : null,
          replayStatus: result.status,
          subjectId: resolvedSubjectId,
        },
        userId: auth.userId,
      })
      return NextResponse.json({ success: true, data: result })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not accept ingest envelope"
      return NextResponse.json({ error: message }, { status: 409 })
    }
  }

  const now = new Date()
  const rejected = await prisma.ingestEnvelope.updateMany({
    where: {
      id: envelope.id,
      organizationId: auth.orgId,
      relevanceStatus: "REVIEW",
      acceptedMentionId: null,
      purgedAt: null,
      purgeAt: { gt: now },
      updatedAt: envelope.updatedAt,
      discoveryAutoReviewDecisions: {
        none: { state: "SUPPRESSED" },
      },
      AND: [{
        OR: [
          { reviewMutationUntil: null },
          { reviewMutationUntil: { lte: now } },
        ],
      }],
    },
    data: {
      relevanceStatus: "REJECTED",
      relevanceReason: "operator_review_reject",
      decidedAt: now,
      purgeAt: new Date(now.getTime() + 24 * 3_600_000),
      text: null,
      authorName: null,
      authorHandle: null,
      authorAvatar: null,
      url: null,
      canonicalUrl: null,
      parentPostUrl: null,
      rawPayload: {},
    },
  })
  if (rejected.count !== 1) {
    return NextResponse.json({ error: "ingest_envelope_changed_during_review" }, { status: 409 })
  }
  await logAudit(auth.orgId, "review_reject", "ingest_envelope", id, "operator_review_reject", {
    oldValue: {
      relevanceStatus: envelope.relevanceStatus,
      relevanceReason: envelope.relevanceReason,
      relevanceConfidence: envelope.relevanceConfidence,
    },
    newValue: {
      relevanceStatus: "REJECTED",
      relevanceReason: "operator_review_reject",
    },
    userId: auth.userId,
  })
  return NextResponse.json({ success: true, data: { envelopeId: envelope.id, status: "REJECTED" } })
})
