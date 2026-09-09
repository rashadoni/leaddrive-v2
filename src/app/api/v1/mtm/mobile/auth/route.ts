import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { hashForRateLimit } from "@/lib/rate-limit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { JWT_SECRET } from "@/lib/mobile-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { maskLegacyAuthEmail } from "@/lib/auth-credentials"
import { createSessionFingerprint } from "@/lib/session-invalidation"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { clientIp } from "@/lib/request-ip"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import type { MtmAgent } from "@prisma/client"
import { z } from "zod"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"

// Auth-resolved agent — either the slug-scoped findUnique or the legacy
// findFirst path returns a full MtmAgent row joined with a minimal org
// projection. Hard typing this avoids the `any` foot-gun on the auth
// critical path.
type ResolvedAuthAgent = MtmAgent & {
  organization: {
    id: string
    name: string
    isActive: boolean
    plan: string
    addons: unknown
    features: unknown
    modules: unknown
  }
}

// F-02: distributed brute-force protection. Separate trusted-IP and principal
// buckets stop both one-host sprays and a botnet rotating source addresses.
// AUTH_RATE_LIMIT remains the audit-window metadata; enforcement uses the two
// Redis-backed policies below.
const AUTH_RATE_LIMIT = { maxRequests: 5, windowMs: 60_000 }
const AUTH_IP_RATE_LIMIT = { maxRequests: 20, windowSeconds: 60 }
const AUTH_PRINCIPAL_RATE_LIMIT = { maxRequests: 5, windowSeconds: 60 }
const MAX_MOBILE_LOGIN_BODY_SIZE = 8 * 1024

const MobileLoginSchema = z.object({
  email: z.string().trim().min(1).max(320).email().transform((value) => value.toLowerCase()),
  // Keep a generous ceiling for passphrases while bounding pre-auth CPU and
  // memory work on attacker-controlled JSON.
  password: z.string().min(1).max(1024),
  organizationSlug: z.string()
    .trim()
    .toLowerCase()
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .nullish()
    .transform((value) => value ?? ""),
})

// Architect Q5: emit at most ONE `RATE_LIMITED` audit row per window-bucket
// so operators see the attack signal without N rows per second filling
// the audit table. Keys auto-expire after AUTH_RATE_LIMIT.windowMs.
//
// Note: process-local. Current production runs single PM2 instance per
// server (CLAUDE.md), so dedup holds. On a horizontally-scaled setup
// each worker would emit its own row — switch to a Redis SET or DB
// unique constraint on (orgId, rateKey, windowStart) at that point.
//
// Hard cap defends against unbounded growth from distributed attacks
// rotating IPs (each fresh hash key would otherwise stay in the Map
// until its individual timeout fires).
const RATE_LIMIT_AUDIT_CAP = 10_000
const rateLimitAuditFired = new Map<string, NodeJS.Timeout>()

/**
 * POST /api/v1/mtm/mobile/auth
 * Mobile agent login — returns JWT token.
 * Body: { email, password }
 *
 * Auth priority:
 * 1. Check agent's own passwordHash (set via admin form)
 * 2. Fallback: check linked CRM User's passwordHash
 */
