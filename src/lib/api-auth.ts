import { NextRequest, NextResponse } from "next/server"
import { auth } from "./auth"
import { prisma } from "./prisma"
import { runWithRlsBypass, enterTenantContext } from "./rls-context"
import { isMtmApiPath } from "./mtm/mobile-api-path"
import { isMtmWebOnlyPath } from "./mtm-web-only"
import { checkPermission, resolveModuleFromPath, methodToAction, PERMISSION_MODULE_TO_MODULE_ID, type Role, type Module, type Action } from "./permissions"
import { hasModule, moduleRecordFromOrgFields, type ModuleId, MODULE_REGISTRY } from "./modules"
import { getMobileAuth, resolveMobileAuth } from "./mobile-auth"
import crypto from "crypto"

// In-memory cache for org status + module access checks
const orgCache = new Map<string, { checkedAt: number; isActive: boolean; plan: string; addons: string[]; modules: Record<string, boolean> }>()
const ORG_CACHE_INTERVAL = 30_000 // 30 seconds

// In-memory cache for orgId → slug (used for cross-tenant binding check)
const orgSlugCache = new Map<string, { checkedAt: number; slug: string }>()
const ORG_SLUG_CACHE_INTERVAL = 60_000 // 60 seconds — slug rarely changes

/**
 * Module gate for routes that authenticate via getSession/getOrgId (which do
 * NOT gate modules) instead of requireAuth (which gates inline). Reuses the
 * same org cache + features→modules materialisation as requireAuth, so the
 * result is identical.
 *
 * Fail-OPEN on a DB/cache error is DELIBERATE (not inherited-by-analogy): if the
 * org load throws, the DB is down — so the calling route's OWN data query fails
 * too and serves nothing, meaning fail-open here cannot leak paid data, whereas
 * fail-closed would 403 paying customers during a transient blip. (Consistent
 * with requireAuth's non-critical catch.) Callers should skip it for superadmins.
 *
 *   const session = await getSession(req)
 *   const orgId = session?.orgId || (await getOrgId(req))
 *   if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "crm")))
 *     return moduleDisabledResponse("crm")
 */
export async function orgHasModule(orgId: string, moduleId: ModuleId): Promise<boolean> {
  try {
    const ctx = await loadOrgContext(orgId)
    return hasModule({ plan: ctx.plan, addons: ctx.addons, modules: ctx.modules }, moduleId)
  } catch {
    // Fail-OPEN: DB down → route's own data query will fail too → no leak.
    return true
  }
}

/**
 * Internal: load (or return cached) org plan/addons/modules for the given orgId.
 * Shared by orgHasModule and getOrgModuleContext so the DB query is never duplicated.
 * Fail-OPEN on DB error (consistent with requireAuth and orgHasModule).
 */
async function loadOrgContext(orgId: string): Promise<{ isActive: boolean; plan: string; addons: string[]; modules: Record<string, boolean> }> {
  const now = Date.now()
  const cached = orgCache.get(orgId)
  if (cached && now - cached.checkedAt < ORG_CACHE_INTERVAL) {
    return cached
  }
  let isActive = false
  let plan = "starter"
  let addons: string[] = []
  const modules: Record<string, boolean> = {}
  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { isActive: true, plan: true, addons: true, features: true, modules: true },
    })
    isActive = org?.isActive ?? false
    plan = org?.plan || "starter"
    addons = (org?.addons as string[]) || []
    Object.assign(modules, moduleRecordFromOrgFields({
      features: org?.features,
      modules: org?.modules,
    }))
  } catch {
    // Fail-OPEN: DB down → route's own data query will fail too → no leak.
  }
  const ctx = { checkedAt: now, isActive, plan, addons, modules }
  orgCache.set(orgId, ctx)
  return ctx
}

/**
 * Tenant suspension is a revocation event, so it must never use the 30-second
 * module/plan cache. A stale "active" value would otherwise keep browser
 * sessions usable after an administrator disables the organization. Database
 * errors fail closed because this check is part of authentication, not an
 * optional feature gate.
 */
async function organizationIsActiveFresh(orgId: string): Promise<boolean> {
  try {
    const organization = await runWithRlsBypass(() => prisma.organization.findUnique({
      where: { id: orgId },
      select: { isActive: true },
    }))
    return organization?.isActive === true
  } catch {
    return false
  }
}

/**
 * Returns the org's plan/addons/modules for use with canNotifySection / NotificationAccessCtx.
 * Reuses the same in-memory cache as orgHasModule.
 * Fail-OPEN on DB error (never blocks API responses).
 */
