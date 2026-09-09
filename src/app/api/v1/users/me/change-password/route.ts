/**
 * POST /api/v1/users/me/change-password
 *
 * Self-service password change. Requires the caller to prove they know their
 * CURRENT password (defense against a hijacked-but-unlocked session silently
 * changing the password). Any authenticated user can change only their OWN
 * password — same session-cookie-only self-service pattern as users/me/*.
 *
 * SECURITY NOTE: changing passwordHash/passwordChangedAt changes the exact
 * credential fingerprint validated by Auth.js and linked MTM mobile tokens on
 * every request. Every previously issued session, including the caller's, is
 * therefore invalid immediately. The client must re-authenticate afterwards.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import bcrypt from "bcryptjs"
import { passwordPolicyError } from "@/lib/password-policy"

const BCRYPT_COST = 12

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1).max(72),
})

export const POST = withRlsSessionAuth(async (req, session) => {
  const { orgId, userId } = session

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { currentPassword, newPassword } = parsed.data
  const passwordError = passwordPolicyError(newPassword)
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })

  try {
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId: orgId },
      select: { id: true, passwordHash: true },
    })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!ok) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 })
    }

    // Reject a no-op change so we don't bump passwordChangedAt (and thus log the
    // user out of all sessions) for nothing.
    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: "New password must be different from the current password." },
        { status: 400 },
      )
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST)

    // Scope the write to the caller's own row. passwordChangedAt drives the
    // session-fingerprint check in auth.ts (see SECURITY NOTE above).
    const result = await prisma.user.updateMany({
      where: { id: userId, organizationId: orgId },
      data: { passwordHash, passwordChangedAt: new Date() },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[me/change-password]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
