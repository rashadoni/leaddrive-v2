import { NextRequest } from "next/server"
import { getMobileAuth } from "@/lib/mobile-auth"
import type { Action } from "@/lib/permissions"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"

export interface WorkforceCompatAuth {
  orgId: string
  userId: string
  role: string
  email: string
  name: string
  agentId: string | null
  principal: "web" | "mobile"
  /** Fresh mobile entitlement flags; web callers resolve the same values from Organization. */
  attendanceQr: boolean
  attendanceDeviceTrust: boolean
}

type WrappedWorkforceCompatHandler<C> = {
  (req: NextRequest): Promise<Response>
  (req: NextRequest, ctx: C): Promise<Response>
}

/**
 * Independent Workforce authorization for legacy dual-principal endpoints.
 *
 * Old URLs stay compatible, but their web/API-key branch must no longer
 * require Route & Field (`mtm`). Mobile principals use the same live
 * `workforce-hrm` capability gate as the new mobile endpoints.
 */
export function withWorkforceCompatAuth<C = unknown>(
  action: Action,
  handler: (
    req: NextRequest,
    auth: WorkforceCompatAuth,
    ctx: C,
  ) => Promise<Response> | Response,
) {
  const webHandler = withWorkforceRlsAuth<C>(action, (req, auth, ctx) => handler(req, {
    ...auth,
    agentId: null,
    principal: "web",
    attendanceQr: false,
    attendanceDeviceTrust: false,
  }, ctx))
  const mobileHandler = withMobileRls<C>((req, auth, ctx) => handler(req, {
    ...auth,
    agentId: auth.agentId,
    principal: "mobile",
    attendanceQr: auth.tenantCapabilities.attendanceQr === true,
    attendanceDeviceTrust: auth.tenantCapabilities.attendanceDeviceTrust === true,
  }, ctx), { requiredCapability: "workforce-hrm" })

  const wrapped = async (req: NextRequest, ctx?: C): Promise<Response> => {
    if (getMobileAuth(req)) return mobileHandler(req, ctx as C)
    return webHandler(req, ctx as C)
  }

  return wrapped as WrappedWorkforceCompatHandler<C>
}
