import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { hasMobilePermission, requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

/** GET /api/v1/mtm/mobile/manager/team — scoped Manager/Supervisor read model. */
export const GET = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden
  try {
    // This is a shared manager transport. Route-only managers may still see
    // their team list, but never active workday data; Workforce-only managers
    // get the inverse without acquiring route access.
    const routeFieldEnabled = auth.tenantCapabilities?.routeField === true
    const workforceEnabled = auth.tenantCapabilities?.workforceHrm === true
    const canReadRouteTeam = routeFieldEnabled && hasMobilePermission(auth.role, "ROUTE_TEAM_PLAN")
    const canReadWorkforceTeam = workforceEnabled && hasMobilePermission(auth.role, "WORKTIME_TEAM_READ")
    if (!canReadRouteTeam && !canReadWorkforceTeam) {
      return NextResponse.json({
        error: "Forbidden",
        code: "MTM_MOBILE_PERMISSION_REQUIRED",
        permission: "WORKTIME_TEAM_READ_OR_ROUTE_TEAM_PLAN",
      }, { status: 403 })
    }
    const scope = await resolveAgentScope(prisma, {
      organizationId: auth.orgId,
      agentId: auth.agentId,
      role: auth.role as "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT",
    })
    const includeInactive = new URL(req.url).searchParams.get("includeInactive") === "1"
    const agents = await prisma.mtmAgent.findMany({
      where: {
        organizationId: auth.orgId,
        ...(includeInactive ? {} : { status: "ACTIVE" }),
        ...(scope.agentIds ? { id: { in: scope.agentIds } } : {}),
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        status: true,
        teamId: true,
        ...(routeFieldEnabled ? { isOnline: true, lastSeenAt: true } : {}),
        ...(canReadWorkforceTeam
          ? {
              workdays: {
                where: { status: { in: ["STARTED", "PAUSED"] } },
                orderBy: { startedAt: "desc" },
                take: 1,
                select: { id: true, status: true, startedAt: true, pausedAt: true },
              },
            }
          : {}),
      },
    })
    return NextResponse.json({
      success: true,
      data: {
        scope: scope.agentIds ? "TEAM_OR_REGION" : "ORGANIZATION",
        agents: agents.map((row) => {
          const { workdays = [], ...agent } = row as { workdays?: unknown[] } & Record<string, unknown>
          return { ...agent, workday: canReadWorkforceTeam ? workdays[0] ?? null : null }
        }),
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/manager/team GET]", error)
    return NextResponse.json({ error: "Failed to load team" }, { status: 500 })
  }
})
