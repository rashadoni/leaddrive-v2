import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  isAuthError,
  moduleDisabledResponse,
  orgHasModule,
  requireSessionAuth,
} from "@/lib/api-auth"
import type { Role } from "@/lib/permissions"

export type ChannelsAccess = {
  orgId: string
  role: Extract<Role, "admin" | "superadmin">
}

/**
 * Shared access gate for the channels-config API ([P3]). Channel config is the omni-channel add-on
 * surface (ADDON_MODULES.channels → "omnichannel"). Returns `{ orgId }` to proceed, or a `NextResponse`
 * to short-circuit — callers do `if (g instanceof NextResponse) return g`.
 *
 * Layers (do NOT conflate):
 *  - Org-scoping at the query layer (`where: { organizationId }`) is the CROSS-TENANT security boundary.
 *  - This helper is the FEATURE/BILLING gate (a non-omnichannel tenant shouldn't self-serve channels).
 *
 * GRANDFATHER rule — pass if ANY of:
 *  1. superadmin (cross-org admin),
 *  2. org has the `omnichannel` module (the paying case),
 *  3. org ALREADY has ≥1 ChannelConfig row.
 * Clause 3 guarantees the gate NEVER locks an existing channel-using tenant out of managing their own
 * channels (incl. editing/rotating SMS creds — closes the prior [P3] caveat); it only blocks a brand-new
 * non-omnichannel tenant from starting. Made safe-by-design because verifying which tenants actually
 * hold the omnichannel add-on needs prod-DB access that is restricted.
 */
export async function gateChannelsAccess(
  req: NextRequest,
): Promise<ChannelsAccess | NextResponse> {
  // ChannelConfig contains third-party credentials and webhook secrets. It is
  // a browser-admin control plane: API keys/mobile tokens must never read or
  // mutate it, even if they otherwise hold an inbox scope.
  const session = await requireSessionAuth(req)
  if (isAuthError(session)) return session
  if (session.role !== "admin" && session.role !== "superadmin") {
    return NextResponse.json(
      { error: "Forbidden", message: "Only admins can manage channel configuration" },
      { status: 403 },
    )
  }

  const { orgId, role } = session
  if (role === "superadmin") return { orgId, role }
  if (await orgHasModule(orgId, "omnichannel")) return { orgId, role }
  const existing = await prisma.channelConfig.count({ where: { organizationId: orgId } })
  if (existing > 0) return { orgId, role } // grandfather — never lock out a tenant already using channels
  return moduleDisabledResponse("omnichannel")
}
