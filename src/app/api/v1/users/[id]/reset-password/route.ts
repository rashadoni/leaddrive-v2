import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { withLegacyCredentialMaintenance } from "@/lib/identity/legacy-credential-write"
import { passwordPolicyError } from "@/lib/password-policy"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { moduleDisabledResponse, orgHasModule } from "@/lib/api-auth"

const resetPasswordSchema = z.object({
  password: z.string().min(1).max(72),
  confirmPassword: z.string().min(1).max(72),
}).refine((value) => value.password === value.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
})

export const POST = withRlsSessionAuth(
  async (
    req: NextRequest,
    auth,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    if (!checkPermission(auth.role, "settings", "write")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (auth.role !== "superadmin" && !(await orgHasModule(auth.orgId, "settings"))) {
      return moduleDisabledResponse("settings")
    }

    const { id } = await params
    const parsed = resetPasswordSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid password" },
        { status: 400 },
      )
    }

    const policyError = passwordPolicyError(parsed.data.password)
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 })
    }

    try {
      const target = await prisma.user.findFirst({
        where: { id, organizationId: auth.orgId },
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          passwordChangedAt: true,
        },
      })
      if (!target) {
        return NextResponse.json({ error: "User not found" }, { status: 404 })
      }

      const passwordHash = await bcrypt.hash(parsed.data.password, 12)
      const result = await runWithTenant(auth.orgId, () => withLegacyCredentialMaintenance(prisma, auth.orgId,
        [{ kind: "USER", userId: target.id }], async tx => {
          const fresh = await tx.user.findFirst({
            where: { id: target.id, organizationId: auth.orgId },
            select: { id: true, email: true, isActive: true, passwordChangedAt: true },
          })
          if (!fresh) return null
          const changedAt = new Date()
          await tx.user.update({
            where: { id: fresh.id },
            data: { passwordHash, passwordChangedAt: changedAt, resetToken: null, resetTokenExp: null },
          })
          await logAudit(auth.orgId, "password_reset", "user", fresh.id, fresh.email, {
            userId: auth.userId,
            oldValue: { passwordChangedAt: fresh.passwordChangedAt, isActive: fresh.isActive },
            newValue: { passwordChangedAt: changedAt, sessionsInvalidated: true, isActive: fresh.isActive },
          }, tx)
          return { userId: fresh.id, changedAt, isActive: fresh.isActive }
        }))
      if (!result.allowed) return NextResponse.json({ error: "Use the current credential management flow for this account", code: "IDENTITY_CREDENTIAL_FLOW_REQUIRED" }, { status: 409 })
      if (!result.value) return NextResponse.json({ error: "User not found" }, { status: 404 })
      const changedAt = result.value.changedAt

      return NextResponse.json({
        success: true,
        data: {
          userId: target.id,
          passwordChangedAt: changedAt,
          isActive: result.value.isActive,
        },
      })
    } catch (error) {
      console.error("[users reset-password]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
