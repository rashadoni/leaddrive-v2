import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { withWorkforceCompatAuth } from "@/lib/with-workforce-compat-auth"
import {
  decideWorkforceRequest,
  WorkforceRequestDecisionSchema,
} from "@/lib/workforce/request-decision"
import { resolveWorkforceActor } from "@/lib/workforce/actor"

type RouteContext = { params: Promise<{ id: string }> }

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_OPERATIONS_SCOPE_DENIED" }, { status: 403 })
}

async function routeConflictPreviewEnabled(organizationId: string): Promise<boolean> {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, addons: true, features: true, modules: true },
    })
    return Boolean(organization && isTenantCapabilityEnabled("route-field", organization))
  } catch (error) {
    // Route conflict enrichment must not make HRM-only timekeeping unavailable.
    console.warn("[MTM/operations/hrm decision] Route & Field entitlement lookup failed", error)
    return false
  }
}

/**
 * Compatibility adapter for the old MTM Operations HRM tab. New Workforce
 * screens use /api/v1/workforce/requests/:id/decision, but both call the same
 * tenant-scoped service and state transition.
 */
export const POST = withWorkforceCompatAuth<RouteContext>("write", async (req, auth, { params }) => {
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return forbidden()

  const parsed = WorkforceRequestDecisionSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid decision" }, { status: 400 })
  }
  const { id } = await params

  try {
    const result = await decideWorkforceRequest({
      organizationId: auth.orgId,
      userId: auth.userId,
      actor,
      requestId: id,
      input: parsed.data,
      includeRouteConflicts: await routeConflictPreviewEnabled(auth.orgId),
      req,
    })
    if (result.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (result.kind === "forbidden") return forbidden()
    if (result.kind === "already_decided") {
      return NextResponse.json({
        error: "This request has already been decided",
        code: "MTM_HRM_REQUEST_ALREADY_DECIDED",
        status: result.status,
      }, { status: 409 })
    }
    if (result.kind === "route_conflict") {
      return NextResponse.json({
        error: "The agent has active routes during this absence",
        code: "MTM_HRM_ROUTE_CONFLICT",
        conflicts: result.conflicts,
      }, { status: 409 })
    }
    if (result.kind === "conflict") {
      const code = result.code === "WORKFORCE_TIME_RANGE_INVALID"
        ? result.code
        : "MTM_HRM_DECISION_CONFLICT"
      return NextResponse.json({ error: result.message, code }, { status: 409 })
    }
    // Keep the historical transport contract for the supported Operations UI:
    // it has always rendered an already-decided request as a 409. The new
    // Workforce endpoint exposes the idempotent success result directly.
    if (result.idempotent) {
      return NextResponse.json({
        error: "This request has already been decided",
        code: "MTM_HRM_REQUEST_ALREADY_DECIDED",
        status: result.data.status,
      }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      data: result.data,
      conflicts: result.conflicts,
    })
  } catch (error) {
    console.error("[MTM/operations/hrm decision]", error)
    return NextResponse.json({ error: "Failed to save HRM decision" }, { status: 500 })
  }
})
