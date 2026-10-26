import { NextRequest, NextResponse } from "next/server"
import {
  isAuthError,
  requireSessionAuth,
} from "@/lib/api-auth"
import type { Role } from "@/lib/permissions"

export type ChannelsAccess = {
  orgId: string
  role: Extract<Role, "admin" | "superadmin">
  /**
   * Who is acting. Channel config holds third-party credentials, so every change to it is written
   * to the audit log — and an audit entry without an actor answers none of the questions an audit
   * is for ("who rotated this secret, and when").
   */
  userId: string
}

/**
 * Shared access gate for the channels-config API ([P3]). Returns `{ orgId }` to proceed, or a `NextResponse`
 * to short-circuit — callers do `if (g instanceof NextResponse) return g`.
 *
 * Layers (do NOT conflate):
 *  - Org-scoping at the query layer (`where: { organizationId }`) is the CROSS-TENANT security boundary.
 *  - This helper decides WHO in the organisation may touch channel config: a session admin, never an API key.
 *
 * Until 2026-10-26 it was also a billing gate — only tenants with the `omnichannel` module (or an existing
 * channel row) could set channels up. The owner moved Channels into Settings for every tenant: WhatsApp, Telegram
 * and e-mail serve MTM notifications, sales and support, not only the Omni-channel inbox («каналы могут
 * использоваться в разных модулях»). The inbox itself stays behind `omnichannel`.
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

  const { orgId, role, userId } = session
  return { orgId, role, userId }
}
