import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { ENTITY_TYPES, type EntityType } from "@/lib/proactive/types"

/**
 * T9 Proactive Service — slice-3 GET HealthScore.
 *
 * Two query modes:
 *   1) Specific lookup — both `entityType` + `entityId` set →
 *      returns `{score: <row|null>}`. Null when no score has been
 *      computed for the entity yet (cron hasn't run, or contact
 *      pre-dates the cron).
 *   2) Org-list mode — no params (or just `entityType`) → returns
 *      `{scores: <rows>}` capped at 500 for slice-3 detail-panel
 *      use cases. Slice-4 may add pagination.
 *
 * Auth: org-scoped read.
 */

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const entityType = searchParams.get("entityType")
  const entityId = searchParams.get("entityId")

  if (entityType && !ENTITY_TYPES.includes(entityType as EntityType)) {
    return NextResponse.json(
      { error: `Unknown entityType "${entityType}". Use one of: ${ENTITY_TYPES.join(", ")}` },
      { status: 400 },
    )
  }

  try {
    if (entityType && entityId) {
      // Specific lookup.
      const score = await prisma.healthScore.findUnique({
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

    const scores = await prisma.healthScore.findMany({
      where: {
        organizationId: orgId,
        ...(entityType ? { entityType } : {}),
      },
      orderBy: { score: "asc" }, // worst first — useful for triage dashboards
      take: 500,
    })
    return NextResponse.json({ success: true, data: { scores } })
  } catch (e) {
    console.error("[health-scores] GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
