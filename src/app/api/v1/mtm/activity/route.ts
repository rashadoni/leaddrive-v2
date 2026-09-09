import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { MAX_PAGE_LIMIT } from "./_constants"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { productCapabilitiesForMixedSurface } from "@/lib/workforce-capability"

const CHECK_IN_ACTIONS = ["CHECK_IN", "CHECK_IN_FORCED"] as const
// Compliance lens: geofence bypasses + failed mobile logins. Kept in sync with
// VIOLATION_ACTIONS in src/lib/mtm/activity-actions.tsx (UI side).
const VIOLATION_ACTIONS = ["CHECK_IN_FORCED", "MOBILE_LOGIN_FAILED"] as const
const WORKFORCE_AUDIT_ACTIONS = [
  "WORKDAY_START",
  "WORKDAY_PAUSE",
  "WORKDAY_RESUME",
  "WORKDAY_FINISH",
  "HRM_REQUEST_DECISION",
] as const
const WORKFORCE_AUDIT_ENTITIES = ["workday", "hrm_request"] as const
const WORKFORCE_AUDIT_KINDS = ["workday_transition", "hrm_request_decision"] as const

function routeCapabilityDisabled() {
  return NextResponse.json({
    success: false,
    error: "Route & Field is not enabled for this tenant.",
    code: "TENANT_CAPABILITY_DISABLED",
    capabilityId: "route-field",
    capabilityStatus: "disabled",
  }, { status: 403 })
}

function routeAuditWhere(organizationId: string, workforceEnabled: boolean): Prisma.MtmAuditLogWhereInput {
  return {
    organizationId,
    ...(workforceEnabled ? {} : {
      NOT: {
        OR: [
          { entity: { in: [...WORKFORCE_AUDIT_ENTITIES] } },
          { metadataKind: { in: [...WORKFORCE_AUDIT_KINDS] } },
          { action: { in: [...WORKFORCE_AUDIT_ACTIONS] } },
        ],
      },
    }),
  }
}

/** Inclusive local-midnight start for the selected period, or null for "all". */
function periodStart(period: string, now: Date): Date | null {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === "all") return null
  if (period === "7d") { const s = new Date(midnight); s.setDate(s.getDate() - 6); return s }
  if (period === "30d") { const s = new Date(midnight); s.setDate(s.getDate() - 29); return s }
  return midnight // "today" (default)
}

export const GET = withRouteFieldWebRlsAuth("read", async (req, { orgId }) => {

  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type") || "" // CHECK_IN, CHECK_OUT, PHOTO, TASK, CHECK_IN_FORCED
  const agentId = searchParams.get("agentId") || ""
  const violations = searchParams.get("violations") === "1"
  const period = searchParams.get("period") || "today"
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  try {
    const capabilities = await productCapabilitiesForMixedSurface(orgId, "MTM/activity GET")
    if (!capabilities.routeField) return routeCapabilityDisabled()
    const now = new Date()
    const start = periodStart(period, now)

    // KPI counts are scoped to the SELECTED period (+ agent) — this fixes the old
    // bug where cards were hard-coded to "today" while the feed showed all time.
    // KPIs intentionally ignore the type/violations filters so the cards stay a
    // stable overview while the list below narrows.
    const kpiWhere = routeAuditWhere(orgId, capabilities.workforceHrm)
    if (start) kpiWhere.createdAt = { gte: start }
    if (agentId) kpiWhere.agentId = agentId

    const [totalCheckIns, totalCheckOuts, totalPhotos, totalActivities, totalViolations] =
      await Promise.all([
        prisma.mtmAuditLog.count({ where: { ...kpiWhere, action: { in: [...CHECK_IN_ACTIONS] } } }),
        prisma.mtmAuditLog.count({ where: { ...kpiWhere, action: "CHECK_OUT" } }),
        prisma.mtmAuditLog.count({ where: { ...kpiWhere, action: "PHOTO_UPLOAD" } }),
        prisma.mtmAuditLog.count({ where: kpiWhere }),
        prisma.mtmAuditLog.count({ where: { ...kpiWhere, action: { in: [...VIOLATION_ACTIONS] } } }),
      ])

    // Activity feed = period + agent + (violations OR type) filters, paginated.
    // Action names match writers in visits/[id]/route.ts and photos/route.ts.
    const auditWhere = routeAuditWhere(orgId, capabilities.workforceHrm)
    if (start) auditWhere.createdAt = { gte: start }
    if (agentId) auditWhere.agentId = agentId
    if (violations) auditWhere.action = { in: [...VIOLATION_ACTIONS] }
    else if (type === "CHECK_IN") auditWhere.action = { in: [...CHECK_IN_ACTIONS] }
    // F-31 compliance lens: forced check-ins on their own so an auditor can see
    // geofence-bypass events without the regular check-in noise.
    else if (type === "CHECK_IN_FORCED") auditWhere.action = "CHECK_IN_FORCED"
    else if (type === "CHECK_OUT") auditWhere.action = "CHECK_OUT"
    else if (type === "PHOTO") auditWhere.action = "PHOTO_UPLOAD"
    else if (type === "TASK") auditWhere.action = { in: ["TASK_CREATE", "TASK_UPDATE", "TASK_COMPLETE", "TASK_DELETE"] }

    const [logs, total] = await Promise.all([
      // include (not select) so every audit scalar — entity, entityId,
      // metadataKind — reaches the UI for the details cell + deep-links.
      // F-18/F-33: agent relation carries name + avatar for the timeline row.
      prisma.mtmAuditLog.findMany({
        where: auditWhere,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { agent: { select: { id: true, name: true, avatar: true } } },
      }),
      prisma.mtmAuditLog.count({ where: auditWhere }),
    ])

    return NextResponse.json({
      success: true,
      data: {
        kpi: { totalActivities, totalCheckIns, totalCheckOuts, totalPhotos, totalViolations },
        logs,
        total,
        page,
        limit,
        period,
      },
    })
  } catch (e: unknown) {
    console.error("[MTM/activity GET]", e)
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 })
  }
})
