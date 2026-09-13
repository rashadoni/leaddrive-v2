import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { checkPermission, type Action } from "@/lib/permissions"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { withRlsAuth, withRlsSessionAuth } from "@/lib/with-rls"
import type { AuthResult } from "@/lib/api-auth"
import { decidePersistedWorkforceAccess } from "@/lib/workforce/access-grant-resolution"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import {
  applyWorkforceSensitiveResponseHeaders,
  workforceSensitiveResponseHeaders,
} from "@/lib/workforce/sensitive-response"
import type { WorkforceAccessPermission } from "@/lib/workforce/access-control"

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

function workforceGranularAccessDenied(): NextResponse {
  return NextResponse.json({
    error: "This Workforce action requires an effective Workforce role grant.",
    code: "WORKFORCE_GRANULAR_ACCESS_REQUIRED",
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

/**
 * C7 role-ledger administration is deliberately stricter than the former
 * tenant-admin configuration boundary. It has no legacy CRM-role fallback:
 * a tenant must first be explicitly cut over with an independently seeded
 * organization-scoped TENANT_ADMIN grant. This prevents a broad CRM admin
 * from silently creating their own replacement authority during rollout.
 */
export function withWorkforceSessionGrantManagementAuth<C = unknown>(
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  const wrapped = withRlsSessionAuth<C>(async (req, auth, ctx) => {
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: auth.orgId },
        select: { plan: true, addons: true, features: true, modules: true },
      })
      if (!organization || !isTenantCapabilityEnabled("workforce-hrm", organization)) {
        return applyWorkforceSensitiveResponseHeaders(workforceCapabilityDisabled())
      }
      if (!workforceGranularAccessEnabled(organization.features)) {
        return applyWorkforceSensitiveResponseHeaders(NextResponse.json({
          error: "Workforce role management requires an explicit granular-access bootstrap.",
          code: "WORKFORCE_GRANT_MANAGEMENT_BOOTSTRAP_REQUIRED",
        }, { status: 409 }))
      }
      const access = await decidePersistedWorkforceAccess({
        db: prisma,
        organizationId: auth.orgId,
        principalUserId: auth.userId,
        selfAgentId: null,
        permission: "ROLE_GRANT_MANAGE",
        resource: { organizationId: auth.orgId },
      })
      return applyWorkforceSensitiveResponseHeaders(
        access.allowed ? await handler(req, auth, ctx) : workforceGranularAccessDenied(),
      )
    } catch {
      logWorkforceSensitiveOperationFailure({ operation: "auth-workforce-grant-management" })
      return applyWorkforceSensitiveResponseHeaders(NextResponse.json({
        error: "Unable to verify Workforce role-management access.",
        code: "WORKFORCE_GRANULAR_ACCESS_UNAVAILABLE",
      }, { status: 503 }))
    }
  })
  return wrapped as WrappedWorkforceRouteHandler<C>
}

/**
 * Session-only boundary for tenant-wide schedule and site configuration.
 * Legacy tenants retain the admin boundary; after granular cutover the caller
 * must hold the exact organization-scoped Workforce permission.
 */
export function withWorkforceSessionScheduleConfigurationAuth<C = unknown>(
  permission: Extract<WorkforceAccessPermission, "SCHEDULE_READ" | "SCHEDULE_WRITE" | "SITE_ASSIGNMENT_WRITE">,
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  const wrapped = withRlsSessionAuth<C>(async (req, auth, ctx) => {
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: auth.orgId },
        select: { plan: true, addons: true, features: true, modules: true },
      })
      if (!organization || !isTenantCapabilityEnabled("workforce-hrm", organization)) {
        return workforceCapabilityDisabled()
      }
      if (!workforceGranularAccessEnabled(organization.features)) {
        return isWorkforcePolicyAdministrator(auth.role)
          ? handler(req, auth, ctx)
          : workforcePolicyAdminDenied()
      }
      const access = await decidePersistedWorkforceAccess({
        db: prisma,
        organizationId: auth.orgId,
        principalUserId: auth.userId,
        selfAgentId: null,
        permission,
        resource: { organizationId: auth.orgId },
      })
      return access.allowed ? handler(req, auth, ctx) : workforceGranularAccessDenied()
    } catch (error) {
      console.error("[withWorkforceSessionScheduleConfigurationAuth] authorization lookup failed", error)
      return NextResponse.json({
        error: "Unable to verify Workforce schedule configuration access.",
        code: "WORKFORCE_GRANULAR_ACCESS_UNAVAILABLE",
      }, { status: 503 })
    }
  })
  return wrapped as WrappedWorkforceRouteHandler<C>
}

