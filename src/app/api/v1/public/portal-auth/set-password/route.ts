import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { createPortalToken } from "@/lib/portal-auth"
import bcrypt from "bcryptjs"
import { passwordPolicyError } from "@/lib/password-policy"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { z } from "zod"
import { clientIp } from "@/lib/request-ip"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"

// The bcrypt hash below only runs after a valid 256-bit token resolves, so this
// is not a CPU-burn primitive the way portal-auth login is. The ceiling is here
// because the endpoint is an unauthenticated write that sets a credential, and
// because a token-guessing sweep should meet a wall rather than a stopwatch.
const SET_PASSWORD_IP_LIMIT = { maxRequests: 20, windowSeconds: 600 }

const setPasswordSchema = z.object({
  token: z.string().trim().min(1).max(128),
  password: z.string().max(1024),
  confirmPassword: z.string().max(1024),
}).strict()

// GET /api/v1/public/portal-auth/set-password?token=xxx — validate token
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")
  if (!token) return NextResponse.json({ error: "Токен не указан" }, { status: 400 })
  // F-30: the column stores a digest — see src/lib/one-time-token.ts.
  const tokenHash = hashOneTimeToken(token)

  // RLS phase 1 — org resolution: the verification token is a cross-tenant
  // external identifier, so the lookup runs bypass-scoped. Only DB access in GET.
  const contact = await runWithRlsBypass(() =>
    prisma.contact.findFirst({
      where: {
        portalVerificationToken: tokenHash,
        portalVerificationExpires: { gte: new Date() },
        isActive: true,
        portalAccessEnabled: true,
        organization: { isActive: true },
      },
      select: { id: true, fullName: true, email: true, portalPasswordHash: true },
    })
  )

  if (!contact) {
    return NextResponse.json({ error: "Ссылка недействительна или истекла" }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    data: {
      fullName: contact.fullName,
      email: contact.email,
      mode: contact.portalPasswordHash ? "reset" : "registration",
    },
  })
}

// POST /api/v1/public/portal-auth/set-password — set password after verification
export async function POST(req: NextRequest) {
  const ipLimit = await consumePublicRateLimit("portal-set-password:ip", clientIp(req), SET_PASSWORD_IP_LIMIT)
  if (ipLimit.unavailable) {
    return NextResponse.json(
      { error: "Service temporarily unavailable. Please try again later." },
      { status: 503, headers: { "Retry-After": "1" } },
    )
  }
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.max(1, ipLimit.retryAfterSeconds)) } },
    )
  }

  const requestBody = await readJsonRequestWithinLimit(req, 8 * 1024)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid JSON" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = setPasswordSchema.safeParse(requestBody.value)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const { token, password, confirmPassword } = parsed.data
  // F-30: lookup and compare-and-set both match on the digest, so the token
  // itself exists only in the link and in this request.
  const tokenHash = hashOneTimeToken(token)

  const passwordError = passwordPolicyError(password)
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })
  if (password !== confirmPassword) {
    return NextResponse.json({ error: "Пароли не совпадают" }, { status: 400 })
  }

  // RLS phase 1 — org resolution: cross-tenant token lookup, bypass-scoped only.
  const contact = await runWithRlsBypass(() =>
    prisma.contact.findFirst({
      where: {
        portalVerificationToken: tokenHash,
        portalVerificationExpires: { gte: new Date() },
        isActive: true,
        portalAccessEnabled: true,
        organization: { isActive: true },
      },
      include: { company: true },
    })
  )

  if (!contact) {
    return NextResponse.json({ error: "Ссылка недействительна или истекла" }, { status: 400 })
  }

  const hash = await bcrypt.hash(password, 12)

  // RLS phase 2 — password write + audit log run tenant-scoped.
  return await runWithTenant(contact.organizationId, async () => {
  // Consume the verification token atomically. Two parallel requests using the
  // same link must not both change the password and mint separate portal JWTs.
  // Re-check active tenant/contact state in the CAS so a suspension racing the
  // initial lookup also fails closed.
  const consumed = await prisma.contact.updateMany({
    where: {
      id: contact.id,
      organizationId: contact.organizationId,
      portalVerificationToken: tokenHash,
      portalVerificationExpires: { gte: new Date() },
      // A registration token starts with no password; a recovery token is
      // bound to the password hash that was current when it was issued. This
      // invalidates the link if a concurrent password change wins the race.
      portalPasswordHash: contact.portalPasswordHash,
      isActive: true,
      portalAccessEnabled: true,
      organization: { isActive: true },
    },
    data: {
      portalPasswordHash: hash,
      portalLastLoginAt: new Date(),
      portalVerificationToken: null,
      portalVerificationExpires: null,
    },
  })
  if (consumed.count !== 1) {
    return NextResponse.json({ error: "Ссылка недействительна или уже использована" }, { status: 400 })
  }

  // Audit log
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: contact.organizationId,
        action: contact.portalPasswordHash ? "portal_password_reset" : "portal_register",
        entityType: "contact",
        entityId: contact.id,
        entityName: contact.fullName,
        details: { ip: clientIp(req) },
      },
    })
  } catch { /* non-critical */ }

  // Auto-login
  const portalUser = {
    contactId: contact.id,
    organizationId: contact.organizationId,
    companyId: contact.companyId,
    fullName: contact.fullName,
    email: contact.email!,
  }

  const jwtToken = await createPortalToken(portalUser, hash)

  const res = NextResponse.json({
    success: true,
    data: {
      contactId: contact.id,
      fullName: contact.fullName,
      email: contact.email,
      companyName: contact.company?.name || "",
    },
  })
  res.cookies.set("portal-token", jwtToken, { httpOnly: true, secure: true, path: "/", maxAge: 86400 * 7, sameSite: "lax" })
  return res
  }) // end runWithTenant (tenant-scoped handler body)
}
