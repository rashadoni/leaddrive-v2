import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { resolveTwoFactorMethod } from "@/lib/two-factor-policy"
import { decidePersistedWorkforceAccess } from "@/lib/workforce/access-grant-resolution"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import {
  workforceAttendanceCapabilitiesFromTenant,
  type WorkforceAttendanceCapabilities,
} from "@/lib/workforce/attendance-trust"
import type { WorkforceAttendanceAuditContext } from "@/lib/workforce/attendance-management"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

export type WorkforceAttendanceAddon = "qr" | "deviceTrust"

export type WorkforceAttendanceAdministrationCapabilities = WorkforceAttendanceCapabilities & {
  canManageQr: boolean
  canManageDeviceTrust: boolean
}

/**
 * Captures only bounded, server-derived request metadata for the immutable
 * attendance-security audit record. `clientIp` deliberately ignores a
 * caller-controlled X-Forwarded-For chain.
 */
export function workforceAttendanceRequestAuditContext(
  req: NextRequest,
  actorUserId: string,
): WorkforceAttendanceAuditContext {
  const ipAddress = clientIp(req)
  return {
    actorUserId,
    ipAddress: ipAddress === "unknown" ? null : ipAddress,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  }
}

export function isWorkforceAttendanceAdministrator(role: string | null | undefined): boolean {
  const normalized = typeof role === "string" ? role.toLowerCase() : ""
  return normalized === "admin" || normalized === "superadmin"
}

export function workforceAttendanceAdminDenied(): NextResponse {
  return NextResponse.json({
    error: "Workforce attendance administration requires a tenant administrator",
    code: "WORKFORCE_ATTENDANCE_ADMIN_REQUIRED",
  }, { status: 403 })
}

function workforceAttendanceGranularAccessDenied(): NextResponse {
  return NextResponse.json({
    error: "This Workforce attendance action requires an effective device-security grant.",
    code: "WORKFORCE_ATTENDANCE_GRANULAR_ACCESS_REQUIRED",
  }, { status: 403, headers: workforceSensitiveResponseHeaders })
}

export function workforceAttendanceAddonDisabled(addon: WorkforceAttendanceAddon): NextResponse {
  const capabilityId = addon === "qr" ? "attendance-qr" : "attendance-device-trust"
  return NextResponse.json({
    error: "This Workforce attendance add-on is not enabled for the tenant.",
    code: "TENANT_CAPABILITY_DISABLED",
    capabilityId,
    capabilityStatus: "disabled",
  }, { status: 403 })
}

/** The 403 code of a principal who does not meet the attendance-security MFA policy. */
export const WORKFORCE_ATTENDANCE_MFA_REQUIRED_CODE = "WORKFORCE_ATTENDANCE_MFA_REQUIRED"

/**
 * The attendance-security MFA policy itself: a live browser session of an
 * active user of the tenant who is required to use MFA and has an enrolled
 * factor. `requireWorkforceAttendanceSecurityMfa` enforces it; a read model
 * asks it to show the requirement before a manager acts. A lookup failure
 * throws, so each caller fails closed its own way.
 */
export async function workforceAttendanceSecurityMfaSatisfied(
  db: Pick<Prisma.TransactionClient, "user">,
  organizationId: string,
  auth: Pick<AuthResult, "userId" | "principalType">,
): Promise<boolean> {
  if (auth.principalType !== "session") return false
  const user = await db.user.findFirst({
    where: { id: auth.userId, organizationId, isActive: true },
    select: {
      require2fa: true,
      totpEnabled: true,
      smsAuthEnabled: true,
      verifiedPhone: true,
    },
  })
  return Boolean(user && user.require2fa && resolveTwoFactorMethod(user))
}

/**
 * Critical attendance controls create, issue, approve, revoke, or retire an
 * authentication/verification factor. They require a live admin session that
 * has a currently enrolled mandatory MFA factor. `resolveCookieSession`
 * already rejects a session pending MFA; this fresh user lookup additionally
 * prevents a role-only admin session from silently bypassing the Workforce
 * policy when its factor is removed after sign-in.
 *
 * This deliberately does not read, reset, or expose recovery codes. MFA
 * recovery remains on the established accountable auth path.
 */
