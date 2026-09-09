import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import {
  PREDICTION_TYPES,
  RATING_VALUES,
  type PredictionType,
  type Rating,
} from "@/lib/adaptive-ai/types"

/**
 * A9 Adaptive AI Models — slice-2 feedback insert + list.
 *
 * POST /api/v1/ai-feedback
 *   Body: {
 *     predictionType: PredictionType,
 *     predictionTargetId: string,
 *     predictionValue?: string | null,
 *     rating: -1 | 0 | 1,
 *     comment?: string | null,
 *   }
 *   Inserts an AiFeedback row scoped to the caller's organizationId,
 *   stamped with userId from the session. Returns the created row.
 *
 * GET /api/v1/ai-feedback?type=<predictionType>&targetId=<id>&limit=<n>
 *   Lists raw feedback rows for an org. Use `aggregate` sub-route for
 *   accuracy metrics (avgRating / approvalRate / adjustmentFactor).
 *
 * Auth: session-only (the feedback widget runs in the dashboard UI;
 * API-key clients don't have a use case for inserting feedback yet —
 * if they need to we can lift the session-only restriction).
 */

const COMMENT_MAX_LEN = 1000

export const POST = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  // predictionType
  const predictionType = typeof b.predictionType === "string" ? b.predictionType : ""
  if (!PREDICTION_TYPES.includes(predictionType as PredictionType)) {
    return NextResponse.json(
      {
        error: `Unknown predictionType "${predictionType}". Use one of: ${PREDICTION_TYPES.join(", ")}`,
      },
      { status: 400 },
    )
  }

  // predictionTargetId
  const predictionTargetId = typeof b.predictionTargetId === "string" ? b.predictionTargetId.trim() : ""
  if (!predictionTargetId) {
    return NextResponse.json({ error: "predictionTargetId is required" }, { status: 400 })
  }

  // rating
  const rawRating = typeof b.rating === "number" ? b.rating : NaN
  if (!RATING_VALUES.includes(rawRating as Rating)) {
    return NextResponse.json(
      { error: `rating must be one of: ${RATING_VALUES.join(", ")}` },
      { status: 400 },
    )
  }

  // predictionValue — snapshot of model output at feedback time
  let predictionValue: string | null = null
  if (b.predictionValue !== undefined && b.predictionValue !== null) {
    if (typeof b.predictionValue !== "string") {
      return NextResponse.json({ error: "predictionValue must be a string" }, { status: 400 })
    }
    predictionValue = b.predictionValue.slice(0, 500) // cap defensively
  }

  // comment — free text, capped to prevent abuse
  let comment: string | null = null
  if (b.comment !== undefined && b.comment !== null) {
    if (typeof b.comment !== "string") {
      return NextResponse.json({ error: "comment must be a string" }, { status: 400 })
    }
    if (b.comment.length > COMMENT_MAX_LEN) {
      return NextResponse.json(
        { error: `comment exceeds max length of ${COMMENT_MAX_LEN} characters` },
        { status: 400 },
      )
    }
    comment = b.comment
  }

  try {
    const created = await prisma.aiFeedback.create({
      data: {
        organizationId: orgId,
        predictionType,
        predictionTargetId,
        predictionValue,
        rating: rawRating,
        comment,
        userId: session.userId || null,
      },
    })
    return NextResponse.json({ success: true, data: created }, { status: 201 })
  } catch (e) {
    console.error("[ai-feedback] POST error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const GET = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const predictionType = searchParams.get("type") || undefined
  const targetId = searchParams.get("targetId") || undefined
  const limitRaw = Number(searchParams.get("limit") || "100")
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100

  if (predictionType && !PREDICTION_TYPES.includes(predictionType as PredictionType)) {
    return NextResponse.json(
      { error: `Unknown predictionType "${predictionType}"` },
      { status: 400 },
    )
  }

  try {
    const rows = await prisma.aiFeedback.findMany({
      where: {
        organizationId: orgId,
        ...(predictionType ? { predictionType: predictionType as PredictionType } : {}),
        ...(targetId ? { predictionTargetId: targetId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    })
    return NextResponse.json({ success: true, data: { rows } })
  } catch (e) {
    console.error("[ai-feedback] GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
