import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { checkPermission, type Action } from "@/lib/permissions"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { withRlsAuth, withRlsSessionAuth } from "@/lib/with-rls"
import type { AuthResult } from "@/lib/api-auth"

type WrappedWorkforceRouteHandler<C> = {
  (req: NextRequest): Promise<Response>
  (req: NextRequest, ctx: C): Promise<Response>
}
function workforceCapabilityDisabled(): NextResponse {
  return NextResponse.json({
    success: false,
    error: "Workforce is not enabled for this tenant.",
    code: "TENANT_CAPABILITY_DISABLED",
    capabilityId: "workforce-hrm",
    capabilityStatus: "disabled",
  }, { status: 403 })
}

function workforcePolicyAdminDenied(): NextResponse {
  return NextResponse.json({
    error: "Workforce policy configuration requires a signed-in tenant administrator.",
    code: "WORKFORCE_POLICY_ADMIN_REQUIRED",
  }, { status: 403 })
}

function workforceSessionPermissionDenied(action: Action): NextResponse {
  return NextResponse.json({
    error: "This Workforce action requires a signed-in user with the required permission.",
    code: "WORKFORCE_SESSION_PERMISSION_REQUIRED",
    action,
  }, { status: 403 })
}

function isWorkforcePolicyAdministrator(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin"
}

async function workforceCapabilityResponse(organizationId: string): Promise<NextResponse | null> {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, addons: true, features: true, modules: true },
    })
    if (!organization || !isTenantCapabilityEnabled("workforce-hrm", organization)) {
      return workforceCapabilityDisabled()
    }
    return null
  } catch (error) {
    // Fail closed: a transient entitlement lookup failure must never turn an
    // HRM endpoint into an unscoped, best-effort read/write path.
    console.error("[withWorkforceRlsAuth] capability lookup failed", error)
    return NextResponse.json({
      error: "Unable to verify Workforce capability.",
      code: "WORKFORCE_CAPABILITY_UNAVAILABLE",
    }, { status: 503 })
  }
}

/**
 * Server boundary for the independent Workforce surface.
 *
 * `workforce` is intentionally a permission scope rather than a group module:
 * the normal `withRlsAuth` path verifies identity, role, API-key scope and RLS,
 * then this wrapper verifies the live tenant capability from the Organization
 * row.  It must remain separate from `withMtmRlsAuth`, otherwise an HRM-only
 * tenant would silently need Route & Field.
 */
export function withWorkforceRlsAuth<C = unknown>(
  action: Action,
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  const wrapped = withRlsAuth<C>("workforce", action, async (req, auth, ctx) => {
    const denied = await workforceCapabilityResponse(auth.orgId)
    if (denied) return denied
    return handler(req, auth, ctx)
  })

  return wrapped as WrappedWorkforceRouteHandler<C>
}

/**
 * Human-session boundary for auditable Workforce operations such as approving
 * a timesheet or delivering an approved export. API-key creator ids are audit
 * metadata, not an impersonation grant, so those operations must never be
 * performed by an integration credential. The normal Workforce permission and
 * tenant-capability checks still apply before the handler runs.
 */
export function withWorkforceSessionAuth<C = unknown>(
  action: Action,
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  const wrapped = withRlsSessionAuth<C>(async (req, auth, ctx) => {
    if (!checkPermission(auth.role, "workforce", action)) return workforceSessionPermissionDenied(action)
    const denied = await workforceCapabilityResponse(auth.orgId)
    if (denied) return denied
    return handler(req, auth, ctx)
  })

  return wrapped as WrappedWorkforceRouteHandler<C>
}

/**
 * Human-admin boundary for tenant-authored Workforce configuration.
 *
 * Generic `withWorkforceRlsAuth("admin")` still accepts an API key with a
 * write scope because API-key authorization intentionally maps every mutation
 * action to write. Configuration must instead be tied to a current browser
 * session and an admin/superadmin role, so an integration key cannot silently
 * alter a tenant's future work-time rules.
 */
export function withWorkforceSessionAdminAuth<C = unknown>(
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  const wrapped = withRlsSessionAuth<C>(async (req, auth, ctx) => {
    if (!isWorkforcePolicyAdministrator(auth.role)) return workforcePolicyAdminDenied()
    const denied = await workforceCapabilityResponse(auth.orgId)
    if (denied) return denied
    return handler(req, auth, ctx)
  })
  return wrapped as WrappedWorkforceRouteHandler<C>
}
