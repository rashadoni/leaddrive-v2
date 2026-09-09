import { NextRequest, NextResponse } from "next/server"
import jwt, { type JwtPayload } from "jsonwebtoken"
import { prisma } from "./prisma"
import { runWithRlsBypass } from "./rls-context"
import {
  createSessionFingerprint,
  hasCurrentSessionFingerprint,
} from "./session-invalidation"
import { requireAuthSecret } from "./auth-secret"
import { isTenantCapabilityEnabled } from "./tenant-capabilities"

export function requireJwtSecret(): string {
  return requireAuthSecret()
}
export const JWT_SECRET: string = requireJwtSecret()

export interface MobileAuthResult {
  agentId: string
  userId: string
  orgId: string
  email: string
  name: string
  role: string
  /**
   * Fresh entitlement state resolved together with token revocation.  Route
   * handlers consume this rather than trusting a long-lived APK manifest.
   */
  tenantCapabilities: MobileTenantCapabilities
}

export interface MobileTenantCapabilities {
  routeField: boolean
  workforceHrm: boolean
  /**
   * Workforce add-ons remain independently false unless explicitly sold and
   * enabled. Optional typing keeps existing in-process callers compatible;
   * `resolveMobileAuth` always populates both flags for real requests.
   */
  attendanceQr?: boolean
  attendanceDeviceTrust?: boolean
}

// The JWT deliberately carries no tenant entitlement: it is resolved from
// the active Organization row on every request, alongside revocation checks.
type MobileTokenAuthResult = Omit<MobileAuthResult, "tenantCapabilities"> & {
  agentSessionFingerprint?: string
  userSessionFingerprint?: string
}

type VerifiedMobileJwtPayload = JwtPayload & {
  agentId: string
  orgId: string
  userId?: unknown
  email?: unknown
  name?: unknown
  role?: unknown
  agentSessionFingerprint?: unknown
  userSessionFingerprint?: unknown
}

function isVerifiedMobileJwtPayload(payload: JwtPayload): payload is VerifiedMobileJwtPayload {
  return typeof payload.agentId === "string" &&
    typeof payload.orgId === "string"
}

/**
 * Deprecated call-shape compatibility. The fresh capability snapshot is now
 * resolved for every mobile token; endpoint-specific gating belongs in the
 * common RLS wrapper, not in a second authentication state machine.
 */
export interface MobileAuthOptions {
  allowFieldSuite?: boolean
}

/**
 * Verify mobile JWT token from Authorization header.
 * Returns the decoded agent info WITHOUT a DB revocation check — sync, cheap.
 * Use resolveMobileAuth() when you need the full revocation check (all MTM routes).
 */
export function getMobileAuth(req: NextRequest): MobileTokenAuthResult | null {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null

  const token = authHeader.slice(7)
  // Skip API keys (ld_ prefix)
  if (token.startsWith("ld_")) return null

  try {
    const verified = jwt.verify(token, JWT_SECRET)
    if (typeof verified === "string" || !isVerifiedMobileJwtPayload(verified)) return null
    const payload = verified

    const decoded: MobileTokenAuthResult = {
      agentId: payload.agentId,
      userId: typeof payload.userId === "string" ? payload.userId : "",
      orgId: payload.orgId,
      email: typeof payload.email === "string" ? payload.email : "",
      name: typeof payload.name === "string" ? payload.name : "",
      role: typeof payload.role === "string" ? payload.role : "",
    }
    if (typeof payload.agentSessionFingerprint === "string") {
      decoded.agentSessionFingerprint = payload.agentSessionFingerprint
    }
    if (typeof payload.userSessionFingerprint === "string") {
      decoded.userSessionFingerprint = payload.userSessionFingerprint
    }
    return decoded
  } catch {
    return null
  }
}

/**
 * Resolve a mobile JWT with fresh DB revocation checks (agent/org state plus
 * exact agent and linked-user credential fingerprints).
 *
 * Every MTM-authenticated entry point (requireMobileAuth + getOrgId mobile branch)
 * must run through this to ensure a fired or suspended agent's 7-day token is
 * immediately revoked rather than staying valid until token expiry.
 *
 * NOTE: one agent query plus one linked-user query when applicable. There is
 * deliberately no TTL cache on credential state: password revocation must be
 * visible on the first request after the write commits.
 *
 * Returns the MobileAuthResult when the principal is active, null otherwise.
 * The caller MUST treat null as unauthenticated (→ 401).
 */
