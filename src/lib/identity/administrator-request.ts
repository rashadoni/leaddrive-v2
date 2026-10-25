import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { requireSessionAuth } from "@/lib/api-auth"
import { requireAuthSecret } from "@/lib/auth-secret"
import { parseIdentityCrmClaims } from "./crm-session"
import type { IdentityAdministrator } from "./administrator"

const refusal = () => NextResponse.json({ error: "IDENTITY_ADMIN_REQUIRED" }, { status: 403, headers: { "cache-control": "private, no-store" } })

/** Auth.js performs fresh cookie/MFA/tenant admission first. Read the private
 * hint only from the authenticated encrypted JWT, never /api/auth/session or
 * request JSON. The transaction service revalidates its epoch/claim/grant. */
export async function requireIdentityAdministrator(req: NextRequest): Promise<IdentityAdministrator | NextResponse> {
  const session = await requireSessionAuth(req)
  if (session instanceof NextResponse) return session
  if (session.principalType !== "session" || !["admin", "superadmin"].includes(session.role)) return refusal()
  try {
    const secret = requireAuthSecret()
    const configuredUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
    const secureCookie = configuredUrl ? new URL(configuredUrl).protocol === "https:"
      : process.env.NODE_ENV === "production" || req.nextUrl.protocol === "https:"
    const token = await getToken({ req, secret, secureCookie })
    if (!token || token.sub !== session.userId || token.organizationId !== session.orgId || token.needs2fa || token.needsSetup2fa) return refusal()
    const scope = { organizationId: session.orgId, userId: session.userId }
    if (token.identityCrm === undefined) return { ...scope, mode: "LEGACY" }
    const claims = parseIdentityCrmClaims(token.identityCrm)
    if (!claims || claims.userId !== scope.userId || claims.organizationId !== scope.organizationId) return refusal()
    return { ...scope, mode: "CANONICAL", claims }
  } catch { return refusal() }
}
