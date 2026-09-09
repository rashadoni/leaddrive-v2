import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { generateSecret, generateURI } from "otplib"
import QRCode from "qrcode"
import { runWithRlsBypass } from "@/lib/rls-context"

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id as string
  const securityClaims = session.user as typeof session.user & { needs2fa?: boolean }

  // needsSetup2fa is the authorized first-factor enrollment state. needs2fa is
  // different: password authentication succeeded but the existing factor has
  // not. Never let that weaker session enroll a replacement secret.
  if (securityClaims.needs2fa) {
    return NextResponse.json(
      { error: "Complete the current 2FA challenge before changing factors" },
      { status: 403 },
    )
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  if (user.totpEnabled) {
    return NextResponse.json({ error: "2FA is already enabled" }, { status: 400 })
  }

  // Generate secret
  const secret = generateSecret()
  const otpauth = generateURI({ label: user.email, issuer: "LeadDrive CRM", secret })

  // Generate QR code as data URL
  const qrCode = await QRCode.toDataURL(otpauth)

  // Store secret temporarily (not enabled yet until verified)
  const setupResult = await prisma.user.updateMany({
    where: { id: userId, totpEnabled: false },
    data: { totpSecret: secret },
  })
  if (setupResult.count !== 1) {
    return NextResponse.json({ error: "2FA state changed; start again" }, { status: 409 })
  }

  return NextResponse.json({
    success: true,
    data: {
      secret,
      qrCode,
      otpauth,
    },
  })
  })
}
