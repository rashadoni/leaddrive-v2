import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { issuePortalPasswordLink } from "@/lib/portal-password-link"
import { z } from "zod"
import { clientIp } from "@/lib/request-ip"
import { consumePublicRateLimit, reservePublicAction } from "@/lib/public-abuse-guard"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"

const FORGOT_PASSWORD_IP_LIMIT = { maxRequests: 10, windowSeconds: 60 }
const FORGOT_PASSWORD_RECIPIENT_POLICY = {
  cooldownSeconds: 10 * 60,
  maxActions: 3,
  windowSeconds: 60 * 60,
}
const MAX_FORGOT_PASSWORD_BODY_SIZE = 8 * 1024

const ForgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).email(),
  organizationId: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(200).optional(),
  organizationSlug: z.string().trim().min(1).max(200).optional(),
}).strict()

// Always return this response after syntactically valid requests. It prevents a
// public endpoint from revealing whether a particular customer has portal access.
const genericResponse = {
  success: true,
  message: "Если для этого email доступен портал, мы отправим ссылку для сброса пароля.",
}

function rateLimited(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) } },
  )
}

function guardUnavailable() {
  return NextResponse.json(
    { error: "Service temporarily unavailable. Please try again later." },
    { status: 503, headers: { "Retry-After": "1" } },
  )
}

// POST /api/v1/public/portal-auth/forgot-password — send a single-use password-reset link
export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const ipLimit = await consumePublicRateLimit("portal-forgot-password:ip", ip, FORGOT_PASSWORD_IP_LIMIT)
  if (ipLimit.unavailable) return guardUnavailable()
  if (!ipLimit.allowed) return rateLimited(ipLimit.retryAfterSeconds)

  const requestBody = await readJsonRequestWithinLimit(req, MAX_FORGOT_PASSWORD_BODY_SIZE)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid JSON" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }

  const parsed = ForgotPasswordSchema.safeParse(requestBody.value)
  if (!parsed.success) return NextResponse.json({ error: "Invalid password reset request" }, { status: 400 })
  const { email, organizationId, slug, organizationSlug } = parsed.data

  // A tenant slug injected by middleware is the host boundary. App/localhost
  // keeps the legacy body fields, but they can never override that boundary.
  const rawTrustedTenantSlug = req.headers.get("x-tenant-slug")
  const hasTrustedTenantSlug = rawTrustedTenantSlug !== null
  const trustedTenantSlug = rawTrustedTenantSlug?.trim().toLowerCase() ?? ""
  const requestedTenantSlugs = [slug, organizationSlug]
    .filter((value): value is string => !!value)
    .map((value) => value.toLowerCase())

  let orgId: string | null = null
  if (hasTrustedTenantSlug) {
    if (
      !trustedTenantSlug ||
      trustedTenantSlug.length > 200 ||
      !/^[a-z0-9][a-z0-9-]*$/.test(trustedTenantSlug) ||
      requestedTenantSlugs.some((candidate) => candidate !== trustedTenantSlug)
    ) {
      return NextResponse.json(genericResponse)
    }

    const organization = await prisma.organization.findFirst({
      where: { slug: trustedTenantSlug, isActive: true },
      select: { id: true },
    })
    if (!organization || (organizationId && organizationId !== organization.id)) {
      return NextResponse.json(genericResponse)
    }
    orgId = organization.id
  } else if (organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId, isActive: true },
      select: { id: true },
    })
    orgId = organization?.id ?? null
  } else if (organizationSlug || slug) {
    if (organizationSlug && slug && organizationSlug.toLowerCase() !== slug.toLowerCase()) {
      return NextResponse.json(genericResponse)
    }
    const requestedSlug = (organizationSlug || slug)!.toLowerCase()
    const organization = await prisma.organization.findFirst({
      where: { slug: requestedSlug, isActive: true },
      select: { id: true },
    })
    orgId = organization?.id ?? null
  } else {
    // This fallback is for app/localhost. It is resolution-only and uses the
    // RLS bypass because an email address is otherwise cross-tenant input.
    const contact = await runWithRlsBypass(() =>
      prisma.contact.findFirst({
        where: {
          email,
          isActive: true,
          portalAccessEnabled: true,
          portalPasswordHash: { not: null },
          organization: { isActive: true },
        },
        select: { organizationId: true },
      })
    )
    orgId = contact?.organizationId ?? null
  }

  if (!orgId) return NextResponse.json(genericResponse)

  return runWithTenant(orgId, async () => {
    const contact = await prisma.contact.findFirst({
      where: {
        email,
        organizationId: orgId,
        isActive: true,
        portalAccessEnabled: true,
        portalPasswordHash: { not: null },
        organization: { isActive: true },
      },
      include: { organization: { select: { name: true } } },
    })
    if (!contact?.email) return NextResponse.json(genericResponse)

    // This throttle is recipient-based as well as IP-based, so proxy rotation
    // cannot turn account recovery into an outbound-mail abuse primitive.
    const recipientReservation = await reservePublicAction(
      "portal-forgot-password:recipient",
      email,
      FORGOT_PASSWORD_RECIPIENT_POLICY,
    )
    if (!recipientReservation.allowed) return NextResponse.json(genericResponse)

    const issued = await issuePortalPasswordLink(contact)
    if (!issued.ok) {
      console.error("[portal-forgot-password] password reset email delivery failed")
      return NextResponse.json(genericResponse)
    }

    try {
      await prisma.auditLog.create({
        data: {
          organizationId: contact.organizationId,
          action: "portal_password_reset_requested",
          entityType: "contact",
          entityId: contact.id,
          entityName: contact.fullName,
          details: { ip },
        },
      })
    } catch { /* audit log is non-critical */ }

    return NextResponse.json(genericResponse)
  })
}