export async function POST(req: NextRequest) {
  try {
    // Pre-auth login: no JWT/tenant context exists yet, and the legacy path is a
    // genuine cross-org email lookup. Run the whole credential-resolution + the
    // org-scoped writes (mtmAgent.update, MtmAuditLog) under RLS bypass so they
    // don't fail-close once RLS is enabled — exactly the auth.ts CRM-login shape.
    // Isolation is preserved by the explicit organizationId / by-id WHERE filters.
    return await runWithRlsBypass(async () => {
    const requestBody = await readJsonRequestWithinLimit(req, MAX_MOBILE_LOGIN_BODY_SIZE)
    if (!requestBody.ok) {
      return NextResponse.json(
        { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid JSON" },
        { status: requestBody.reason === "too_large" ? 413 : 400 },
      )
    }
    const parsed = MobileLoginSchema.safeParse(requestBody.value)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid login request" }, { status: 400 })
    }
    const { email: normalizedEmail, password, organizationSlug: normalizedSlug } = parsed.data

    // F-35: optional tenant disambiguation. The same agent email can exist in
    // multiple orgs (multi-tenant), and a bare `findFirst({email})` picks one
    // non-deterministically. Mobile clients should send `organizationSlug` so
    // the lookup hits the (organizationId, email) compound unique.
    //
    // Operators can flip `MTM_REQUIRE_TENANT_SLUG=1` to make slug mandatory
    // — at that point legacy mobile builds return 400 instead of silently
    // hitting the non-deterministic path. Default off: backward compat for
    // mobile builds in the field until the deprecation log signals rollout.
    if (!normalizedSlug && process.env.MTM_REQUIRE_TENANT_SLUG === "1") {
      return NextResponse.json(
        { error: "organizationSlug is required — update your mobile app." },
        { status: 400 }
      )
    }

    // F-02 + F-35 hardening: rate-limit by (IP, email, slug). Without `slug`
    // in the key, an attacker could multiply attempts by varying the slug
    // for the same (IP, email) pair — 5/min becomes 5×N/min. The slug
    // segment is empty for legacy clients, which preserves the old bucket
    // behaviour for that flow.
    const ip = clientIp(req)
    const rateKey = await hashForRateLimit(`mtm-mobile-auth:${ip}:${normalizedEmail}:${normalizedSlug}`)

    // Distributed limits are enforced independently by trusted network peer
    // and by account identifier. Rotating X-Forwarded-For, PM2 workers, or
    // source IPs can no longer multiply the password-guessing budget.
    const [ipDecision, principalDecision] = await Promise.all([
      consumePublicRateLimit("mtm-mobile-auth:ip", ip, AUTH_IP_RATE_LIMIT),
      consumePublicRateLimit(
        "mtm-mobile-auth:principal",
        `${normalizedSlug || "legacy"}:${normalizedEmail}`,
        AUTH_PRINCIPAL_RATE_LIMIT,
      ),
    ])
    if (ipDecision.unavailable || principalDecision.unavailable) {
      return NextResponse.json(
        { error: "Authentication temporarily unavailable" },
        { status: 503, headers: { "Retry-After": "1" } },
      )
    }
    const rateLimited = !ipDecision.allowed || !principalDecision.allowed
    const retryAfterSeconds = Math.max(ipDecision.retryAfterSeconds, principalDecision.retryAfterSeconds, 1)

    // Resolve the target org BEFORE the rate-limit check so the audit
    // event we may emit on burst has a real organizationId. If slug is
    // missing or invalid we skip the audit (orgId is required by the
    // MtmAuditLog FK) and rely on the console.warn signal instead.
    let resolvedOrg: ResolvedAuthAgent["organization"] | null = null
    if (normalizedSlug) {
      resolvedOrg = await prisma.organization.findUnique({
        where: { slug: normalizedSlug, isActive: true },
        select: {
          id: true,
          name: true,
          isActive: true,
          plan: true,
          addons: true,
          features: true,
          modules: true,
        },
      })
      if (!resolvedOrg) {
        return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
      }
    }

    if (rateLimited) {
      // Architect Q5: write a single RATE_LIMITED audit row per window
      // (not per request) so operators see «this principal hit the wall»
      // without the audit table filling with burst noise. PII-masked.
      if (resolvedOrg && !rateLimitAuditFired.has(rateKey)) {
        // Defense-in-depth: clear the dedup map if it grows past the cap
        // rather than leaking under a distributed brute-force.
        if (rateLimitAuditFired.size >= RATE_LIMIT_AUDIT_CAP) {
          for (const t of rateLimitAuditFired.values()) clearTimeout(t)
          rateLimitAuditFired.clear()
        }
        const expiry = setTimeout(() => rateLimitAuditFired.delete(rateKey), AUTH_RATE_LIMIT.windowMs)
        rateLimitAuditFired.set(rateKey, expiry)
        writeMtmAudit({
          organizationId: resolvedOrg.id,
          agentId: null,
          action: "RATE_LIMITED",
          entity: "mobile_auth",
          entityId: null,
          metadataKind: "rate_limited",
          newData: {
            ip,
            email: maskLegacyAuthEmail(normalizedEmail),
            limitPerWindow: AUTH_RATE_LIMIT.maxRequests,
            windowMs: AUTH_RATE_LIMIT.windowMs,
          },
          req,
        }).catch((err) => console.warn("[MTM/mobile/auth] RATE_LIMITED audit failed", err))
      }
      return NextResponse.json(
        { error: "Too many login attempts. Try again in a minute." },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
      )
    }
    let agent: ResolvedAuthAgent | null = null
    if (resolvedOrg) {
      const org = resolvedOrg
      const found = await prisma.mtmAgent.findUnique({
        where: { organizationId_email: { organizationId: org.id, email: normalizedEmail } },
      })
      if (found && found.status === "ACTIVE") {
        agent = { ...found, organization: org }
      }
    } else {
      // F-35 legacy path: clients that haven't shipped organizationSlug yet
      // still hit the non-tenant-scoped lookup. Emit a deprecation signal so
      // operations can see when the last legacy build retires and we can
      // make slug mandatory (returning 401 / "organizationSlug required").
      console.warn(
        `[MTM/mobile/auth] legacy email-only lookup (F-35 deprecated path) — email=${maskLegacyAuthEmail(normalizedEmail)} ip=${ip}`
      )
      agent = await prisma.mtmAgent.findFirst({
        where: {
          email: normalizedEmail,
          status: "ACTIVE",
          organization: { isActive: true },
        },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              isActive: true,
              plan: true,
              addons: true,
              features: true,
              modules: true,
            },
          },
        },
      })
    }

    if (!agent) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
    }

    let authenticated = false
    let linkedUserId = agent.userId
    let linkedUserCredentialState: {
      id: string
      passwordHash: string | null
      passwordChangedAt: Date | null
    } | null = null
    let pendingAutoLink: { previousUserId: string | null; userId: string } | null = null

    // Method 1: Check agent's own passwordHash (primary)
    if (agent.passwordHash) {
      const valid = await bcrypt.compare(password, agent.passwordHash)
      if (valid) {
        authenticated = true
      }
    }

    // Method 2: Fallback to linked CRM User
    if (!authenticated && agent.userId) {
      const user = await prisma.user.findFirst({
        where: { id: agent.userId, organizationId: agent.organizationId, isActive: true },
        select: { id: true, passwordHash: true, passwordChangedAt: true, isActive: true },
      })
      if (user?.isActive && user.passwordHash) {
        const valid = await bcrypt.compare(password, user.passwordHash)
        if (valid) {
          authenticated = true
          linkedUserId = user.id
          linkedUserCredentialState = user
        }
      }
    }

    // Method 3: Auto-find CRM User by same email (if no direct password)
    if (!authenticated && !agent.passwordHash) {
      const user = await prisma.user.findFirst({
        where: { email: normalizedEmail, organizationId: agent.organizationId, isActive: true },
        select: { id: true, passwordHash: true, passwordChangedAt: true },
      })
      if (user?.passwordHash) {
        const valid = await bcrypt.compare(password, user.passwordHash)
        if (valid) {
          authenticated = true
          linkedUserCredentialState = user
          linkedUserId = user.id
          pendingAutoLink = { previousUserId: agent.userId, userId: user.id }
        }
      }
    }

    if (!authenticated) {
      // F-02 / F-08: log failed attempts so admins can spot brute-force / credential stuffing.
      // Architect note: await the write so a process crash before flush doesn't lose the signal.
      await writeMtmAudit({
        organizationId: agent.organizationId,
        agentId: agent.id,
        action: "MOBILE_LOGIN_FAILED",
        entity: "agent",
        entityId: agent.id,
        metadataKind: "login_failed",
        newData: { email: agent.email, reason: "invalid_password" },
        req,
      }).catch((err) => console.warn("[MTM/mobile/auth] LOGIN_FAILED audit failed", err))
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
    }

    // An agent password may authenticate a row that is linked to a CRM User.
    // Bind the token to both credential epochs so changing either password (or
    // choosing "log out everywhere" in CRM) revokes the mobile token too.
    if (linkedUserId && !linkedUserCredentialState) {
      linkedUserCredentialState = await prisma.user.findFirst({
        where: { id: linkedUserId, organizationId: agent.organizationId, isActive: true },
        select: { id: true, passwordHash: true, passwordChangedAt: true },
      })
      if (!linkedUserCredentialState) {
        return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
      }
    }

    const routeFieldEnabled = isTenantCapabilityEnabled("route-field", agent.organization)
    const workforceEnabled = isTenantCapabilityEnabled("workforce-hrm", agent.organization)
    if (!routeFieldEnabled && !workforceEnabled) {
      return NextResponse.json({
        success: false,
        error: "The mobile app is not enabled for this tenant.",
        code: "TENANT_CAPABILITY_DISABLED",
        capabilityId: "mobile-field-app",
        capabilityStatus: "disabled",
      }, { status: 403 })
    }

    if (pendingAutoLink) {
      // Do not mutate identity links for a tenant that cannot use either
      // mobile product. Authentication is evaluated first to avoid an
      // unauthenticated entitlement oracle; the write happens only after the
      // commercial gate has passed.
      await prisma.mtmAgent.update({
        where: { id: agent.id },
        data: { userId: pendingAutoLink.userId },
      })
      await writeMtmAudit({
        organizationId: agent.organizationId,
        agentId: agent.id,
        action: "AUTO_LINK",
        entity: "agent",
        entityId: agent.id,
        metadataKind: "auto_link",
        oldData: { userId: pendingAutoLink.previousUserId },
        newData: {
          userId: pendingAutoLink.userId,
          reason: "Mobile login matched CRM user by email",
        },
        req,
      }).catch((err) => console.warn("[MTM/mobile/auth] AUTO_LINK audit failed", err))
    }

    // F-08: positive login audit (companion to MOBILE_LOGIN_FAILED above).
    // Architect note: await so the success signal is persisted before token return —
    // otherwise a crash before flush would drop the only positive trace.
    await writeMtmAudit({
      organizationId: agent.organizationId,
      agentId: agent.id,
      action: "MOBILE_LOGIN",
      entity: "agent",
      entityId: agent.id,
      metadataKind: "login_success",
      newData: { email: agent.email },
      req,
    }).catch((err) => console.warn("[MTM/mobile/auth] LOGIN audit failed", err))

    const agentSessionFingerprint = createSessionFingerprint({
      principalId: agent.id,
      passwordHash: agent.passwordHash,
      secret: JWT_SECRET,
    })
    const userSessionFingerprint = linkedUserCredentialState
      ? createSessionFingerprint({
          principalId: linkedUserCredentialState.id,
          passwordHash: linkedUserCredentialState.passwordHash,
          passwordChangedAt: linkedUserCredentialState.passwordChangedAt,
          secret: JWT_SECRET,
        })
      : undefined

    // Issue JWT token (7 days). The opaque fingerprints are verified against
    // fresh DB state on every MTM request; legacy tokens without them fail
    // closed and must log in once after rollout.
    const token = jwt.sign(
      {
        agentId: agent.id,
        userId: linkedUserId || "",
        orgId: agent.organizationId,
        email: agent.email,
        name: agent.name,
        role: agent.role,
        agentSessionFingerprint,
        userSessionFingerprint,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    )

    return NextResponse.json({
      success: true,
      data: {
        token,
        agent: {
          id: agent.id,
          name: agent.name,
          email: agent.email,
          phone: agent.phone,
          role: agent.role,
          avatar: agent.avatar,
          organizationId: agent.organizationId,
          organizationName: agent.organization.name,
        },
      },
    })
    })
  } catch (e: unknown) {
    console.error("[Mobile Auth] Error:", e)
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 })
  }
}
