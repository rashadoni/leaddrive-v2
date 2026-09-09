import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
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

      const changedAt = new Date()
      const passwordHash = await bcrypt.hash(parsed.data.password, 12)
      await prisma.user.update({
        where: { id: target.id },
        data: {
          passwordHash,
          passwordChangedAt: changedAt,
          resetToken: null,
          resetTokenExp: null,
        },
      })

      // Never put a password or hash in the audit payload. passwordChangedAt
      // doubles as the session-valid-after cutoff, so this also documents why
      // every existing session for the target account was invalidated.
      await logAudit(auth.orgId, "password_reset", "user", target.id, target.email, {
        userId: auth.userId,
        oldValue: {
          passwordChangedAt: target.passwordChangedAt,
          isActive: target.isActive,
        },
        newValue: {
          passwordChangedAt: changedAt,
          sessionsInvalidated: true,
          isActive: target.isActive,
        },
      })

      return NextResponse.json({
        success: true,
        data: {
          userId: target.id,
          passwordChangedAt: changedAt,
          isActive: target.isActive,
        },
      })
    } catch (error) {
      console.error("[users reset-password]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
