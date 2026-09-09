import { NextRequest, NextResponse } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import type { Action, Module } from "@/lib/permissions"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * Serializes a user-triggered Social Monitoring mutation with the clean-slate
 * reset. The complete handler stays inside the tenant advisory lock, including
 * reads, AI/provider work, CRM creation and external enqueue/delivery writes.
 */
export function withSocialMonitoringMutationFence<C = unknown>(
  module: Module | string | undefined,
  action: Action | undefined,
  handler: (
    req: NextRequest,
    auth: AuthResult,
    ctx: C,
  ) => Promise<Response> | Response,
) {
  return withRlsAuth<C>(module, action, async (req, auth, ctx) => {
    const fenced = await withSocialMonitoringTenantCollectionFence(
      auth.orgId,
      () => Promise.resolve(handler(req, auth, ctx)),
    )
    if (!fenced.allowed) {
      return NextResponse.json(
        {
          error: "Social Monitoring is paused for a clean-slate reset",
          code: fenced.reason,
        },
        { status: 409 },
      )
    }
    return fenced.value
  })
}