export async function resolveMobileAuth(
  req: NextRequest,
  _options: MobileAuthOptions = {},
): Promise<MobileAuthResult | null> {
  const decoded = getMobileAuth(req)
  if (!decoded) return null
  let currentRole: string | null = null
  let tenantCapabilities: MobileTenantCapabilities = {
    routeField: false,
    workforceHrm: false,
    attendanceQr: false,
    attendanceDeviceTrust: false,
  }

  try {
    // RLS: revocation check runs before any tenant context exists — bypass-wrapped.
    const agent = await runWithRlsBypass(() => prisma.mtmAgent.findFirst({
      where: { id: decoded.agentId, organizationId: decoded.orgId },
      select: {
        role: true,
        status: true,
        userId: true,
        passwordHash: true,
        organization: {
          select: { isActive: true, plan: true, addons: true, features: true, modules: true },
        },
      },
    }))

    if (!agent) {
      console.warn(`[mobile-auth][revocation] agent not found — agentId=${decoded.agentId} orgId=${decoded.orgId}`)
      return null
    }
    if (agent.status !== "ACTIVE") {
      console.warn(`[mobile-auth][revocation] agent not ACTIVE — agentId=${decoded.agentId} status=${agent.status}`)
      return null
    }
    if (!agent.organization?.isActive) {
      console.warn(`[mobile-auth][revocation] org not active — agentId=${decoded.agentId} orgId=${decoded.orgId}`)
      return null
    }
    const entitlementFields = {
      plan: agent.organization.plan,
      addons: agent.organization.addons,
      features: agent.organization.features,
      modules: agent.organization.modules,
    }
    const routeFieldEnabled = isTenantCapabilityEnabled("route-field", entitlementFields)
    const workforceEnabled = isTenantCapabilityEnabled("workforce-hrm", entitlementFields)
    const attendanceQrEnabled = workforceEnabled
      && isTenantCapabilityEnabled("attendance-qr", entitlementFields)
    const attendanceDeviceTrustEnabled = workforceEnabled
      && isTenantCapabilityEnabled("attendance-device-trust", entitlementFields)
    if (!routeFieldEnabled && !workforceEnabled) {
      console.warn(`[mobile-auth][revocation] Route Field and Workforce are disabled — agentId=${decoded.agentId} orgId=${decoded.orgId}`)
      return null
    }
    tenantCapabilities = {
      routeField: routeFieldEnabled,
      workforceHrm: workforceEnabled,
      attendanceQr: attendanceQrEnabled,
      attendanceDeviceTrust: attendanceDeviceTrustEnabled,
    }
    const currentAgentFingerprint = createSessionFingerprint({
      principalId: decoded.agentId,
      passwordHash: agent.passwordHash,
      secret: JWT_SECRET,
    })
    if (!hasCurrentSessionFingerprint(decoded.agentSessionFingerprint, currentAgentFingerprint)) {
      console.warn(`[mobile-auth][revocation] agent credential epoch changed — agentId=${decoded.agentId}`)
      return null
    }
    if ((agent.userId || "") !== (decoded.userId || "")) {
      console.warn(`[mobile-auth][revocation] linked user changed — agentId=${decoded.agentId}`)
      return null
    }
    currentRole = agent.role

    // FIX C: linked-user revocation check.
    // When the mobile JWT carries a `userId` (the CRM User this agent is linked to),
    // also check that the linked user is still active. User.isActive=false means the
    // CRM account was deactivated — mobile access should be revoked with it.
    const linkedUserId = agent.userId
    if (linkedUserId) {
      // RLS: linked-user revocation check — same pre-context bootstrap, bypass-wrapped.
      const user = await runWithRlsBypass(() => prisma.user.findFirst({
        where: { id: linkedUserId, organizationId: decoded.orgId },
        select: { isActive: true, passwordHash: true, passwordChangedAt: true },
      }))
      if (!user) {
        console.warn(`[mobile-auth][revocation] linked user not found — userId=${linkedUserId} orgId=${decoded.orgId}`)
        return null
      }
      if (!user.isActive) {
        console.warn(`[mobile-auth][revocation] linked user deactivated — userId=${decoded.userId} agentId=${decoded.agentId}`)
        return null
      }
      const currentUserFingerprint = createSessionFingerprint({
        principalId: linkedUserId,
        passwordHash: user.passwordHash,
        passwordChangedAt: user.passwordChangedAt,
        secret: JWT_SECRET,
      })
      if (!hasCurrentSessionFingerprint(decoded.userSessionFingerprint, currentUserFingerprint)) {
        console.warn(`[mobile-auth][revocation] linked user credential epoch changed — userId=${linkedUserId} agentId=${decoded.agentId}`)
        return null
      }
    }
  } catch (err) {
    // DB error during revocation check — fail CLOSED (reject, don't let through).
    // Safer than fail-open: a brief DB hiccup during a security check must not
    // silently grant access to potentially-revoked principals.
    console.warn(`[mobile-auth][revocation] DB error, failing closed — agentId=${decoded.agentId}`, err)
    return null
  }

  // Authorization is deliberately hydrated from the current agent row rather
  // than the long-lived JWT. A demotion must remove manager scope immediately,
  // while a promotion should not require waiting for token expiry either.
  return currentRole ? {
    agentId: decoded.agentId,
    userId: decoded.userId,
    orgId: decoded.orgId,
    email: decoded.email,
    name: decoded.name,
    role: currentRole,
    tenantCapabilities,
  } : null
}

/**
 * Require mobile auth with full revocation check — returns MobileAuthResult or 401 response.
 * Used by all /api/v1/mtm/* route handlers.
 */
export async function requireMobileAuth(req: NextRequest): Promise<MobileAuthResult | NextResponse> {
  const auth = await resolveMobileAuth(req)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return auth
}