export async function getOrgModuleContext(orgId: string): Promise<{ plan: string; addons: string[]; modules: Record<string, boolean> }> {
  const { plan, addons, modules } = await loadOrgContext(orgId)
  return { plan, addons, modules }
}

/** Standard 403 for a disabled module (shared by getOrgId-based route guards). */
export function moduleDisabledResponse(moduleId: string): NextResponse {
  return NextResponse.json(
    { error: "Forbidden", message: `Module "${moduleId}" is not enabled for your organization.` },
    { status: 403 }
  )
}

async function getOrgSlug(orgId: string): Promise<string> {
  const now = Date.now()
  const cached = orgSlugCache.get(orgId)
  if (cached && now - cached.checkedAt < ORG_SLUG_CACHE_INTERVAL) return cached.slug
  try {
    // RLS: runs during auth bootstrap (before tenant context exists);
    // organizations is a global table today, wrapped anyway for future-proofing.
    const org = await runWithRlsBypass(() => prisma.organization.findUnique({
      where: { id: orgId },
      select: { slug: true },
    }))
    const slug = org?.slug || ""
    orgSlugCache.set(orgId, { checkedAt: now, slug })
    return slug
  } catch {
    return cached?.slug ?? ""
  }
}

/**
 * Cross-tenant binding defense-in-depth: middleware already redirects browser
 * traffic on a tenant subdomain whose session belongs to a different org, but
 * direct API calls (or a race where middleware didn't block) get a second
 * check here. Compares the x-tenant-slug header (set by middleware from the
 * {slug}.leaddrivecrm.org host) against the slug of the authenticated org.
 * Superadmin is intentionally not exempt: cross-tenant admin work belongs on
 * the app-host admin surface, not on a tenant's normal CRM/API subdomain.
 * Returns true if allowed, false if mismatch.
 */
async function tenantBindingOk(req: NextRequest, orgId: string): Promise<boolean> {
  const tenantSlug = req.headers.get("x-tenant-slug")
  if (!tenantSlug) return true // not on a tenant subdomain
  if (!orgId) return false
  const orgSlug = await getOrgSlug(orgId)
  return orgSlug === tenantSlug
}

export interface AuthResult {
  orgId: string
  userId: string
  role: Role
  email: string
  name: string
  /**
   * Authentication provenance. Production resolvers always set this. It is
   * optional at the type boundary for compatibility with narrow internal/test
   * AuthResult fixtures; security-sensitive consumers must compare it to an
   * exact value and therefore fail closed when older fixtures omit it.
   */
  principalType?: "session" | "api_key"
}

/**
 * Narrow escape hatch for a compatibility split where an existing permission
 * scope (`mtm`) is retained but its historical tenant-module entitlement is
 * replaced by a capability check inside the tenant RLS frame. This is kept
 * deliberately closed to every module except `mtm`; callers must pair it with
 * `requireTenantCapabilityAccessResponse` before reading domain data.
 */
export interface RequireAuthOptions {
  deferLegacyModuleGate?: "mtm"
}

type SessionUserSecurityClaims = {
  needs2fa?: boolean
  needsSetup2fa?: boolean
}

type CookieSessionResolution =
  | { session: AuthResult; denial?: never }
  | { session?: never; denial: "unauthenticated" | "2fa" | "inactive_organization" }

/**
 * Resolve only an Auth.js browser session. This helper deliberately has no
 * API-key or mobile-token fallback: callers use it for self-service operations
 * whose target identity must be the human represented by the session cookie.
 *
 * auth()'s JWT callback performs the fresh password/session-fingerprint check.
 * The checks below add the same MFA and active-tenant floor used by the public
 * auth helpers before a route can receive an AuthResult.
 */
async function resolveCookieSession(): Promise<CookieSessionResolution> {
  try {
    const rawSession = await auth()
    if (!rawSession?.user) return { denial: "unauthenticated" }

    const securityClaims = rawSession.user as SessionUserSecurityClaims
    if (securityClaims.needs2fa || securityClaims.needsSetup2fa) {
      return { denial: "2fa" }
    }

    const session: AuthResult = {
      orgId: rawSession.user.organizationId || "",
      userId: rawSession.user.id || "",
      role: (rawSession.user.role || "viewer") as Role,
      email: rawSession.user.email || "",
      name: rawSession.user.name || "",
      principalType: "session",
    }
    if (!session.orgId || !session.userId) {
      return { denial: "unauthenticated" }
    }

    if (session.role !== "superadmin") {
      if (!(await organizationIsActiveFresh(session.orgId))) {
        return { denial: "inactive_organization" }
      }
    }

    return { session }
  } catch {
    return { denial: "unauthenticated" }
  }
}