export async function requireWorkforceAttendanceSecurityMfa(
  organizationId: string,
  auth: Pick<AuthResult, "userId" | "principalType">,
): Promise<Response | null> {
  try {
    return await workforceAttendanceSecurityMfaSatisfied(prisma, organizationId, auth)
      ? null
      : workforceAttendanceSecurityMfaRequired()
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "verify-attendance-mfa" })
    return NextResponse.json({
      error: "Unable to verify Workforce attendance MFA policy.",
      code: "WORKFORCE_ATTENDANCE_MFA_UNAVAILABLE",
    }, { status: 503, headers: workforceSensitiveResponseHeaders })
  }
}

function workforceAttendanceSecurityMfaRequired(): NextResponse {
  return NextResponse.json({
    error: "A mandatory enrolled MFA factor is required for this Workforce attendance security action.",
    code: WORKFORCE_ATTENDANCE_MFA_REQUIRED_CODE,
  }, { status: 403, headers: workforceSensitiveResponseHeaders })
}

export async function workforceAttendanceCapabilitiesForOrganization(
  organizationId: string,
): Promise<WorkforceAttendanceCapabilities> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, addons: true, features: true, modules: true },
  })
  return organization
    ? workforceAttendanceCapabilitiesFromTenant(organization)
    : { qrEnabled: false, deviceTrustEnabled: false }
}

/**
 * Resolve tenant-wide QR and trusted-device administration independently from
 * broad CRM roles after the explicit granular-access cutover. A site grant is
 * not inflated into whole-tenant inventory access.
 */
export async function resolveWorkforceAttendanceAdministrationCapabilities(
  organizationId: string,
  auth: Pick<AuthResult, "role" | "principalType" | "userId">,
): Promise<WorkforceAttendanceAdministrationCapabilities> {
  const capabilities = await workforceAttendanceCapabilitiesForOrganization(organizationId)
  if (auth.principalType !== "session") {
    return { ...capabilities, canManageQr: false, canManageDeviceTrust: false }
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { features: true },
  })
  if (!organization) return { ...capabilities, canManageQr: false, canManageDeviceTrust: false }

  if (!workforceGranularAccessEnabled(organization.features)) {
    const legacyAdmin = isWorkforceAttendanceAdministrator(auth.role)
    return {
      ...capabilities,
      canManageQr: capabilities.qrEnabled && legacyAdmin,
      canManageDeviceTrust: capabilities.deviceTrustEnabled && legacyAdmin,
    }
  }

  const qrAccess = capabilities.qrEnabled
    ? await decidePersistedWorkforceAccess({
        db: prisma,
        organizationId,
        principalUserId: auth.userId,
        selfAgentId: null,
        permission: "QR_STATION_MANAGE",
        resource: { organizationId },
      })
    : { allowed: false as const }
  const deviceAccess = capabilities.deviceTrustEnabled
    ? await decidePersistedWorkforceAccess({
        db: prisma,
        organizationId,
        principalUserId: auth.userId,
        selfAgentId: null,
        permission: "DEVICE_LIFECYCLE_MANAGE",
        resource: { organizationId },
      })
    : { allowed: false as const }
  return {
    ...capabilities,
    canManageQr: qrAccess.allowed,
    canManageDeviceTrust: deviceAccess.allowed,
  }
}

/** Fail closed before any H5 management data is read or changed. */
export async function requireWorkforceAttendanceAdminAddon(
  organizationId: string,
  auth: Pick<AuthResult, "role" | "principalType" | "userId">,
  addon: WorkforceAttendanceAddon,
): Promise<Response | null> {
  // A key's creator is an audit field, not an impersonation grant. QR station
  // lifecycle and trusted-device approval/revocation change an attendance
  // security factor, so they must be performed by an accountable live admin
  // session. Fail closed when a narrow legacy fixture lacks principalType.
  try {
    const capabilities = await resolveWorkforceAttendanceAdministrationCapabilities(organizationId, auth)
    const enabled = addon === "qr" ? capabilities.qrEnabled : capabilities.deviceTrustEnabled
    if (!enabled) return workforceAttendanceAddonDisabled(addon)
    if (addon === "qr") return capabilities.canManageQr ? null : workforceAttendanceAdminDenied()
    return capabilities.canManageDeviceTrust ? null : workforceAttendanceGranularAccessDenied()
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "verify-attendance-administration" })
    return NextResponse.json({
      error: "Unable to verify Workforce attendance entitlement.",
      code: "WORKFORCE_ATTENDANCE_CAPABILITY_UNAVAILABLE",
    }, { status: 503, headers: workforceSensitiveResponseHeaders })
  }
}
