import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { generateSecret, generateURI, verifySync } from "otplib"
import QRCode from "qrcode"
import crypto from "crypto"
import { createTwoFactorNonce } from "@/lib/two-factor-nonce"

// GET — get 2FA status
export async function GET(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = (session.user as any).id
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabled: true, email: true },
  })

  return NextResponse.json({
    success: true,
    data: { enabled: user?.totpEnabled || false },
  })
  })
}

// POST — setup or verify 2FA
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = (session.user as any).id
  const securityClaims = session.user as typeof session.user & {
    needs2fa?: boolean
    needsSetup2fa?: boolean
  }
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const { action, code } = body

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, totpSecret: true, totpEnabled: true },
  })
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

  // SETUP — generate secret + QR code
  if (action === "setup") {
    // A password-only login with an outstanding challenge is not authorized to
    // enroll an attacker-controlled factor. Mandatory first-time setup uses the
    // separate needsSetup2fa claim and remains allowed here.
    if (securityClaims.needs2fa) {
      return NextResponse.json(
        { error: "Complete the current 2FA challenge before changing factors" },
        { status: 403 },
      )
    }
    // Never overwrite an enabled secret through the enrollment endpoint. Factor
    // replacement needs an explicit step-up/recovery flow, not setup semantics.
    if (user.totpEnabled) {
      return NextResponse.json({ error: "2FA is already enabled" }, { status: 409 })
    }

    const secret = generateSecret()

    // Save the pending secret only while TOTP is still disabled. The conditional
    // write closes the race where another request enables a factor after the
    // read above but before this write.
    const setupResult = await prisma.user.updateMany({
      where: { id: userId, totpEnabled: false },
      data: { totpSecret: secret },
    })
    if (setupResult.count !== 1) {
      return NextResponse.json({ error: "2FA state changed; start again" }, { status: 409 })
    }

    const otpauth = generateURI({
      label: user.email,
      issuer: "LeadDrive CRM",
      secret,
    })

    const qrDataUrl = await QRCode.toDataURL(otpauth)

    // Generate backup codes
    const backupCodes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(4).toString("hex")
    )

    return NextResponse.json({
      success: true,
      data: { secret, qrCode: qrDataUrl, backupCodes },
    })
  }

  // VERIFY — enable 2FA after verifying code
  if (action === "verify") {
    if (securityClaims.needs2fa) {
      return NextResponse.json(
        { error: "Complete the current 2FA challenge before changing factors" },
        { status: 403 },
      )
    }
    if (!code) return NextResponse.json({ error: "Code required" }, { status: 400 })
    if (user.totpEnabled) {
      return NextResponse.json({ error: "2FA is already enabled" }, { status: 409 })
    }
    if (!user.totpSecret) return NextResponse.json({ error: "Setup 2FA first" }, { status: 400 })

    const isValid = verifySync({ token: code, secret: user.totpSecret }).valid
    if (!isValid) {
      return NextResponse.json({ error: "Invalid code. Please try again." }, { status: 400 })
    }

    // SECURITY: Generate a server-side nonce for secure session update
    const twoFactorNonce = createTwoFactorNonce()

    const verifyResult = await prisma.user.updateMany({
      where: { id: userId, totpEnabled: false, totpSecret: user.totpSecret },
      data: { totpEnabled: true, twoFactorNonce },
    })
    if (verifyResult.count !== 1) {
      return NextResponse.json({ error: "2FA state changed; start again" }, { status: 409 })
    }

    return NextResponse.json({
      success: true,
      data: { message: "2FA enabled successfully", twoFactorNonce },
    })
  }

  // DISABLE — turn off 2FA
  if (action === "disable") {
    // Disabling a factor is never part of login/setup. Require a fully verified
    // session plus the current TOTP below, then revoke every issued session.
    if (securityClaims.needs2fa || securityClaims.needsSetup2fa) {
      return NextResponse.json({ error: "Complete 2FA before changing factors" }, { status: 403 })
    }
    if (!code) return NextResponse.json({ error: "Code required" }, { status: 400 })
    if (!user.totpSecret || !user.totpEnabled) {
      return NextResponse.json({ error: "2FA is not enabled" }, { status: 400 })
    }

    const isValid = verifySync({ token: code, secret: user.totpSecret }).valid
    if (!isValid) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 })
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabled: false,
        totpSecret: null,
        backupCodes: [],
        twoFactorNonce: null,
        passwordChangedAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      data: { message: "2FA disabled successfully", reauthenticate: true },
    })
  }

  // VALIDATE — check code during login
  if (action === "validate") {
    if (!code) return NextResponse.json({ error: "Code required" }, { status: 400 })
    if (!user.totpSecret || !user.totpEnabled) {
      return NextResponse.json({ success: true, data: { valid: true } })
    }

    const isValid = verifySync({ token: code, secret: user.totpSecret }).valid
    return NextResponse.json({
      success: true,
      data: { valid: isValid },
    })
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  })
}
