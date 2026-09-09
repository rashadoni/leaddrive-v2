import { NextRequest } from "next/server"
import type { AuthResult } from "./api-auth"
import { getMobileAuth, type MobileTenantCapabilities } from "./mobile-auth"
import type { MtmMobileTenantModule } from "./mtm/mobile-capability-manifest"
import { requireMtmMobileMediaAccess } from "./mtm/mobile-media-guard"
import type { Action, Module } from "./permissions"
import type { FieldTenantCapabilityId } from "./tenant-capabilities"
import { requireTenantCapabilityAccessResponse } from "./tenant-capability-access"
import { withMobileRls, type MobileEndpointCapability } from "./with-mobile-rls"
import { withRlsAuth } from "./with-rls"

export interface MtmRlsAuth {
  orgId: string
  userId: string
  role: string
  email: string
  name: string
  agentId: string | null
  principal: "web" | "mobile"
  /** Present only for a mobile principal, from the revocation-time snapshot. */
  tenantCapabilities?: MobileTenantCapabilities
}

type WrappedMtmRouteHandler<C> = {
  (req: NextRequest): Promise<Response>
  (req: NextRequest, ctx: C): Promise<Response>
}

export interface WithMtmRlsAuthOptions {
  /**
   * The capability a mobile principal needs for this legacy dual-principal
   * endpoint. `mtm` defaults to Route & Field so existing endpoints fail
   * closed for Workforce-only tenants; HRM compatibility adapters opt in
   * explicitly below.
   */
  mobileCapability?: MobileEndpointCapability
}

type MtmRlsCapabilityOption = FieldTenantCapabilityId | WithMtmRlsAuthOptions

function withMtmTenantCapabilityWebRlsAuth<C = unknown>(
  action: Action | undefined,
  tenantCapability: FieldTenantCapabilityId,
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  return withRlsAuth<C>("mtm", action, async (req, auth, ctx) => {
    const denied = await requireTenantCapabilityAccessResponse(auth.orgId, tenantCapability)
    if (denied) return denied
    return handler(req, auth, ctx)
  }, { deferLegacyModuleGate: "mtm" })
}

/**
 * The Field APK reaches these legacy direct APIs in addition to /mobile/sync.
 * Keep their tenant gate at the common mobile/RLS boundary so a client cannot
 * bypass the bootstrap manifest by calling a route endpoint directly. Web and
 * API-key callers keep their existing RBAC path unchanged.
 */
export function mtmMobileModuleForPath(pathname: string): Exclude<MtmMobileTenantModule, "commercial"> | null {
  // Documents use the direct withMobileRls boundary below; photo uploads share
  // this wrapper and are handled by the explicit media capability helper.
  if (pathname.includes("/documents") || pathname.includes("/evidence")) return null
  const routeFieldPrefixes = [
    "/api/v1/mtm/routes",
    "/api/v1/mtm/customers",
    "/api/v1/mtm/contacts",
    "/api/v1/mtm/organizations",
    "/api/v1/mtm/customer-create-requests",
    "/api/v1/mtm/visits",
    "/api/v1/mtm/tasks",
    "/api/v1/mtm/field-potentials",
    "/api/v1/mtm/field-assignments",
    "/api/v1/mtm/week",
    "/api/v1/mtm/route-change-requests",
  ]
  if (routeFieldPrefixes.some((prefix) => pathname.startsWith(prefix))) return "routeField"
  return null
}

export function isMtmMobileMediaPath(pathname: string): boolean {
  return pathname.startsWith("/api/v1/mtm/photos")
}

/**
 * Explicit dual-principal boundary for MTM endpoints used by both the web UI
 * and the field app. Web/API-key callers keep requireAuth RBAC; mobile callers
 * use the fully revoked mobile JWT path. Both branches run under tenant RLS.
 *
 * A fourth string argument is kept for existing Route & Field/Workforce
 * wrappers. Newer callers may use `WithMtmRlsAuthOptions` to select only the
 * mobile capability while retaining their existing web RBAC path.
 */
export function withMtmRlsAuth<C = unknown>(
  module: Module | string | undefined,
  action: Action | undefined,
  handler: (req: NextRequest, auth: MtmRlsAuth, ctx: C) => Promise<Response> | Response,
  capabilityOption?: MtmRlsCapabilityOption,
) {
  const tenantCapability = typeof capabilityOption === "string" ? capabilityOption : undefined
  const webHandler = tenantCapability
    ? withMtmTenantCapabilityWebRlsAuth<C>(action, tenantCapability, (req, auth, ctx) => handler(req, {
      ...auth,
      agentId: null,
      principal: "web",
    }, ctx))
    : withRlsAuth<C>(module, action, (req, auth, ctx) => handler(req, {
      ...auth,
      agentId: null,
      principal: "web",
    }, ctx))

  // The capability resolved together with token revocation is authoritative.
  // Do not re-read Organization here: a second lookup can disagree with the
  // authenticated snapshot and weaken the common fail-closed mobile boundary.
  const mobileCapability = typeof capabilityOption === "object"
    ? capabilityOption.mobileCapability
    : tenantCapability ?? (module === "mtm" ? "route-field" : undefined)
  const mobileHandler = withMobileRls<C>(async (req, auth, ctx) => {
    const pathname = new URL(req.url).pathname
    if (isMtmMobileMediaPath(pathname)) {
      const mediaForbidden = await requireMtmMobileMediaAccess(auth)
      if (mediaForbidden) return mediaForbidden
    }
    return handler(req, {
      ...auth,
      agentId: auth.agentId,
      principal: "mobile",
    }, ctx)
  }, mobileCapability ? { requiredCapability: mobileCapability } : undefined)

  const wrapped = async (req: NextRequest, ctx?: C): Promise<Response> => {
    // A valid mobile signature selects the mobile branch. Revocation and org
    // activity are re-checked by withMobileRls before the handler is entered.
    if (getMobileAuth(req)) return mobileHandler(req, ctx as C)
    return webHandler(req, ctx as C)
  }

  return wrapped as WrappedMtmRouteHandler<C>
}

/** Route and visit handlers that are safe for a Routes-only tenant. */
export function withRouteFieldRlsAuth<C = unknown>(
  action: Action | undefined,
  handler: (req: NextRequest, auth: MtmRlsAuth, ctx: C) => Promise<Response> | Response,
) {
  return withMtmRlsAuth("mtm", action, handler, "route-field")
}

/**
 * Web/API-key-only Route & Field boundary for compatibility endpoints that
 * never accepted a mobile JWT.
 */
export function withRouteFieldWebRlsAuth<C = unknown>(
  action: Action | undefined,
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  return withMtmTenantCapabilityWebRlsAuth(action, "route-field", handler)
}

/** Workforce-only handlers retain MTM RBAC but use the HRM tenant gate. */
export function withWorkforceHrmRlsAuth<C = unknown>(
  action: Action | undefined,
  handler: (req: NextRequest, auth: MtmRlsAuth, ctx: C) => Promise<Response> | Response,
) {
  return withMtmRlsAuth("mtm", action, handler, "workforce-hrm")
}