/**
 * Session-only boundary for tenant-wide policy drafts and activation.
 * Legacy tenants retain the admin boundary; after granular cutover the caller
 * must hold an organization-scoped HR policy grant. Team and site grants do
 * not authorize reading or changing the tenant-wide policy timeline.
 */
export function withWorkforceSessionPolicyConfigurationAuth<C = unknown>(
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  const wrapped = withRlsSessionAuth<C>(async (req, auth, ctx) => {
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: auth.orgId },
        select: { plan: true, addons: true, features: true, modules: true },
      })
      if (!organization || !isTenantCapabilityEnabled("workforce-hrm", organization)) {
        return workforceCapabilityDisabled()
      }
      if (!workforceGranularAccessEnabled(organization.features)) {
        return isWorkforcePolicyAdministrator(auth.role)
          ? handler(req, auth, ctx)
          : workforcePolicyAdminDenied()
      }
      const access = await decidePersistedWorkforceAccess({
        db: prisma,
        organizationId: auth.orgId,
        principalUserId: auth.userId,
        selfAgentId: null,
        permission: "WORKFORCE_POLICY_DRAFT_WRITE",
        resource: { organizationId: auth.orgId },
      })
      return access.allowed ? handler(req, auth, ctx) : workforceGranularAccessDenied()
    } catch (error) {
      console.error("[withWorkforceSessionPolicyConfigurationAuth] authorization lookup failed", error)
      return NextResponse.json({
        error: "Unable to verify Workforce policy configuration access.",
        code: "WORKFORCE_GRANULAR_ACCESS_UNAVAILABLE",
      }, { status: 503 })
    }
  })
  return wrapped as WrappedWorkforceRouteHandler<C>
}

/**
 * Session-only boundary for the mobile pilot write-fence control plane.
 * Legacy tenants retain the admin boundary; after granular cutover only an
 * organization-scoped pilot rollback operator may inspect or change cohorts.
 * Mutation routes continue to enforce their separate mandatory MFA check.
 */
export function withWorkforceSessionPilotFenceAuth<C = unknown>(
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  const wrapped = withRlsSessionAuth<C>(async (req, auth, ctx) => {
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: auth.orgId },
        select: { plan: true, addons: true, features: true, modules: true },
      })
      if (!organization || !isTenantCapabilityEnabled("workforce-hrm", organization)) {
        return workforceCapabilityDisabled()
      }
      if (!workforceGranularAccessEnabled(organization.features)) {
        return isWorkforcePolicyAdministrator(auth.role)
          ? handler(req, auth, ctx)
          : workforcePolicyAdminDenied()
      }
      const access = await decidePersistedWorkforceAccess({
        db: prisma,
        organizationId: auth.orgId,
        principalUserId: auth.userId,
        selfAgentId: null,
        permission: "PILOT_FENCE_MANAGE",
        resource: { organizationId: auth.orgId },
      })
      return access.allowed ? handler(req, auth, ctx) : workforceGranularAccessDenied()
    } catch (error) {
      console.error("[withWorkforceSessionPilotFenceAuth] authorization lookup failed", error)
      return NextResponse.json({
        error: "Unable to verify Workforce pilot-fence access.",
        code: "WORKFORCE_GRANULAR_ACCESS_UNAVAILABLE",
      }, { status: 503 })
    }
  })
  return wrapped as WrappedWorkforceRouteHandler<C>
}

/**
 * Session-only boundary for retention inventory. The HTTP surface remains
 * strictly dry-run: this grant permits reviewing bounded counts and cutoffs,
 * never executing deletion or managing a legal hold. Legacy tenants retain
 * the existing admin boundary until the explicit granular-access cutover.
 */
