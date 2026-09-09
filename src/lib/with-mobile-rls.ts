import { NextRequest, NextResponse } from "next/server"
import { resolveMobileAuth, type MobileAuthResult } from "./mobile-auth"
import { runWithTenant, runWithRlsBypass } from "./rls-context"

export type MobileEndpointCapability = "route-field" | "workforce-hrm"
type InferredMobileEndpointCapability = MobileEndpointCapability | "unconfigured-v2" | null

export interface WithMobileRlsOptions {
  /**
   * Overrides the capability inferred from a `/mtm/mobile/*` path. Dual
   * `/mtm/*` handlers use it so a Workforce-only JWT cannot enter a legacy
   * Route & Field handler merely because both use mobile authentication.
   */
  requiredCapability?: MobileEndpointCapability | null
}

type WrappedMobileRouteHandler<C> = {
  (req: NextRequest): Promise<Response>
  (req: NextRequest, ctx: C): Promise<Response>
}

/**
 * The mobile JWT can now be issued to a Route-only or Workforce-only tenant.
 * Keep the coarse commercial boundary in one place, then let each endpoint
 * apply its role/permission boundary. `sync/push` is intentionally exempt:
 * it contains both domains and gates every operation separately. Profile and
 * the two manager compatibility transports are also mixed; their handlers
 * gate and omit each domain section independently.
 */
function requiredCapabilityForMobilePath(pathname: string): InferredMobileEndpointCapability {
  const isLegacyMobilePath = pathname.startsWith("/api/v1/mtm/mobile/")
  const isV2MobilePath = pathname.startsWith("/api/v2/mtm/mobile/")
  if (!isLegacyMobilePath && !isV2MobilePath) return null
  // v2 endpoints are server-first additive contracts. Requiring an explicit
  // capability here prevents a future allowlisted handler from inheriting a
  // Route Field grant just because its author omitted the option below.
  if (isV2MobilePath) return "unconfigured-v2"
  if (
    pathname === "/api/v1/mtm/mobile/bootstrap" ||
    pathname === "/api/v1/mtm/mobile/ping" ||
    pathname === "/api/v1/mtm/mobile/profile" ||
    pathname === "/api/v1/mtm/mobile/manager/team" ||
    pathname === "/api/v1/mtm/mobile/manager/approvals" ||
    pathname === "/api/v1/mtm/mobile/notifications" ||
    pathname === "/api/v1/mtm/mobile/sync/push"
  ) return null
  if (
    pathname === "/api/v1/mtm/mobile/hrm" ||
    pathname === "/api/v1/mtm/mobile/workday"
  ) {
    return "workforce-hrm"
  }
  return "route-field"
}

function capabilityDisabledResponse(capabilityId: MobileEndpointCapability): NextResponse {
  const label = capabilityId === "workforce-hrm" ? "Workforce HRM" : "Route & Field"
  return NextResponse.json({
    success: false,
    error: `${label} is not enabled for this tenant.`,
    code: "TENANT_CAPABILITY_DISABLED",
    capabilityId,
    capabilityLabel: label,
    capabilityStatus: "disabled",
  }, { status: 403 })
}

/**
 * Route factory that makes Postgres RLS work for an MTM mobile
 * (JWT-authenticated) handler. Revocation and the capability snapshot are
 * resolved exactly once under the bypass frame, then the complete handler body
 * runs under `runWithTenant(auth.orgId, …)`. Handlers must use the supplied
 * auth object and never perform a second mobile-auth/Organization lookup.
 */
export function withMobileRls<C = unknown>(
  handler: (req: NextRequest, auth: MobileAuthResult, ctx: C) => Promise<Response> | Response,
  options?: WithMobileRlsOptions,
) {
  const wrapped = async (req: NextRequest, ctx?: C): Promise<Response> => {
    let auth: MobileAuthResult | null
    try {
      auth = await runWithRlsBypass(() => resolveMobileAuth(req))
    } catch (error) {
      // A thrown revocation lookup is an unexpected infrastructure failure;
      // fail closed rather than allowing a request outside the tenant frame.
      console.error("[withMobileRls] mobile auth resolve threw:", error)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const capabilityId = options?.requiredCapability === undefined
      ? requiredCapabilityForMobilePath(new URL(req.url).pathname)
      : options.requiredCapability
    if (capabilityId === "unconfigured-v2") {
      console.error("[withMobileRls] v2 mobile handler is missing requiredCapability")
      return NextResponse.json({
        success: false,
        error: "Mobile endpoint capability is not configured.",
        code: "MOBILE_ENDPOINT_CAPABILITY_UNCONFIGURED",
      }, { status: 403 })
    }
    if (capabilityId) {
      const allowed = capabilityId === "workforce-hrm"
        ? auth.tenantCapabilities?.workforceHrm === true
        : auth.tenantCapabilities?.routeField === true
      if (!allowed) return capabilityDisabledResponse(capabilityId)
    }

    return runWithTenant(auth.orgId, () => handler(req, auth, ctx as C))
  }

  return wrapped as WrappedMobileRouteHandler<C>
}

/**
 * Compatibility boundary for independently classified legacy routes. It uses
 * the revocation-time capability snapshot rather than re-reading Organization,
 * so direct endpoints cannot disagree with bootstrap or sync v2.
 */
export function withMobileTenantCapabilityRls<C = unknown>(
  capabilityId: MobileEndpointCapability,
  handler: (req: NextRequest, auth: MobileAuthResult, ctx: C) => Promise<Response> | Response,
) {
  return withMobileRls(handler, { requiredCapability: capabilityId })
}

/**
 * Compatibility helper for mixed bootstrap/push handlers. They admit either
 * field capability, then must gate each domain operation/response section.
 */
export function withMobileFieldSuiteRls<C = unknown>(
  handler: (req: NextRequest, auth: MobileAuthResult, ctx: C) => Promise<Response> | Response,
) {
  return withMobileRls(handler, { requiredCapability: null })
}
