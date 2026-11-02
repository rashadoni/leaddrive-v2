import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { hasMobilePermission, requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"
import { listAttendanceRequestsForReview, type AttendanceReviewItem } from "@/lib/mtm/attendance-request-review"
import { mobileAttendanceReviewer } from "@/lib/mtm/mobile-attendance-reviewer"

export const GET = withMobileRls(async (_req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden
  // Keep a single compatibility endpoint for existing managers, while each
  // data section remains behind its own commercial capability and granular
  // permission. A Routes-only manager must never receive leave/correction
  // reasons; a Workforce-only manager must not query route change requests.
  const routeFieldEnabled = auth.tenantCapabilities?.routeField === true
  const workforceEnabled = auth.tenantCapabilities?.workforceHrm === true
  const canReadRoutes = routeFieldEnabled && hasMobilePermission(auth.role, "ROUTE_TEAM_PLAN")
  const canReadWorkforce = workforceEnabled
    && hasMobilePermission(auth.role, "WORKTIME_TEAM_READ")
    && hasMobilePermission(auth.role, "WORKTIME_REQUEST_DECIDE")
  // Personnel requests (leave, sick leave, hours off, corrections) — the same
  // queue and the same review rights as Personnel → Today in the browser
  // (owner, 2026-10-17). Hidden, not failed, when the manager may not review.
  let attendance: AttendanceReviewItem[] = []
  if (auth.tenantCapabilities?.personnel === true) {
    const reviewer = await mobileAttendanceReviewer(auth)
    // With two-step approval a request this manager already passed to HR has no button left here.
    if (reviewer) attendance = await listAttendanceRequestsForReview(reviewer, { status: "PENDING" }).then(page => page.items.filter((item: AttendanceReviewItem) => item.canDecide !== false)).catch(() => [])
  }
  if (!canReadRoutes && !canReadWorkforce && !attendance.length && auth.tenantCapabilities?.personnel !== true) {
    return NextResponse.json({
      error: "Forbidden",
      code: "MTM_MOBILE_PERMISSION_REQUIRED",
      permission: "WORKTIME_REQUEST_DECIDE_OR_ROUTE_TEAM_PLAN",
    }, { status: 403 })
  }
  const scope = await resolveAgentScope(prisma, { organizationId: auth.orgId, agentId: auth.agentId, role: auth.role as "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT" })
  const agentFilter = scope.agentIds ? { in: scope.agentIds } : undefined
  const [hrm, routeChanges, customers, contactChanges] = await Promise.all([
    canReadWorkforce
      ? prisma.mtmHrmRequest.findMany({ where: { organizationId: auth.orgId, status: "PENDING", ...(agentFilter ? { agentId: agentFilter } : {}) }, orderBy: { submittedAt: "desc" }, take: 100, select: { id: true, agentId: true, type: true, startDate: true, endDate: true, reason: true, submittedAt: true, agent: { select: { name: true } } } })
      : Promise.resolve([]),
    canReadRoutes
      ? prisma.mtmRouteChangeRequest.findMany({ where: { organizationId: auth.orgId, status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] }, ...(agentFilter ? { requestedByAgentId: agentFilter } : {}) }, orderBy: { submittedAt: "desc" }, take: 100, select: { id: true, requestedByAgentId: true, routeId: true, changeType: true, reason: true, status: true, submittedAt: true, requestedByAgent: { select: { name: true } } } })
      : Promise.resolve([]),
    canReadRoutes
      ? prisma.mtmCustomerCreateRequest.findMany({ where: { organizationId: auth.orgId, status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] }, ...(agentFilter ? { requestedByAgentId: agentFilter } : {}) }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, requestedByAgentId: true, name: true, objectType: true, reason: true, status: true, submittedAt: true, requestedByAgent: { select: { name: true } } } })
      : Promise.resolve([]),
    canReadRoutes
      ? prisma.mtmContactChangeRequest.findMany({ where: { organizationId: auth.orgId, status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] }, ...(agentFilter ? { requestedByAgentId: agentFilter } : {}) }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, contactId: true, requestedByAgentId: true, kind: true, reason: true, payload: true, status: true, submittedAt: true, contact: { select: { displayName: true } }, requestedByAgent: { select: { name: true } } } })
      : Promise.resolve([]),
  ])
  return NextResponse.json({ success: true, data: { scope: scope.agentIds ? "TEAM_OR_REGION" : "ORGANIZATION", counts: { hrm: hrm.length, routeChanges: routeChanges.length, customers: customers.length, contactChanges: contactChanges.length, attendance: attendance.length }, hrm, routeChanges, customers, contactChanges, attendance } })
})
