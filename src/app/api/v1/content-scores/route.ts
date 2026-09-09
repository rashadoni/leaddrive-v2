import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import {
  CONTENT_ENTITY_TYPES,
  type ContentEntityType,
} from "@/lib/content-perf/types"

/**
 * M10 Content Performance AI — slice-3 GET ContentScore.
 *
 * Two query modes (mirrors T9 health-scores):
 *
 *   1. Specific lookup — both `entityType` + `entityId` set →
 *      returns `{score: <row|null>}`. Null when the cron hasn't
 *      computed for that entity yet (new template, new campaign).
 *
 *   2. Org-list mode — no params (or just `entityType`) → returns
 *      `{scores: <rows>}` capped at 500. Ordered `score asc` (worst
 *      first) so triage dashboards can render top-N underperformers
 *      without re-sorting on the client.
 *
 * Auth: standard org-scoped read.
 */

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const entityType = searchParams.get("entityType")
  const entityId = searchParams.get("entityId")

  if (entityType && !CONTENT_ENTITY_TYPES.includes(entityType as ContentEntityType)) {
    return NextResponse.json(
      { error: `Unknown entityType "${entityType}". Use one of: ${CONTENT_ENTITY_TYPES.join(", ")}` },
      { status: 400 },
    )
  }

  try {
    if (entityType && entityId) {
      const score = await prisma.contentScore.findUnique({
        where: {
          organizationId_entityType_entityId: {
            organizationId: orgId,
            entityType,
            entityId,
          },
        },
      })
      return NextResponse.json({ success: true, data: { score } })
    }

    const scores = await prisma.contentScore.findMany({
      where: {
        organizationId: orgId,
        ...(entityType ? { entityType } : {}),
      },
      orderBy: { score: "asc" },
      take: 500,
    })
    return NextResponse.json({ success: true, data: { scores } })
  } catch (e) {
    console.error("[content-scores] GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
