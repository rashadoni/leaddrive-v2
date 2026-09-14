import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { activityPeriodStart, MAX_PAGE_LIMIT, VIEWER_READ_ACTION_SUFFIXES, VIEWER_READ_ACTIONS } from "./_constants"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { productCapabilitiesForMixedSurface } from "@/lib/workforce-capability"
import {
  fieldScopeAgentIdWhere,
  isAgentInFieldScope,
  mtmAgentOutOfScopeResponse,
  mtmFieldScopeRequiredResponse,
  resolveMtmFieldScope,
} from "@/lib/mtm/field-access"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"

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
    AND: [
      ...VIEWER_READ_ACTION_SUFFIXES.map((suffix) => ({ NOT: { action: { endsWith: suffix } } })),
      { action: { notIn: [...VIEWER_READ_ACTIONS] } },
    ],
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

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

type ActivityLog = { entity: string; entityId: string | null; newData: unknown; oldData: unknown }

/**
 * What a row is about, in words a manager reads: the customer's name, and the
 * visit or route it links to. New sync rows carry the name; older ones carry
 * only a customerId or the visit id, so the name is looked up once per page.
 */
async function activitySubjects(orgId: string, logs: ActivityLog[]) {
  const visitIdOf = (log: ActivityLog) =>
    log.entity === "visit" ? stringValue(log.entityId) : stringValue(jsonRecord(log.newData).visitId)
  const routeIdOf = (log: ActivityLog) =>
    log.entity === "route" ? stringValue(log.entityId) : stringValue(jsonRecord(log.newData).routeId)

  const customerIds = new Set<string>()
  const visitIds = new Set<string>()
  for (const log of logs) {
    const data = jsonRecord(log.newData)
    if (stringValue(data.customerName)) continue
    const customerId = stringValue(data.customerId) ?? stringValue(jsonRecord(log.oldData).customerId)
    if (customerId) customerIds.add(customerId)
    else {
      const visitId = visitIdOf(log)
      if (visitId) visitIds.add(visitId)
    }
  }
  const [customers, visits] = await Promise.all([
    customerIds.size
      ? prisma.mtmCustomer.findMany({ where: { organizationId: orgId, id: { in: [...customerIds] } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    visitIds.size
      ? prisma.mtmVisit.findMany({ where: { organizationId: orgId, id: { in: [...visitIds] } }, select: { id: true, customer: { select: { name: true } } } })
      : Promise.resolve([]),
  ])
  const customerName = new Map((customers ?? []).map((c: { id: string; name: string }) => [c.id, c.name] as const))
  const visitCustomer = new Map((visits ?? []).map((v: { id: string; customer: { name: string } | null }) => [v.id, v.customer?.name ?? null] as const))

  return logs.map((log) => {
    const data = jsonRecord(log.newData)
    const visitId = visitIdOf(log)
    const customerId = stringValue(data.customerId) ?? stringValue(jsonRecord(log.oldData).customerId)
    return {
      customerName: stringValue(data.customerName)
        ?? (customerId ? customerName.get(customerId) ?? null : null)
        ?? (visitId ? visitCustomer.get(visitId) ?? null : null),
      visitId,
      routeId: routeIdOf(log),
    }
  })
}

export const GET = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const { orgId } = auth
  // The feed and its counters are about people: a manager sees their own
  // agents' events. Organization-level entries without an agent (settings,
  // policy changes by web users) stay visible to admins only.
  const scope = await resolveMtmFieldScope(prisma, {
    organizationId: orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (scope.kind === "none") return mtmFieldScopeRequiredResponse()

  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type") || "" // CHECK_IN, CHECK_OUT, PHOTO, TASK, CHECK_IN_FORCED
  const agentId = searchParams.get("agentId") || ""
  const violations = searchParams.get("violations") === "1"
  const period = searchParams.get("period") || "today"
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, parseInt(searchParams.get("limit") || "50")))
  if (agentId && !isAgentInFieldScope(scope, agentId)) return mtmAgentOutOfScopeResponse()

  try {
    const capabilities = await productCapabilitiesForMixedSurface(orgId, "MTM/activity GET")
    if (!capabilities.routeField) return routeCapabilityDisabled()
    const settings = await getMtmSettings(orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const start = activityPeriodStart(period, new Date(), timezone)

    // KPI counts are scoped to the SELECTED period (+ agent) — this fixes the old
    // bug where cards were hard-coded to "today" while the feed showed all time.
    // KPIs intentionally ignore the type/violations filters so the cards stay a
    // stable overview while the list below narrows.
    const kpiWhere: Prisma.MtmAuditLogWhereInput = { ...routeAuditWhere(orgId, capabilities.workforceHrm), ...fieldScopeAgentIdWhere(scope) }
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
    const auditWhere: Prisma.MtmAuditLogWhereInput = { ...routeAuditWhere(orgId, capabilities.workforceHrm), ...fieldScopeAgentIdWhere(scope) }
    if (start) auditWhere.createdAt = { gte: start }
    if (agentId) auditWhere.agentId = agentId
    if (violations) auditWhere.action = { in: [...VIOLATION_ACTIONS] }
    else if (type === "CHECK_IN") auditWhere.action = { in: [...CHECK_IN_ACTIONS] }
    // F-31 compliance lens: forced check-ins on their own so an auditor can see
    // geofence-bypass events without the regular check-in noise.
    else if (type === "CHECK_IN_FORCED") auditWhere.action = "CHECK_IN_FORCED"
    else if (type === "CHECK_OUT") auditWhere.action = "CHECK_OUT"
    else if (type === "PHOTO") auditWhere.action = "PHOTO_UPLOAD"
    else if (type === "ROUTE") auditWhere.action = { in: ["ROUTE_START", "ROUTE_COMPLETE"] }
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

    const subjects = await activitySubjects(orgId, logs)

    return NextResponse.json({
      success: true,
      data: {
        kpi: { totalActivities, totalCheckIns, totalCheckOuts, totalPhotos, totalViolations },
        logs: logs.map((log: (typeof logs)[number], index: number) => ({ ...log, subject: subjects[index] })),
        timezone,
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
