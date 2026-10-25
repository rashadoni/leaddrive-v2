import { NextRequest, NextResponse } from "next/server"
import { logAudit, prisma } from "@/lib/prisma"
import { withLegacyCredentialMaintenance } from "@/lib/identity/legacy-credential-write"
import bcrypt from "bcryptjs"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { passwordPolicyError } from "@/lib/password-policy"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { z } from "zod"

const resetPasswordSchema = z.object({
  token: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(72),
}).strict()

export async function POST(req: NextRequest) {
  const requestBody = await readJsonRequestWithinLimit(req, 8 * 1024)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid JSON" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = resetPasswordSchema.safeParse(requestBody.value)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const { token, password } = parsed.data

  const passwordError = passwordPolicyError(password)
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })

  // The column stores a digest, never the token itself (F-28). Both the lookup
  // and the compare-and-set below match on the digest, so the plaintext token
  // exists only in the email and in this request.
  //
  // Note for the deploy: tokens issued before this change were stored in the
  // clear and will no longer match. They expire within an hour and a fresh link
  // costs the user one click, so no migration of existing rows is warranted.
  const tokenHash = hashOneTimeToken(token)

  return runWithRlsBypass(async () => {
    const user = await prisma.user.findFirst({
      where: {
        resetToken: tokenHash,
        resetTokenExp: { gt: new Date() },
        isActive: true,
      },
      select: { id: true, organizationId: true, passwordChangedAt: true },
    })

    if (!user) {
      return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const consumed = await runWithTenant(user.organizationId, () => withLegacyCredentialMaintenance(prisma, user.organizationId,
      [{ kind: "USER", userId: user.id }], async tx => {
        const passwordChangedAt = new Date()
        // The email capability and canonical authority are checked at the
        // actual mutation, after bcrypt, under the common tenant fence.
        const changed = await tx.user.updateMany({
          where: { id: user.id, organizationId: user.organizationId, resetToken: tokenHash,
            resetTokenExp: { gt: passwordChangedAt }, isActive: true, anonymizedAt: null },
          data: { passwordHash, passwordChangedAt, resetToken: null, resetTokenExp: null },
        })
        if (changed.count !== 1) return false
        await logAudit(user.organizationId, "password_reset_by_email", "user", user.id, undefined, {
          userId: user.id,
          oldValue: { passwordChangedAt: user.passwordChangedAt },
          newValue: { passwordChangedAt, sessionsInvalidated: true, recoveryMethod: "email" },
        }, tx)
        return true
      }))
    if (!consumed.allowed || !consumed.value) {
      return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: "Password has been reset successfully.",
    })
  })
}
