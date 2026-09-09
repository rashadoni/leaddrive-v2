import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import {
  decideWorkforceRequest,
  WorkforceRequestDecisionSchema,
} from "@/lib/workforce/request-decision"

type RouteContext = { params: Promise<{ id: string }> }

function workforceScopeDenied() {
  return NextResponse.json({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, { status: 403 })
}

/**
 * A route entitlement only enriches the decision with read-only conflicts. It
 * is never required to make an HRM decision: if entitlement lookup fails, the
 * decision remains available and routes cannot be silently altered.
 */
async function routeConflictPreviewEnabled(organizationId: string): Promise<boolean> {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, addons: true, features: true, modules: true },
    })
    return Boolean(organization && isTenantCapabilityEnabled("route-field", organization))
  } catch (error) {
    console.warn("[workforce/request decision] Route & Field entitlement lookup failed", error)
    return false
  }
}

/** POST /api/v1/workforce/requests/:id/decision */
export const POST = withWorkforceRlsAuth<RouteContext>("write", async (req: NextRequest, auth, { params }) => {
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor) return workforceScopeDenied()

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
    if (result.kind === "forbidden") return workforceScopeDenied()
    if (result.kind === "already_decided") {
      return NextResponse.json({
        error: "This request has already been decided",
        code: "WORKFORCE_REQUEST_ALREADY_DECIDED",
        status: result.status,
      }, { status: 409 })
    }
    if (result.kind === "route_conflict") {
      return NextResponse.json({
        error: "The employee has active routes during this absence",
        code: "WORKFORCE_ROUTE_CONFLICT",
        conflicts: result.conflicts,
      }, { status: 409 })
    }
    if (result.kind === "conflict") {
      return NextResponse.json({ error: result.message, code: result.code }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      data: result.data,
      conflicts: result.conflicts,
      ...(result.idempotent ? { idempotent: true } : {}),
    })
  } catch (error) {
    console.error("[workforce/request decision POST]", error)
    return NextResponse.json({ error: "Failed to save Workforce decision" }, { status: 500 })
  }
})
