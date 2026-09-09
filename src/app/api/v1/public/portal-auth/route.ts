import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { createPortalToken } from "@/lib/portal-auth"
import bcrypt from "bcryptjs"
import { checkRateLimit, hashForRateLimit } from "@/lib/rate-limit"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { z } from "zod"
import { clientIp } from "@/lib/request-ip"

const PORTAL_LOGIN_RATE_LIMIT = { maxRequests: 5, windowMs: 60_000 }
const MAX_PORTAL_LOGIN_BODY_SIZE = 8 * 1024
const PortalLoginSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).email(),
  // Keep compatibility with legacy portal passwords while bounding bcrypt
  // input. New passwords are already restricted to 100 chars by policy.
  password: z.string().min(1).max(1024),
  organizationId: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(200).optional(),
  organizationSlug: z.string().trim().min(1).max(200).optional(),
}).strict()

function invalidCredentials() {
  return NextResponse.json({ error: "Неверные учётные данные" }, { status: 401 })
}

// POST /api/v1/public/portal-auth — login with email + password
export async function POST(req: NextRequest) {
  const requestBody = await readJsonRequestWithinLimit(req, MAX_PORTAL_LOGIN_BODY_SIZE)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid JSON" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = PortalLoginSchema.safeParse(requestBody.value)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid login request" }, { status: 400 })
  }
  const {
    email: normalizedEmail,
    password,
    organizationId,
    slug,
    organizationSlug,
  } = parsed.data

  // RLS phase 1 — org resolution. The organization lookups hit a global
  // table (no policy); the contact-by-email fallback is a cross-tenant
  // lookup, so it runs bypass-scoped (resolution only).
  // A tenant slug injected by middleware is an authoritative host boundary.
  // Body fields remain available on app/localhost for legacy clients, but they
  // may never retarget a request that arrived through a tenant hostname.
  const rawTrustedTenantSlug = req.headers.get("x-tenant-slug")
  const hasTrustedTenantSlug = rawTrustedTenantSlug !== null
  const trustedTenantSlug = rawTrustedTenantSlug?.trim().toLowerCase() ?? ""
  const requestedTenantSlugs = [slug, organizationSlug]
    .filter((value): value is string => !!value)
    .map((value) => value.toLowerCase())

  let orgId: string | null = null
  if (hasTrustedTenantSlug) {
    // Fail closed if the trusted header is malformed or either supported body
    // alias disagrees. In particular, do this before any contact lookup or
    // bcrypt work so a mismatch cannot probe another tenant's accounts.
    if (
      !trustedTenantSlug ||
      trustedTenantSlug.length > 200 ||
      !/^[a-z0-9][a-z0-9-]*$/.test(trustedTenantSlug) ||
      requestedTenantSlugs.some((candidate) => candidate !== trustedTenantSlug)
    ) {
      return invalidCredentials()
    }

    const org = await prisma.organization.findFirst({
      where: { slug: trustedTenantSlug, isActive: true },
      select: { id: true },
    })
    if (!org || (organizationId && organizationId !== org.id)) {
      return invalidCredentials()
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
      return NextResponse.json({ error: "Invalid login request" }, { status: 400 })
    }
    const requestedSlug = (organizationSlug || slug)!.toLowerCase()
    const org = await prisma.organization.findFirst({
      where: { slug: requestedSlug, isActive: true },
      select: { id: true },
    })
    orgId = org?.id ?? null
  } else {
    // App/localhost compatibility fallback: resolve an otherwise unscoped
    // login by the eligible contact. Tenant-host requests never reach this.
    const contact = await runWithRlsBypass(() =>
      prisma.contact.findFirst({
        where: {
          email: normalizedEmail,
          isActive: true,
          portalAccessEnabled: true,
          organization: { isActive: true },
        },
        select: { organizationId: true },
      })
    )
    orgId = contact?.organizationId ?? null
  }

  if (!orgId) {
    return invalidCredentials()
  }

  // Middleware supplies the coarse per-IP public bucket. This second bucket is
  // keyed by the target principal as well, so rotating source IPs cannot turn
  // one portal account into an unbounded bcrypt workload. Hash the composite
  // key so email and tenant identifiers never enter the in-memory limiter/logs.
  const principalKey = await hashForRateLimit(`portal-login:${orgId}:${normalizedEmail}`)
  if (!checkRateLimit(`portal-login:${principalKey}`, PORTAL_LOGIN_RATE_LIMIT)) {
    return NextResponse.json(
      { error: "Слишком много попыток входа. Попробуйте позже." },
      { status: 429, headers: { "Retry-After": "60" } },
    )
  }

  // RLS phase 2 — all remaining login work runs tenant-scoped.
  return await runWithTenant(orgId, async () => {
  // SECURITY: Scope email lookup to the resolved organization
  const contact = await prisma.contact.findFirst({
    where: {
      email: normalizedEmail,
      organizationId: orgId,
      isActive: true,
      portalAccessEnabled: true,
      organization: { isActive: true },
    },
    include: { company: true },
  })
  if (!contact || !contact.portalAccessEnabled || !contact.portalPasswordHash) {
    return invalidCredentials()
  }

  const valid = await bcrypt.compare(password, contact.portalPasswordHash)
  if (!valid) {
    return invalidCredentials()
  }

  // Update last login
  await prisma.contact.update({
    where: { id: contact.id },
    data: { portalLastLoginAt: new Date() },
  })

  // Audit log
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: contact.organizationId,
        action: "portal_login",
        entityType: "contact",
        entityId: contact.id,
        entityName: contact.fullName,
        // clientIp(), not the raw header: nginx appends to x-forwarded-for, so
        // the value the caller sent leads the list and an audit row that
        // records it is recording the attacker's claim.
        details: { ip: clientIp(req) },
      },
    })
  } catch { /* audit log is non-critical */ }

  const portalUser = {
    contactId: contact.id,
    organizationId: contact.organizationId,
    companyId: contact.companyId,
    fullName: contact.fullName,
    email: contact.email!,
  }

  const token = await createPortalToken(portalUser, contact.portalPasswordHash)

  const res = NextResponse.json({
    success: true,
    // Token in the body for native clients (the mobile app has no cookie jar and
    // stores it in the device keychain). The web ignores this and authenticates
    // via the httpOnly cookie set below — same JWT, both over HTTPS.
    token,
    data: {
      contactId: contact.id,
      fullName: contact.fullName,
      email: contact.email,
      companyName: contact.company?.name || "",
    },
  })
  res.cookies.set("portal-token", token, { httpOnly: true, secure: true, path: "/", maxAge: 86400 * 7, sameSite: "lax" })
  return res
  }) // end runWithTenant (tenant-scoped handler body)
}

// DELETE /api/v1/public/portal-auth — logout
export async function DELETE() {
  const res = NextResponse.json({ success: true })
  res.cookies.set("portal-token", "", { httpOnly: true, path: "/", maxAge: 0 })
  return res
}
