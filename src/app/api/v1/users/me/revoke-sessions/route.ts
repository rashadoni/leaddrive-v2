/**
 * POST /api/v1/users/me/revoke-sessions  — "Log out of all devices"
 *
 * Self-service. Bumps the caller's `passwordChangedAt` to now WITHOUT changing
 * the password. This changes the DB-derived session fingerprint checked by
 * Auth.js and linked MTM mobile auth on every request, so every existing token
 * is rejected immediately — including this session. The client should redirect
 * to login afterward; re-authentication mints the new fingerprint.
 *
 * passwordChangedAt is overloaded here as a generic "sessions-valid-after"
 * cutoff: it already gates session validity for password changes, so reusing it
 * for an explicit "log out everywhere" needs no schema change.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"

export const POST = withRlsSessionAuth(async (_req, session) => {
  const { orgId, userId } = session

  try {
    const result = await prisma.user.updateMany({
      where: { id: userId, organizationId: orgId },
      data: { passwordChangedAt: new Date() },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[me/revoke-sessions]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
