import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { verifySync } from "otplib"
import crypto from "crypto"
import { runWithRlsBypass } from "@/lib/rls-context"
import { createTwoFactorNonce } from "@/lib/two-factor-nonce"

function generateBackupCodes(count = 8): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase()
    codes.push(`${code.slice(0, 4)}-${code.slice(4, 8)}`)
  }
  return codes
}

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const securityClaims = session.user as typeof session.user & { needs2fa?: boolean }
  if (securityClaims.needs2fa) {
    return NextResponse.json(
      { error: "Complete the current 2FA challenge before changing factors" },
      { status: 403 },
    )
  }

  const { token } = await req.json()
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Token is required" }, { status: 400 })
  }

  const userId = session.user.id as string
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !user.totpSecret) {
    return NextResponse.json({ error: "TOTP setup not started" }, { status: 400 })
  }
  if (user.totpEnabled) {
    return NextResponse.json({ error: "2FA is already enabled" }, { status: 409 })
  }

  // Verify the token
  const isValid = verifySync({ token, secret: user.totpSecret }).valid
  if (!isValid) {
    return NextResponse.json({ error: "Invalid code. Please try again." }, { status: 400 })
  }

  // Generate backup codes
  const backupCodes = generateBackupCodes()

  // SECURITY: Generate a server-side nonce so the frontend can securely
  // clear needsSetup2fa via session.update() — the JWT callback verifies it.
  const twoFactorNonce = createTwoFactorNonce()

  // Enable 2FA
  const verifyResult = await prisma.user.updateMany({
    where: { id: userId, totpEnabled: false, totpSecret: user.totpSecret },
    data: {
      totpEnabled: true,
      backupCodes: JSON.stringify(backupCodes),
      twoFactorNonce,
    },
  })
  if (verifyResult.count !== 1) {
    return NextResponse.json({ error: "2FA state changed; start again" }, { status: 409 })
  }

  return NextResponse.json({
    success: true,
    data: { backupCodes, twoFactorNonce },
  })
  })
}