/**
 * Get authenticated session with organization context.
 * SECURITY: Always uses organizationId from the authenticated session JWT,
 * never trusts the x-organization-id header directly (prevents tenant bypass).
 */
export async function getSession(_req: NextRequest): Promise<AuthResult | null> {
  void _req
  const resolved = await resolveCookieSession()
  if (!resolved.session) return null

  // RLS: enter the tenant context here too. Many routes resolve the org via
  // `getSession(req)` and short-circuit before ever calling getOrgId/requireAuth
  // (e.g. `session?.orgId || await getOrgId(req)`), so without this the Postgres
  // RLS policies would fail-closed and return zero rows on that path. Mirrors the
  // entry getOrgId/requireAuth already do; enterTenantContext refuses empty orgId.
  enterTenantContext(resolved.session.orgId)
  return resolved.session
}

/**
 * Require an Auth.js browser session, with no API-key or mobile-token fallback.
 * Use this for `/users/me`-style routes: an API key has a creator id for audit
 * purposes, but it must never impersonate that creator for personal-account
 * mutations (email, password, avatar, delegations, session revocation, etc.).
 */
export async function requireSessionAuth(req: NextRequest): Promise<AuthResult | NextResponse> {
  const resolved = await resolveCookieSession()
  if (!resolved.session) {
    if (resolved.denial === "2fa") {
      return NextResponse.json({ error: "2FA verification required" }, { status: 403 })
    }
    if (resolved.denial === "inactive_organization") {
      return NextResponse.json(
        { error: "Organization is deactivated. Contact your administrator." },
        { status: 403 },
      )
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!(await tenantBindingOk(req, resolved.session.orgId))) {
    // Keep tenant-binding denials indistinguishable from other authorization
    // failures. Revealing the mismatch gives an attacker an organization-slug
    // enumeration oracle without helping a legitimate client recover.
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  enterTenantContext(resolved.session.orgId)
  return resolved.session
}

/**
 * Authenticate via API key (Authorization: Bearer ld_...).
 * Returns AuthResult if valid, null otherwise.
 * Updates lastUsedAt on successful auth.
 */
type ApiKeyAuthResult = AuthResult & {
  principalType: "api_key"
  scopes: string[]
  moduleContext: { plan: string; addons: string[]; modules: Record<string, boolean> }
}

function apiKeyHasModule(authResult: ApiKeyAuthResult, resolvedModule: string): boolean {
  const gateModule = PERMISSION_MODULE_TO_MODULE_ID[resolvedModule] ?? resolvedModule
  if (!(gateModule in MODULE_REGISTRY)) return true
  return hasModule(authResult.moduleContext, gateModule as ModuleId)
}

async function getApiKeyAuth(req: NextRequest): Promise<ApiKeyAuthResult | null> {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ld_")) return null

  const rawKey = authHeader.slice(7) // Remove "Bearer "
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex")

  try {
    // RLS: api_keys lookup happens BEFORE any tenant context exists — bypass-wrapped.
    const apiKey = await runWithRlsBypass(() => prisma.apiKey.findFirst({
      where: { keyHash, isActive: true },
      include: {
        organization: {
          select: { isActive: true, plan: true, addons: true, features: true, modules: true },
        },
      },
    }))
    if (!apiKey) return null
    if (apiKey.organization?.isActive !== true) return null
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null

    // Update lastUsedAt (non-blocking)
    runWithRlsBypass(() => prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })).catch(() => {})

    return {
      orgId: apiKey.organizationId,
      userId: apiKey.createdBy,
      role: "admin" as Role,
      email: "",
      name: `API Key: ${apiKey.name}`,
      principalType: "api_key",
      scopes: apiKey.scopes,
      moduleContext: {
        plan: apiKey.organization.plan || "starter",
        addons: (apiKey.organization.addons as string[]) || [],
        modules: moduleRecordFromOrgFields({
          features: apiKey.organization.features,
          modules: apiKey.organization.modules,
        }),
      },
    }
  } catch {
    return null
  }
}

/**
 * Get organizationId from authenticated session or API key.
 * For API key: also validates scopes against the request method and path.
 *
 * SECURITY (FIX 2): mobile JWTs are accepted ONLY when the request path is
 * under an explicit versioned MTM namespace. Presenting a mobile token on any other path is silently
 * rejected (treated as unauthenticated) — a fail-loud warn is logged so any
 * unexpected cross-path hit is visible in PM2 logs.
 */