export function withWorkforceSessionRetentionReadAuth<C = unknown>(
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  const wrapped = withRlsSessionAuth<C>(async (req, auth, ctx) => {
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: auth.orgId },
        select: { plan: true, addons: true, features: true, modules: true },
      })
      if (!organization || !isTenantCapabilityEnabled("workforce-hrm", organization)) {
        return workforceCapabilityDisabled()
      }
      if (!workforceGranularAccessEnabled(organization.features)) {
        return isWorkforcePolicyAdministrator(auth.role)
          ? handler(req, auth, ctx)
          : workforcePolicyAdminDenied()
      }
      const access = await decidePersistedWorkforceAccess({
        db: prisma,
        organizationId: auth.orgId,
        principalUserId: auth.userId,
        selfAgentId: null,
        permission: "RETENTION_DRY_RUN_READ",
        resource: { organizationId: auth.orgId },
      })
      return access.allowed ? handler(req, auth, ctx) : workforceGranularAccessDenied()
    } catch (error) {
      console.error("[withWorkforceSessionRetentionReadAuth] authorization lookup failed", error)
      return NextResponse.json({
        error: "Unable to verify Workforce retention access.",
        code: "WORKFORCE_GRANULAR_ACCESS_UNAVAILABLE",
      }, { status: 503, headers: workforceSensitiveResponseHeaders })
    }
  })
  return wrapped as WrappedWorkforceRouteHandler<C>
}

/**
 * Employment lifecycle is an organization-wide HR fact. After granular
 * access cutover, a generic CRM administrator is insufficient and the exact
 * Workforce HR grant becomes authoritative.
 */
export function withWorkforceSessionEmploymentConfigurationAuth<C = unknown>(
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  const wrapped = withRlsSessionAuth<C>(async (req, auth, ctx) => {
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: auth.orgId },
        select: { plan: true, addons: true, features: true, modules: true },
      })
      if (!organization || !isTenantCapabilityEnabled("workforce-hrm", organization)) {
        return workforceCapabilityDisabled()
      }
      if (!workforceGranularAccessEnabled(organization.features)) {
        return isWorkforcePolicyAdministrator(auth.role)
          ? handler(req, auth, ctx)
          : workforcePolicyAdminDenied()
      }
      const access = await decidePersistedWorkforceAccess({
        db: prisma,
        organizationId: auth.orgId,
        principalUserId: auth.userId,
        selfAgentId: null,
        permission: "WORKFORCE_EMPLOYMENT_MANAGE",
        resource: { organizationId: auth.orgId },
      })
      return access.allowed ? handler(req, auth, ctx) : workforceGranularAccessDenied()
    } catch (error) {
      console.error("[withWorkforceSessionEmploymentConfigurationAuth] authorization lookup failed", error)
      return NextResponse.json({
        error: "Unable to verify Workforce employment-history access.",
        code: "WORKFORCE_GRANULAR_ACCESS_UNAVAILABLE",
      }, { status: 503 })
    }
  })
  return wrapped as WrappedWorkforceRouteHandler<C>
}
/**
 * Controlled C7 cutover for the tenant-wide, raw-proof-free exception queue.
 *
 * A case list has no immutable historic team/site snapshot that can safely
 * authorize a bulk read. Before a tenant enables the explicit grant fence we
 * retain the established session-admin boundary. Once enabled, only an
 * organization-scoped `HR_ADMIN` grant with `TEAM_EXCEPTION_READ` can read
 * the whole queue; a current employee team is never inferred for a past case.
 * A later indexed team/site queue may use a separately reviewed historic scope
 * model, but must not silently reuse this tenant-wide reader.
 */
export function withWorkforceSessionExceptionQueueAuth<C = unknown>(
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  const wrapped = withRlsSessionAuth<C>(async (req, auth, ctx) => {
    let authorized = false
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: auth.orgId },
        select: { plan: true, addons: true, features: true, modules: true },
      })
      if (!organization || !isTenantCapabilityEnabled("workforce-hrm", organization)) {
        return workforceCapabilityDisabled()
      }

      if (!workforceGranularAccessEnabled(organization.features)) {
        if (!isWorkforcePolicyAdministrator(auth.role)) return workforcePolicyAdminDenied()
        authorized = true
      } else {
        const access = await decidePersistedWorkforceAccess({
          db: prisma,
          organizationId: auth.orgId,
          principalUserId: auth.userId,
          selfAgentId: null,
          permission: "TEAM_EXCEPTION_READ",
          resource: { organizationId: auth.orgId },
        })
        if (!access.allowed) return workforceGranularAccessDenied()
        authorized = true
      }
    } catch (error) {
      // A failed grant lookup cannot silently restore broad CRM-admin access.
      console.error("[withWorkforceSessionExceptionQueueAuth] authorization lookup failed", error)
      return NextResponse.json({
        error: "Unable to verify Workforce exception queue access.",
        code: "WORKFORCE_GRANULAR_ACCESS_UNAVAILABLE",
      }, { status: 503 })
    }
    return authorized ? handler(req, auth, ctx) : workforceGranularAccessDenied()
  })
  return wrapped as WrappedWorkforceRouteHandler<C>
}
