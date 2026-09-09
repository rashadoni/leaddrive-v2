/**
 * What this tenant's browser may do about calls.
 *
 * One boolean, and it exists so the call button does not have to guess. The
 * alternative — render it everywhere and let the click fail — would show a
 * feature to every tenant that does not have it and teach them the product is
 * broken. The alternative to THAT, a build-time flag, cannot vary per tenant,
 * which is exactly what a staged rollout needs it to do.
 *
 * Says nothing about why. A user who may not place browser calls has no use for
 * the difference between "your organisation is not in the rollout" and "the
 * deployment has the feature switched off entirely".
 */
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { getOrgModuleContext } from "@/lib/api-auth"
import { checkPermission } from "@/lib/permissions"
import { browserSoftphoneAllowed } from "@/lib/voip/browser-softphone"

export const dynamic = "force-dynamic"

export const GET = withRlsAuth("voip", "read", async (_req, { orgId, role, userId }) => {
  const org = await getOrgModuleContext(orgId).catch(() => null)
  // The user matters, not just the tenant: during a rollout the button has
  // to be absent for everyone who is not in the pilot, not merely refused
  // when they press it.
  return NextResponse.json({
    browserCalls: checkPermission(role, "voip", "write")
      && browserSoftphoneAllowed(org?.modules, userId),
  })
})