export async function getOrgId(req: NextRequest): Promise<string | null> {
  const session = await getSession(req)
  if (session?.orgId) {
    enterTenantContext(session.orgId)
    return session.orgId
  }

  // Try mobile JWT auth (field agent app) — ONLY for approved MTM API paths.
  // FIX 2: restrict mobile JWT scope to the MTM namespace.
  // FIX 3: run the revocation check (agent ACTIVE + org isActive) on every hit.
  const pathname = (() => {
    try { return new URL(req.url).pathname } catch { return "" }
  })()
  if (isMtmApiPath(pathname) && !isMtmWebOnlyPath(pathname)) {
    const mobileAuth = await resolveMobileAuth(req)
    if (mobileAuth?.orgId) {
      enterTenantContext(mobileAuth.orgId)
      return mobileAuth.orgId
    }
  } else {
    // A mobile token presented outside /mtm/ OR on a web-only MTM route — fail
    // loud, do not accept (the route then 401s for the mobile principal).
    const quickDecode = getMobileAuth(req)
    if (quickDecode) {
      console.warn(
        `[mobile-auth][scope-reject] mobile JWT presented on a non-MTM / web-only path — agentId=${quickDecode.agentId} path=${pathname}`
      )
    }
  }

  const apiKeyAuth = await getApiKeyAuth(req)
  if (!apiKeyAuth) return null

  // Enforce scope check for API key requests
  const resolvedModule = resolveModuleFromPath(pathname)
  const resolvedAction = methodToAction(req.method)
  // API keys are deny-by-default on routes without an explicit scope mapping.
  // Browser sessions can still use those routes under their route-level guard,
  // but an arbitrary active key must not inherit a fail-open tenant principal.
  if (!resolvedModule) return null
  const requiredScope = `${resolvedAction === "read" ? "read" : "write"}:${resolvedModule}`
  if (!apiKeyAuth.scopes.includes(requiredScope) && !apiKeyAuth.scopes.includes(`write:${resolvedModule}`)) {
    return null // Deny — missing scope
  }
  if (!apiKeyHasModule(apiKeyAuth, resolvedModule)) return null

  enterTenantContext(apiKeyAuth.orgId)
  return apiKeyAuth.orgId
}

/**
 * Require authentication + permission check.
 *
 * Usage in API routes:
 *   const auth = await requireAuth(req, "projects", "write")
 *   if (auth instanceof NextResponse) return auth  // 401 or 403
 *   // auth is AuthResult — proceed
 *
 * Or auto-resolve from URL:
 *   const auth = await requireAuth(req)
 *   if (auth instanceof NextResponse) return auth
 */
