import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { runWithRlsBypass } from "@/lib/rls-context"
import { checkRateLimit, hashForRateLimit } from "@/lib/rate-limit"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { clientIp } from "@/lib/request-ip"
import { generateOneTimeToken } from "@/lib/one-time-token"

// An unauthenticated endpoint that sends mail on demand is an abuse primitive
// twice over: it floods a victim's inbox, and it burns our sending reputation
// on a domain the whole product depends on. The same class was already closed
// for the registration endpoint after the 2026-08 pentest; this one was missed.
const IP_RATE_LIMIT = { maxRequests: 5, windowMs: 15 * 60_000 }
const EMAIL_RATE_LIMIT = { maxRequests: 3, windowMs: 60 * 60_000 }

const MAX_BODY_SIZE = 8 * 1024
// A single address legitimately belongs to a handful of tenants at most. The cap
// bounds the work one request can cause; anything beyond it is a data problem,
// not a user with many accounts.
const MAX_ACCOUNTS_PER_EMAIL = 10

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).email(),
}).strict()

function escHtml(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export async function POST(req: NextRequest) {
  const requestBody = await readJsonRequestWithinLimit(req, MAX_BODY_SIZE)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid JSON" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }

  // The uniform answer below is what keeps this endpoint from confirming which
  // addresses exist, so every later exit returns exactly this object.
  const successResponse = () => NextResponse.json({
    success: true,
    message: "If the email exists, a reset link has been sent.",
  })

  const parsed = forgotPasswordSchema.safeParse(requestBody.value)
  // A malformed address is answered like a valid unknown one — a 400 here would
  // be a cheap oracle for probing address shapes.
  if (!parsed.success) return successResponse()
  const { email } = parsed.data

  if (!checkRateLimit(`forgot-password:ip:${clientIp(req)}`, IP_RATE_LIMIT)) {
    return successResponse()
  }
  // Hashed so the address never reaches the in-memory limiter or its logs.
  const emailKey = await hashForRateLimit(`forgot-password:${email}`)
  if (!checkRateLimit(`forgot-password:email:${emailKey}`, EMAIL_RATE_LIMIT)) {
    return successResponse()
  }

  return runWithRlsBypass(async () => {
    // Every account on this address, not the first one found.
    //
    // The previous `findFirst` was a multi-tenancy defect: the same person often
    // holds accounts in several tenants, and an arbitrary pick meant the link
    // could reset a different tenant's account than the one the user was locked
    // out of — repeatedly, since the pick is stable. Issuing one link per
    // account leaks nothing: only the owner of the mailbox receives them.
    const users = await prisma.user.findMany({
      where: { email, isActive: true },
      select: {
        id: true,
        name: true,
        organizationId: true,
        organization: { select: { name: true } },
      },
      take: MAX_ACCOUNTS_PER_EMAIL,
    })
    if (users.length === 0) return successResponse()

    const baseUrl = process.env.NEXTAUTH_URL || "https://app.leaddrivecrm.org"
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

    // One email PER ACCOUNT, each sent under its own tenant.
    //
    // The first version of this fix put every link into a single message sent
    // through users[0]'s organization. `sendEmail` writes the rendered body into
    // EmailLog, and EmailLog is scoped per organization — so tenant A's
    // operators would have found a working reset link for tenant B's account
    // sitting in their own email log. That is a cross-tenant account takeover,
    // and it is worse than the arbitrary-pick behaviour it replaced.
    //
    // Sending separately keeps each tenant's credentials inside that tenant's
    // mail log and provider. The recipient owns the mailbox either way, so a
    // second message costs them nothing but a line in the inbox.
    for (const user of users) {
      const { token, tokenHash } = generateOneTimeToken()
      await prisma.user.update({
        where: { id: user.id },
        // Only the digest is stored. See src/lib/one-time-token.ts.
        data: { resetToken: tokenHash, resetTokenExp: expiresAt },
      })

      const resetUrl = `${baseUrl}/reset-password?token=${token}`
      const workspace = user.organization?.name ? escHtml(user.organization.name) : ""

      await sendEmail({
        to: email,
        organizationId: user.organizationId,
        subject: workspace ? `Reset your ${workspace} password` : "Reset your LeadDrive password",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
            <h2>Password Reset</h2>
            <p>Hi ${escHtml(user.name)},</p>
            <p>You requested a password reset${workspace ? ` for <strong>${workspace}</strong>` : ""}. Click the link below to set a new password:</p>
            <p><a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">Reset Password</a></p>
            <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
            <p style="color: #999; font-size: 12px;">LeadDrive CRM</p>
          </div>
        `,
        transactional: true,
      })
    }

    return successResponse()
  })
}
