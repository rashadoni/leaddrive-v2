import { NextRequest, NextResponse } from "next/server"
import {
  getOrgId,
  getSession,
  requireAuth,
  requireSessionAuth,
  isAuthError,
  type AuthResult,
  type RequireAuthOptions,
} from "./api-auth"
import {
  checkPermission,
  methodToAction,
  resolveModuleFromPath,
  type Module,
  type Action,
} from "./permissions"
import { runWithTenant, runWithRlsBypass } from "./rls-context"

/** What withRls hands the wrapped handler: the resolved tenant + (when present)
 *  the full session. Resolved ONCE under bypass so the handler never re-calls
 *  getSession/getOrgId inside the runWithTenant scope (the 2026-06-11 double-
 *  resolve bug). `session` is null for non-session principals (mobile-JWT,
 *  api-key) — those routes use `orgId` only. */
export interface RlsAuth {
  orgId: string
  session: AuthResult | null
}

type WrappedRouteHandler<C> = {
  (req: NextRequest): Promise<Response>
  (req: NextRequest, ctx: C): Promise<Response>
}

/**
 * Route factory that makes Postgres RLS work for a tenant-scoped API handler.
 *
 * THE FIX (2026-06-11 incident): tenant context entered inside the auth guards
 * (getSession/getOrgId/requireAuth) is set INSIDE next-auth's `auth()` snapshot
 * frame and does NOT survive into the route handler's continuation, so the
 * Prisma extension reads no context → RLS fail-closes → empty data. Proven on
 * prod (4-point probe + RLS-ON differential: bare-inline count=0 vs withRls
 * count=16 on the IDENTICAL query — only diff is the runWithTenant wrap).
 *
 * The reliable shape, in the route's OWN frame:
 *  1. resolve {orgId, session} UNDER `runWithRlsBypass` — getSession/getOrgId →
 *     auth() hits Prisma (the user lookup); without bypass that lookup itself
 *     fail-closes under RLS before orgId is even known.
 *  2. run the handler body UNDER `runWithTenant(orgId, …)` — `.run` is
 *     snapshot-proof; the query executes inside the scoped callback, so the
 *     extension reads ctx and injects `set_config('app.org_id', …)`.
 *
 * Usage: `export const GET = withRls(async (req, { orgId, session }) => { … })`.
 * The handler MUST use the passed orgId/session and MUST NOT re-call
 * getSession/getOrgId(req) — a second auth() inside runWithTenant is the exact
 * double-resolve the incident codemod left in (extra DB hit + empty-query risk).
 *
 * INVARIANT: inside the body, re-enter context only via enterTenantContext(orgId)
 * (idempotent) or runWithRlsBypass (self-restoring .run). NEVER bare
 * `enterRlsBypass()` inside the body — it would overwrite the tenant frame for
 * the rest of the continuation and silently drop RLS scoping in the tail.
 */
/**
 * The authorization `withRls` used to skip entirely.
 *
 * `withRls` resolves the tenant and 401s when it cannot. That is authentication;
 * it says nothing about whether this principal may perform this action. Until
 * 2026-08-29, 144 routes accepted POST/PUT/PATCH/DELETE through it with no role
 * check of any kind, so a `viewer` — defined as `{"*": ["read"]}` — could write
 * anywhere, a `sales` user could edit invoices and pricing, and `ticketing`
 * could edit deals. None of that is what ROLE_PERMISSIONS says.
 *
 * The check applies only to SESSION principals, because only they carry a role.
 * Mobile-JWT callers (field agents, `/api/v1/mtm/*`) and API keys resolve
 * through `getOrgId` with `session === null`; they are gated by
 * `resolveMobileAuth` and by API-key scopes in `requireAuth` respectively, and
 * running them through a role model they have no role in would deny every one.
 *
 * Module resolution matches `requireAuth` deliberately — same
 * `resolveModuleFromPath`, same `methodToAction` — so a route behaves the same
 * whichever wrapper it uses. An unmapped path yields `null` and is left alone,
 * exactly as `requireAuth` leaves it: adding a mapping is what turns the check
 * on for those, and `ROUTE_MODULE_MAP` is the one place to do it.
 *
 * Not included: the org-level module gate (`hasModule`) that `requireAuth` also
 * applies. That is a product-entitlement question rather than an authorization
 * one, it needs an extra org read on every request, and mixing the two would
 * make a 403 ambiguous between "your role may not" and "your plan does not
 * include this".
 */
function roleDenial(req: NextRequest, session: AuthResult | null): NextResponse | null {
  if (!session) return null

  let pathname: string
  try {
    pathname = new URL(req.url).pathname
  } catch {
    return null
  }

  const resolvedModule = resolveModuleFromPath(pathname)
  if (!resolvedModule) return null

  const action = methodToAction(req.method)
  if (checkPermission(session.role, resolvedModule, action)) return null

  return NextResponse.json(
    {
      error: "Forbidden",
      message: `Role "${session.role}" cannot "${action}" on "${resolvedModule}"`,
    },
    { status: 403 },
  )
}