export async function requireAuth(
  req: NextRequest,
  module?: Module | string,
  action?: Action,
  options?: RequireAuthOptions,
): Promise<AuthResult | NextResponse> {
  // Try session auth first, then API key
  const rawSession = await auth()
  if (!rawSession?.user) {
    // SECURITY (FIX 1): mobile JWTs are NOT permitted on requireAuth routes.
    // requireAuth enforces RBAC, org-status, tenant-binding, and password-changed
    // checks that are irrelevant to or incompatible with the mobile JWT principal.
    // The MTM mobile app authenticates via requireMobileAuth / getOrgId exclusively.
    const mobileAuth = getMobileAuth(req)
    if (mobileAuth) {
      const pathname = (() => { try { return new URL(req.url).pathname } catch { return "?" } })()
      console.warn(
        `[mobile-auth][requireAuth-reject] mobile JWT rejected on requireAuth endpoint — agentId=${mobileAuth.agentId} path=${pathname}`
      )
      return NextResponse.json(
        { error: "Unauthorized", message: "Mobile tokens are not permitted on this endpoint" },
        { status: 401 }
      )
    }

    // Fallback to API key auth
    const apiKeyAuth = await getApiKeyAuth(req)
    if (apiKeyAuth) {
      // Check scope permission for API key
      const resolvedModule = module || resolveModuleFromPath(new URL(req.url).pathname)
      const resolvedAction = action || methodToAction(req.method)
      if (!resolvedModule) {
        return NextResponse.json(
          { error: "Forbidden", message: "API keys are not permitted on an unscoped route" },
          { status: 403 },
        )
      }
      const requiredScope = `${resolvedAction === "read" ? "read" : "write"}:${resolvedModule}`
      if (!apiKeyAuth.scopes.includes(requiredScope) && !apiKeyAuth.scopes.includes(`write:${resolvedModule}`)) {
        return NextResponse.json({ error: "Forbidden", message: `API key missing scope: ${requiredScope}` }, { status: 403 })
      }
      const gateModule = PERMISSION_MODULE_TO_MODULE_ID[resolvedModule] ?? resolvedModule
      const deferLegacyMtmGate =
        options?.deferLegacyModuleGate === "mtm" &&
        resolvedModule === "mtm" &&
        gateModule === "mtm"
      if (!deferLegacyMtmGate && !apiKeyHasModule(apiKeyAuth, resolvedModule)) {
        return moduleDisabledResponse(gateModule)
      }
      if (!(await tenantBindingOk(req, apiKeyAuth.orgId))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      enterTenantContext(apiKeyAuth.orgId)
      return apiKeyAuth
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // SECURITY: Block API access if 2FA verification is pending
  const securityClaims = rawSession.user as SessionUserSecurityClaims
  const needs2fa = securityClaims.needs2fa
  const needsSetup2fa = securityClaims.needsSetup2fa
  if (needs2fa || needsSetup2fa) {
    return NextResponse.json({ error: "2FA verification required" }, { status: 403 })
  }

  const session: AuthResult = {
    orgId: rawSession.user.organizationId || "",
    userId: rawSession.user.id || "",
    role: (rawSession.user.role || "viewer") as Role,
    email: rawSession.user.email || "",
    name: rawSession.user.name || "",
    principalType: "session",
  }

  // SECURITY: Cross-tenant binding check (defense-in-depth; middleware enforces
  // the primary check on page navigation, this catches direct API calls).
  if (!(await tenantBindingOk(req, session.orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Password/session revocation is validated inside auth()'s JWT callback on
  // every cookie resolution using an exact DB-derived fingerprint. There is no
  // request-local or process-local TTL here: a password write that commits
  // before this request is resolved invalidates the cookie immediately, and a
  // DB validation error makes auth() return no session (fail closed).

  // SECURITY: Check org status + module access (tenant deactivation + feature gating).
  // Organization status is intentionally loaded fresh on every request: tenant
  // suspension is session revocation and must not inherit the module cache TTL.
  let orgContext: { plan: string; addons: string[]; modules: Record<string, boolean> } | null = null
  if (session.orgId && session.role !== "superadmin") {
    try {
      const now = Date.now()
      // RLS: org-status check runs before tenant context is entered — bypass-wrapped.
      const org = await runWithRlsBypass(() => prisma.organization.findUnique({
        where: { id: session.orgId },
        select: { isActive: true, plan: true, addons: true, features: true, modules: true },
      }))
      const isActive = org?.isActive === true
      const plan = org?.plan || "starter"
      const addons = (org?.addons as string[]) || []
      const modules = moduleRecordFromOrgFields({
        features: org?.features,
        modules: org?.modules,
      })
      orgCache.set(session.orgId, { checkedAt: now, isActive, plan, addons, modules })

      if (!isActive) {
        return NextResponse.json({ error: "Organization is deactivated. Contact your administrator." }, { status: 403 })
      }
      orgContext = { plan, addons, modules }
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  // Resolve module and action from request if not explicitly provided
  const resolvedModule = module || resolveModuleFromPath(new URL(req.url).pathname)
  const resolvedAction = action || methodToAction(req.method)

  // Check permission if we could resolve a module
  if (resolvedModule) {
    const allowed = checkPermission(session.role, resolvedModule, resolvedAction)
    if (!allowed) {
      return NextResponse.json(
        {
          error: "Forbidden",
          message: `Role "${session.role}" cannot "${resolvedAction}" on "${resolvedModule}"`,
        },
        { status: 403 }
      )
    }

    // Check if the module is enabled for this organization. Bridge the
    // permissions name → ModuleId first so renamed modules (kb→knowledge-base,
    // inbox→omnichannel, energy-utilities→energy) are gated, not skipped.
    const gateModule = PERMISSION_MODULE_TO_MODULE_ID[resolvedModule] ?? resolvedModule
    const deferLegacyMtmGate =
      options?.deferLegacyModuleGate === "mtm" &&
      resolvedModule === "mtm" &&
      gateModule === "mtm"
    if (orgContext && gateModule in MODULE_REGISTRY && !deferLegacyMtmGate) {
      if (!hasModule(orgContext, gateModule as ModuleId)) {
        return NextResponse.json(
          { error: "Forbidden", message: `Module "${gateModule}" is not enabled for your organization.` },
          { status: 403 }
        )
      }
    }
  }

  // RLS: bind tenant context to the remainder of this request. MUST stay the
  // last statement before the single success return — every 401/403 gate above
  // returns without entering a context (fail-closed). Superadmin sessions enter
  // their own org here; requireSuperAdmin upgrades to bypass right after.
  enterTenantContext(session.orgId)
  return session
}

/**
 * Helper to check if requireAuth returned an error response.
 */
export function isAuthError(result: AuthResult | NextResponse): result is NextResponse {
  return result instanceof NextResponse
}
