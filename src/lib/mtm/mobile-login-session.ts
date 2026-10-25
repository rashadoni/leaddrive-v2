import { NextResponse } from "next/server"
import jwt from "jsonwebtoken"
import type { MtmAgent } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { readLegacyCredentialBoundary, readLegacyPhoneCredentialBoundary } from "@/lib/identity/legacy-credential-boundary"
import { JWT_SECRET } from "@/lib/mobile-auth"
import { normalizeIdentityPhone } from "@/lib/identity/contract"
import { createSessionFingerprint } from "@/lib/session-invalidation"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { readAttendanceFeature } from "@/lib/mtm/attendance-feature"

/**
 * One way out of every MTM app sign-in — the password form and the code from
 * WhatsApp — so the two cannot drift apart on who is let in or what the token
 * carries.
 */

export type MobileLoginAgent = MtmAgent & {
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

export type LinkedUserCredentials = {
  id: string
  passwordHash: string | null
  passwordChangedAt: Date | null
}

/**
 * An office employee signs in only while they are in Personnel: linked to a
 * CRM user, taking part in attendance, with attendance switched on.
 */
export async function officeEmployeeMaySignIn(agent: Pick<MtmAgent, "role" | "userId" | "attendanceParticipant" | "organizationId">): Promise<boolean> {
  if (agent.role !== "EMPLOYEE") return true
  if (!agent.userId || !agent.attendanceParticipant) return false
  return await readAttendanceFeature(prisma, agent.organizationId)
}

/** Admission only: canonical authority must never fall back to old credentials. */
export async function legacyMobileMaySignIn(agent: Pick<MtmAgent, "id" | "role" | "userId" | "attendanceParticipant" | "organizationId">, enteredPhone?: string): Promise<boolean> {
  const boundary = await runWithTenant(agent.organizationId, () => enteredPhone === undefined
    ? readLegacyCredentialBoundary(prisma, agent.organizationId, { kind: "ACTOR", actorId: agent.id })
    : readLegacyPhoneCredentialBoundary(prisma, agent.organizationId, agent.id, enteredPhone))
  return boundary === "LEGACY" && await officeEmployeeMaySignIn(agent)
}

/** Recheck the resolved target before an email-based legacy auto-link or token. */
export async function legacyLinkedUserMaySignIn(organizationId: string, userId: string): Promise<boolean> {
  return await runWithTenant(organizationId, async () =>
    await readLegacyCredentialBoundary(prisma, organizationId, { kind: "USER", userId }) === "LEGACY")
}

/**
 * The 403 for a tenant that has neither mobile product. Personnel alone admits
 * office staff to their own attendance; a field agent needs routes. Every
 * request re-checks this in resolveMobileAuth.
 */
export function mobileAppRefusal(agent: Pick<MobileLoginAgent, "role" | "organization">): NextResponse | null {
  const routeFieldEnabled = isTenantCapabilityEnabled("route-field", agent.organization)
  const workforceEnabled = isTenantCapabilityEnabled("workforce-hrm", agent.organization)
  const officeAttendanceOnly = !routeFieldEnabled && !workforceEnabled
    && isTenantCapabilityEnabled("personnel", agent.organization) && agent.role !== "AGENT"
  if (routeFieldEnabled || workforceEnabled || officeAttendanceOnly) return null
  return NextResponse.json({
    success: false,
    error: "The mobile app is not enabled for this tenant.",
    code: "TENANT_CAPABILITY_DISABLED",
    capabilityId: "mobile-field-app",
    capabilityStatus: "disabled",
  }, { status: 403 })
}

/** The linked CRM user's credential epoch, or null when the link is broken. */
export async function linkedUserCredentials(agent: Pick<MtmAgent, "organizationId">, userId: string): Promise<LinkedUserCredentials | null> {
  return await prisma.user.findFirst({
    where: { id: userId, organizationId: agent.organizationId, isActive: true },
    select: { id: true, passwordHash: true, passwordChangedAt: true },
  })
}

/**
 * The signed-in response. The token is bound to both credential epochs — the
 * card's and the linked CRM user's — so changing either password, or «log out
 * everywhere» in CRM, revokes it. The opaque fingerprints are verified against
 * fresh database state on every MTM request.
 */
export function mobileLoginSuccess(agent: MobileLoginAgent, linkedUserId: string | null, linkedUser: LinkedUserCredentials | null): NextResponse {
  const agentSessionFingerprint = createSessionFingerprint({
    principalId: agent.id,
    passwordHash: agent.passwordHash,
    secret: JWT_SECRET,
  })
  const userSessionFingerprint = linkedUser
    ? createSessionFingerprint({
        principalId: linkedUser.id,
        passwordHash: linkedUser.passwordHash,
        passwordChangedAt: linkedUser.passwordChangedAt,
        secret: JWT_SECRET,
      })
    : undefined

  // Seven days. Legacy tokens without the fingerprints fail closed.
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
    { expiresIn: "7d" },
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
}

/**
 * A code from WhatsApp proves the number, not a password. What it buys is one
 * thing: setting the card's own password, within a quarter of an hour.
 *
 * The token names the card by `sub` and carries no `agentId`, so neither the
 * middleware nor resolveMobileAuth can mistake it for a session. It holds the
 * card's credential fingerprint at the moment the code was accepted; setting
 * the password changes that fingerprint, so the token works once. Version2
 * also binds the server-verified delivery number; the setter rechecks the
 * current effective number inside its writer transaction. Older unbound
 * capabilities expire closed and require a new code, never a format fallback.
 */
const PASSWORD_SETUP_AUDIENCE = "mtm-password-setup"
const PASSWORD_SETUP_TTL = "15m"

export function signPasswordSetupToken(agent: Pick<MtmAgent, "id" | "organizationId" | "passwordHash">, verifiedPhone: string): string {
  const phone = normalizeIdentityPhone(verifiedPhone)
  if (!phone || phone !== verifiedPhone) throw new Error("MTM_SETUP_PHONE_INVALID")
  return jwt.sign(
    { v: 2, phone, org: agent.organizationId, fp: createSessionFingerprint({ principalId: agent.id, passwordHash: agent.passwordHash, secret: JWT_SECRET }) },
    JWT_SECRET,
    { subject: agent.id, audience: PASSWORD_SETUP_AUDIENCE, expiresIn: PASSWORD_SETUP_TTL },
  )
}

export function readPasswordSetupToken(token: string): { agentId: string; organizationId: string; fingerprint: string; phone: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET, { audience: PASSWORD_SETUP_AUDIENCE, algorithms: ["HS256"] }) as jwt.JwtPayload
    if (payload.v !== 2 || typeof payload.phone !== "string" || normalizeIdentityPhone(payload.phone) !== payload.phone
      || typeof payload.sub !== "string" || typeof payload.org !== "string" || typeof payload.fp !== "string") return null
    return { agentId: payload.sub, organizationId: payload.org, fingerprint: payload.fp, phone: payload.phone }
  } catch {
    return null
  }
}

/** Whether the card's password is still the one the setup token saw. */
export function passwordSetupStillFresh(agent: Pick<MtmAgent, "id" | "passwordHash">, fingerprint: string): boolean {
  return createSessionFingerprint({ principalId: agent.id, passwordHash: agent.passwordHash, secret: JWT_SECRET }) === fingerprint
}