export function withRls<C = unknown>(
  handler: (req: NextRequest, auth: RlsAuth, ctx: C) => Promise<Response> | Response,
) {
  const wrapped = async (req: NextRequest, ctx?: C): Promise<Response> => {
    let resolved: RlsAuth | null
    try {
      resolved = await runWithRlsBypass(async () => {
        const session = await getSession(req)
        // session-path gives orgId directly; mobile-JWT / api-key fall back to getOrgId.
        const orgId = session?.orgId ?? (await getOrgId(req))
        return orgId ? { orgId, session } : null
      })
    } catch (e) {
      // getSession/getOrgId mobile/api-key paths can reject; any resolve failure → 401
      // rather than letting it bubble to a 500 past the !resolved guard. Logged so an
      // auth-infra outage (e.g. DB down during the user lookup) isn't invisible.
      console.error("[withRls] auth resolve threw:", e)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!resolved) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Authorization, after the tenant is known and before the handler runs.
    const denied = roleDenial(req, resolved.session)
    if (denied) return denied

    return runWithTenant(resolved.orgId, () => handler(req, resolved as RlsAuth, ctx as C))
  }

  return wrapped as WrappedRouteHandler<C>
}

/**
 * RLS route factory for the `requireAuth`-gated routes (the RBAC cluster).
 *
 * The getOrgId/getSession routes use `withRls`. The ~278 routes that gate on
 * `requireAuth(req, module, action)` — which ALSO enforces RBAC, org-status,
 * tenant-binding, API-key scopes, and 2FA — need the SAME incident fix but
 * keep the authorization check: `requireAuth` internally calls auth() (and
 * enterTenantContext via the snapshot-trapped enterWith), so a route that calls
 * it inline inside a tenant frame both double-resolves AND fail-closes under RLS.
 *
 * THE SHAPE, in the route's OWN frame:
 *  1. resolve `requireAuth(req, module, action)` UNDER `runWithRlsBypass` — the
 *     auth() user-lookup + RBAC/org-status reads must not be RLS-filtered before
 *     the principal's orgId is known.
 *  2. if it returned a NextResponse (401/403/Unauthorized/Forbidden/2FA/cross-
 *     tenant), short-circuit with it — authorization is preserved verbatim.
 *  3. run the handler UNDER `runWithTenant(auth.orgId, …)` — snapshot-proof, so
 *     the route's queries get `set_config('app.org_id', …)`.
 *
 * Usage: `export const POST = withRlsAuth("ai", "write", async (req, auth, { params }) => { … })`.
 * `auth` is the resolved `AuthResult` ({ orgId, userId, role, email, name }). The
 * handler MUST use the passed `auth` and MUST NOT re-call requireAuth/auth()/
 * getSession/getOrgId — that is the double-resolve the incident codemod removed.
 * `module`/`action` may be omitted (requireAuth then derives them from path/method).
 */
export function withRlsAuth<C = unknown>(
  module: Module | string | undefined,
  action: Action | undefined,
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
  options?: RequireAuthOptions,
) {
  const wrapped = async (req: NextRequest, ctx?: C): Promise<Response> => {
    let auth: AuthResult | NextResponse
    try {
      auth = await runWithRlsBypass(() => options
        ? requireAuth(req, module, action, options)
        : requireAuth(req, module, action))
    } catch (e) {
      // requireAuth itself only throws on infra failure (its denials are returned
      // NextResponses, handled below). Log so a 278-route auth outage isn't masked.
      console.error("[withRlsAuth] requireAuth threw:", e)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    // requireAuth returns a NextResponse for every denial (401/403/2FA/cross-tenant).
    if (isAuthError(auth)) return auth
    return runWithTenant(auth.orgId, () => handler(req, auth as AuthResult, ctx as C))
  }

  return wrapped as WrappedRouteHandler<C>
}

/**
 * RLS route factory for personal self-service endpoints that must represent a
 * browser user. Unlike withRlsAuth, this wrapper never falls back to an API key
 * (whose `createdBy` is an audit field, not an impersonation grant) or a mobile
 * token. It retains fresh Auth.js session invalidation, MFA, active-org and
 * tenant-host binding checks, then enters the same snapshot-proof RLS scope.
 */
export function withRlsSessionAuth<C = unknown>(
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  const wrapped = async (req: NextRequest, ctx?: C): Promise<Response> => {
    let session: AuthResult | NextResponse
    try {
      session = await runWithRlsBypass(() => requireSessionAuth(req))
    } catch (e) {
      console.error("[withRlsSessionAuth] requireSessionAuth threw:", e)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (isAuthError(session)) return session
    return runWithTenant(session.orgId, () => handler(req, session as AuthResult, ctx as C))
  }

  return wrapped as WrappedRouteHandler<C>
}
