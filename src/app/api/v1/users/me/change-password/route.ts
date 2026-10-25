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
import { logAudit, prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { withLegacyCredentialMaintenance } from "@/lib/identity/legacy-credential-write"
import { readLegacyCrmCredentialBoundary } from "@/lib/identity/legacy-crm-boundary"
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
      select: { id: true, passwordHash: true, passwordChangedAt: true },
    })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const boundary = await runWithTenant(orgId, () => readLegacyCrmCredentialBoundary(prisma, orgId, userId))
    if (boundary !== "LEGACY") return NextResponse.json({ error: "Use the current credential management flow for this account", code: "IDENTITY_CREDENTIAL_FLOW_REQUIRED" }, { status: 409 })

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

    const result = await runWithTenant(orgId, () => withLegacyCredentialMaintenance(prisma, orgId,
      [{ kind: "USER", userId }], async tx => {
        const fresh = await tx.user.findFirst({
          where: { id: userId, organizationId: orgId, isActive: true, anonymizedAt: null },
          select: { id: true, passwordHash: true, passwordChangedAt: true },
        })
        // The comparison outside the lock proves this exact old credential.
        if (!fresh || fresh.passwordHash !== user.passwordHash
          || (fresh.passwordChangedAt?.getTime() ?? null) !== (user.passwordChangedAt?.getTime() ?? null)) return false
        const changedAt = new Date()
        const changed = await tx.user.updateMany({
          where: { id: userId, organizationId: orgId, passwordHash: user.passwordHash,
            passwordChangedAt: user.passwordChangedAt ?? null, isActive: true, anonymizedAt: null },
          data: { passwordHash, passwordChangedAt: changedAt, resetToken: null, resetTokenExp: null },
        })
        if (changed.count !== 1) return false
        await logAudit(orgId, "password_change", "user", userId, undefined, {
          userId,
          oldValue: { passwordChangedAt: fresh.passwordChangedAt },
          newValue: { passwordChangedAt: changedAt, sessionsInvalidated: true },
        }, tx)
        return true
      }))
    if (!result.allowed) return NextResponse.json({ error: "Use the current credential management flow for this account", code: "IDENTITY_CREDENTIAL_FLOW_REQUIRED" }, { status: 409 })
    if (!result.value) return NextResponse.json({ error: "Credential changed; sign in again and retry" }, { status: 400 })

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[me/change-password]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
