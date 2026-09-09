import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { generateOneTimeToken } from "@/lib/one-time-token"
import { sendEmail } from "@/lib/email"
import { buildReplyTo } from "@/lib/email-reply-address"
import { z } from "zod"
import { clientIp } from "@/lib/request-ip"
import {
  consumePublicRateLimit,
  reservePublicAction,
} from "@/lib/public-abuse-guard"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"

const REGISTER_IP_LIMIT = { maxRequests: 10, windowSeconds: 60 }
const REGISTER_RECIPIENT_POLICY = {
  cooldownSeconds: 10 * 60,
  maxActions: 3,
  windowSeconds: 60 * 60,
}
const MAX_REGISTER_BODY_SIZE = 8 * 1024

const RegisterSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).email(),
  organizationId: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(200).optional(),
  organizationSlug: z.string().trim().min(1).max(200).optional(),
})

const genericResponse = {
  success: true,
  message: "Если указанный email связан с аккаунтом, на него будет отправлена ссылка для подтверждения.",
}

function registrationRateLimited(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) } },
  )
}

function registrationGuardUnavailable() {
  return NextResponse.json(
    { error: "Service temporarily unavailable. Please try again later." },
    { status: 503, headers: { "Retry-After": "1" } },
  )
}

// POST /api/v1/public/portal-auth/register — send verification email
export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const ipLimit = await consumePublicRateLimit("portal-register:ip", ip, REGISTER_IP_LIMIT)
  if (ipLimit.unavailable) return registrationGuardUnavailable()
  if (!ipLimit.allowed) return registrationRateLimited(ipLimit.retryAfterSeconds)

  const requestBody = await readJsonRequestWithinLimit(req, MAX_REGISTER_BODY_SIZE)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid JSON" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = RegisterSchema.safeParse(requestBody.value)
  if (!parsed.success) return NextResponse.json({ error: "Invalid registration request" }, { status: 400 })
  const { email, organizationId, slug, organizationSlug } = parsed.data

  // A tenant slug injected by middleware is authoritative. Body tenant fields
  // are supported for app/localhost compatibility, but cannot retarget a
  // request that came through a tenant hostname.
  const rawTrustedTenantSlug = req.headers.get("x-tenant-slug")
  const hasTrustedTenantSlug = rawTrustedTenantSlug !== null
  const trustedTenantSlug = rawTrustedTenantSlug?.trim().toLowerCase() ?? ""
  const requestedTenantSlugs = [slug, organizationSlug]
    .filter((value): value is string => !!value)
    .map((value) => value.toLowerCase())

  let orgId: string | null = null
  if (hasTrustedTenantSlug) {
    // Preserve the route's generic 200 response and stop before contact lookup,
    // token generation, or email delivery whenever tenant inputs disagree.
    if (
      !trustedTenantSlug ||
      trustedTenantSlug.length > 200 ||
      !/^[a-z0-9][a-z0-9-]*$/.test(trustedTenantSlug) ||
      requestedTenantSlugs.some((candidate) => candidate !== trustedTenantSlug)
    ) {
      return NextResponse.json(genericResponse)
    }

    const org = await prisma.organization.findFirst({
      where: { slug: trustedTenantSlug, isActive: true },
      select: { id: true },
    })
    if (!org || (organizationId && organizationId !== org.id)) {
      return NextResponse.json(genericResponse)
    }
    orgId = org.id
  } else if (organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId, isActive: true },
      select: { id: true },
    })
    orgId = org?.id ?? null
  } else if (organizationSlug || slug) {
    if (organizationSlug && slug && organizationSlug.toLowerCase() !== slug.toLowerCase()) {
      return NextResponse.json(genericResponse)
    }
    const requestedSlug = (organizationSlug || slug)!.toLowerCase()
    const org = await prisma.organization.findFirst({
      where: { slug: requestedSlug, isActive: true },
      select: { id: true },
    })
    orgId = org?.id ?? null
  } else {
    // RLS phase 1 — app/localhost's unscoped contact-by-email fallback runs
    // bypass-scoped (resolution only). Tenant-host requests never reach this.
    const contact = await runWithRlsBypass(() =>
      prisma.contact.findFirst({
        where: {
          email: email.toLowerCase().trim(),
          isActive: true,
          portalAccessEnabled: true,
          organization: { isActive: true },
        },
        select: { organizationId: true },
      })
    )
    orgId = contact?.organizationId ?? null
  }

  // If no org resolved, return generic response (prevents org enumeration)
  if (!orgId) {
    return NextResponse.json(genericResponse)
  }

  // RLS phase 2 — all remaining registration work runs tenant-scoped.
  return await runWithTenant(orgId, async () => {
  // SECURITY: Scope email lookup to the resolved organization
  const contact = await prisma.contact.findFirst({
    where: {
      email: email.toLowerCase().trim(),
      organizationId: orgId,
      isActive: true,
      portalAccessEnabled: true,
      organization: { isActive: true },
    },
    include: { organization: { select: { name: true } } },
  })

  // Return same generic message for all failure cases (prevents email enumeration)
  if (!contact || contact.portalPasswordHash) {
    return NextResponse.json(genericResponse)
  }

  // This gate is keyed only by the normalized recipient, not by source IP.
  // Rotating proxies therefore cannot turn this endpoint into an email cannon.
  // Denials intentionally keep the same 200 response as unknown/ineligible
  // contacts so the throttle cannot become an account-enumeration oracle.
  const recipientReservation = await reservePublicAction(
    "portal-register:recipient",
    email,
    REGISTER_RECIPIENT_POLICY,
  )
  if (!recipientReservation.allowed) return NextResponse.json(genericResponse)

  // F-30: the token travels in the email; only its digest is stored. The column
  // used to hold the live value for a full 24 hours, so anyone able to read
  // `contacts` could take over a portal account belonging to a tenant's own
  // customer — set their password and read their tickets and invoices.
  // See src/lib/one-time-token.ts.
  const { token, tokenHash } = generateOneTimeToken()
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
  let tokenPersisted = false
  let deliveryOutcomeAmbiguous = false

  try {
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        portalVerificationToken: tokenHash,
        portalVerificationExpires: expires,
      },
    })
    tokenPersisted = true

    // Build verification URL
    const baseUrl = process.env.NEXTAUTH_URL || "https://app.leaddrivecrm.org"
    const verifyUrl = `${baseUrl}/portal/set-password?token=${token}`

    // Build a deliverability-friendly email: both text + html, Reply-To pointing at
    // a human address (taken from org settings if configured), List-Unsubscribe
    // header to signal transactional-not-bulk, neutral "access link" subject.
    // Prefer a tracked reply-to (contact+{id}.{hmac}@leaddrivecrm.org) when
    // RESEND_API_KEY is active — replies land in the inbound webhook and can
    // create TicketComments automatically. Otherwise fall back to the org's
    // human reply address saved in settings.
    const orgSettings = (await prisma.organization.findUnique({
      where: { id: contact.organizationId },
      select: { settings: true, name: true },
    }))?.settings as { smtp?: { fromEmail?: string; replyTo?: string } } | null
    const replyTo = (process.env.RESEND_API_KEY || process.env.POSTMARK_SERVER_TOKEN)
      ? buildReplyTo({ kind: "contact", id: contact.id })
      : orgSettings?.smtp?.replyTo || orgSettings?.smtp?.fromEmail
    const unsubscribeUrl = `${baseUrl}/portal/unsubscribe?email=${encodeURIComponent(email)}`

    const textBody = [
      `Здравствуйте, ${contact.fullName}!`,
      ``,
      `Ссылка для входа на клиентский портал ${contact.organization.name}:`,
      verifyUrl,
      ``,
      `Ссылка действительна 24 часа. Если вы не запрашивали доступ, просто проигнорируйте это письмо.`,
      ``,
      `— ${contact.organization.name}`,
    ].join("\n")

    deliveryOutcomeAmbiguous = true
    const result = await sendEmail({
      to: email,
      subject: `${contact.organization.name} — ссылка для входа на портал`,
      html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
        <p style="font-size: 15px;">Здравствуйте, <strong>${contact.fullName}</strong>!</p>
        <p style="font-size: 15px;">Ссылка для входа на клиентский портал <strong>${contact.organization.name}</strong>:</p>
        <p style="margin: 24px 0;">
          <a href="${verifyUrl}" style="color: #2563eb; text-decoration: underline; font-size: 15px;">${verifyUrl}</a>
        </p>
        <p style="color: #6b7280; font-size: 13px;">Ссылка действительна 24 часа.</p>
        <p style="color: #6b7280; font-size: 13px;">Если вы не запрашивали доступ — просто проигнорируйте это письмо.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="color: #9ca3af; font-size: 12px;">— ${contact.organization.name}</p>
      </div>
    `,
      text: textBody,
      replyTo,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "X-Entity-Ref-ID": token,
      },
      organizationId: contact.organizationId,
      contactId: contact.id,
      transactional: true,
    })

    if (!result.success) {
      deliveryOutcomeAmbiguous = false
      throw new Error("verification_email_not_accepted")
    }
  } catch {
    // A provider timeout is ambiguous: the message may have been accepted even
    // though no success response reached us. Keep the recipient reservation so
    // retries cannot turn that ambiguity into duplicate mail. Restore the token
    // only after a definite pre-send/provider rejection. For an ambiguous send
    // timeout the new token remains valid in case the email did leave.
    if (tokenPersisted && !deliveryOutcomeAmbiguous) {
      try {
        await prisma.contact.updateMany({
          // Matches on the digest, like every other predicate on this column.
          // `contact.portalVerificationToken` on the restore side is already a
          // digest — it was read from the row before this request overwrote it.
          where: { id: contact.id, portalVerificationToken: tokenHash },
          data: {
            portalVerificationToken: contact.portalVerificationToken ?? null,
            portalVerificationExpires: contact.portalVerificationExpires ?? null,
          },
        })
      } catch { /* best-effort rollback */ }
    }
    console.error("[portal-register] verification email delivery failed")
    return NextResponse.json(genericResponse)
  }

  // Audit log
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: contact.organizationId,
        action: "portal_verification_sent",
        entityType: "contact",
        entityId: contact.id,
        entityName: contact.fullName,
        details: { email, ip },
      },
    })
  } catch { /* non-critical */ }

  return NextResponse.json(genericResponse)
  }) // end runWithTenant (tenant-scoped handler body)
}
