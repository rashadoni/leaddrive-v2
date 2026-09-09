import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { runWithRlsBypass } from "@/lib/rls-context"

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const securityClaims = session.user as typeof session.user & {
    needs2fa?: boolean
    needsSetup2fa?: boolean
  }
  if (securityClaims.needs2fa || securityClaims.needsSetup2fa) {
    return NextResponse.json({ error: "Complete 2FA before changing factors" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const password = body && typeof body === "object" && "password" in body
    ? (body as { password?: unknown }).password
    : undefined
  if (typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 })
  }

  const userId = session.user.id as string
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  if (!user.totpEnabled) {
    return NextResponse.json({ error: "2FA is not enabled" }, { status: 400 })
  }

  // Verify password
  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    return NextResponse.json({ error: "Invalid password" }, { status: 400 })
  }

  // Disable 2FA
  await prisma.user.update({
    where: { id: userId },
    data: {
      totpEnabled: false,
      totpSecret: null,
      backupCodes: [],
      twoFactorNonce: null,
      // Factor removal changes the assurance attached to every cookie. Revoke
      // them all so a required-MFA role must authenticate and set up/verify a
      // remaining factor again.
      passwordChangedAt: new Date(),
    },
  })

  return NextResponse.json({ success: true, data: { reauthenticate: true } })
  })
}
