import { NextResponse } from "next/server"
import type { ProactiveAlert } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { ENTITY_TYPES, type EntityType } from "@/lib/proactive/types"

/**
 * T9 Proactive Service — slice-3 GET list endpoint.
 *
 * Lists active (un-dismissed) ProactiveAlert rows for the caller's
 * org. Optional `entityType` + `entityId` query params narrow the
 * result to a single Contact / Company / Deal — used by the Active
 * Alerts panel on the detail page.
 *
 * Sort: severity DESC → createdAt DESC. Hits the
 * `proactive_alerts_severity_idx` index when no entity filter is set,
 * and the partial `proactive_alerts_active_idx` when filtered.
 *
 * Auth: standard `getOrgId` org-scoped read. Capability scope =
 * "anyone with quote-read access can see active alerts". Acknowledge /
 * dismiss is the PATCH route (separate file).
 */

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const entityType = searchParams.get("entityType")
  const entityId = searchParams.get("entityId")

  // Reject unknown entityType to avoid an open-ended scan; explicit
  // 400 surfaces the typo for the caller.
  if (entityType && !ENTITY_TYPES.includes(entityType as EntityType)) {
    return NextResponse.json(
      { error: `Unknown entityType "${entityType}". Use one of: ${ENTITY_TYPES.join(", ")}` },
      { status: 400 },
    )
  }

  try {
    const alerts = await prisma.proactiveAlert.findMany({
      where: {
        organizationId: orgId,
        dismissedAt: null,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 50, // reasonable cap for detail-panel rendering
    })

    // Sort severity in JS — Postgres doesn't natively rank our enum strings.
    // 50 rows max, so cost is negligible.
    const sorted = alerts.sort((a: ProactiveAlert, b: ProactiveAlert) => {
      const sa = SEVERITY_RANK[a.severity] ?? 99
      const sb = SEVERITY_RANK[b.severity] ?? 99
      if (sa !== sb) return sa - sb
      return b.createdAt.getTime() - a.createdAt.getTime()
    })

    return NextResponse.json({ success: true, data: { alerts: sorted, count: sorted.length } })
  } catch (e) {
    console.error("[proactive-alerts] GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
