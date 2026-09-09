import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { getSession, orgHasModule, moduleDisabledResponse, type AuthResult } from "@/lib/api-auth"
import { checkPermission, type Action } from "@/lib/permissions"

/**
 * Auth wrapper for the social OAuth CONNECT routes — the per-provider `start`
 * endpoints under /api/v1/social/oauth plus the provider list.
 *
 * These endpoints straddle the two modules the 2026-08-01 split separated: the
 * inbox connects Messenger / IG Direct through the very same Meta flow (button on
 * /settings/channels → channel-config-form), while social monitoring connects
 * FB/IG/TikTok/YouTube accounts to collect mentions. Pinning them to one module
 * would 403 the other module's tenants — exactly the coupling the split removed.
 * So `resolveModuleFromPath` leaves /api/v1/social/oauth/** unresolved and the
 * entitlement is checked HERE against BOTH modules.
 *
 * Three gates, each reproducing what the routes had BEFORE the split (they passed
 * `withRlsAuth("omnichannel", …)`, and `omnichannel` is not a role-matrix key nor
 * an API-scope id):
 *  1. Session-only. Leaving the path unresolved in `resolveModuleFromPath` also
 *     switches OFF requireAuth's API-key scope check (it only runs for a resolved
 *     module), so a key with ANY scope would reach the connect flow. Previously no
 *     key could: `write:omnichannel` is not a grantable scope. Browser-redirect
 *     flow ⇒ require a real session and reject key/mobile principals.
 *  2. RBAC: reads (which providers are connected — shown inside the monitoring
 *     workspace) go by the `social` scope, but STARTING a connect is integration
 *     setup — it mints provider tokens and subscribes webhooks — so it keeps the
 *     admin-only boundary it always had (these routes sat on a `settings` route
 *     scope before, and `settings` is `[]` for manager/sales/support).
 *  3. Entitlement: either module. Skipped for superadmin, mirroring requireAuth,
 *     which never applies the module gate to a superadmin session (api-auth.ts).
 */
export function withSocialConnectAuth(
  action: Action,
  handler: (req: NextRequest, auth: AuthResult) => Promise<Response> | Response,
) {
  return withRlsAuth(undefined, undefined, async (req: NextRequest, auth: AuthResult) => {
    const session = await getSession(req)
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized", message: "The social connect flow requires a signed-in session." },
        { status: 401 },
      )
    }
    const rbacScope = action === "read" ? "social" : "settings"
    if (!checkPermission(auth.role, rbacScope, action)) {
      return NextResponse.json(
        { error: "Forbidden", message: `Role "${auth.role}" cannot "${action}" on "${rbacScope}"` },
        { status: 403 },
      )
    }
    if (
      auth.role !== "superadmin" &&
      !(await orgHasModule(auth.orgId, "social")) &&
      !(await orgHasModule(auth.orgId, "omnichannel"))
    ) {
      return moduleDisabledResponse("social")
    }
    return handler(req, auth)
  })
}
