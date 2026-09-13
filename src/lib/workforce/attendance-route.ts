import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { resolveTwoFactorMethod } from "@/lib/two-factor-policy"
import {
  workforceAttendanceCapabilitiesFromTenant,
  type WorkforceAttendanceCapabilities,
} from "@/lib/workforce/attendance-trust"
import type { WorkforceAttendanceAuditContext } from "@/lib/workforce/attendance-management"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

export type WorkforceAttendanceAddon = "qr" | "deviceTrust"

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

export function workforceAttendanceAddonDisabled(addon: WorkforceAttendanceAddon): NextResponse {
  const capabilityId = addon === "qr" ? "attendance-qr" : "attendance-device-trust"
  return NextResponse.json({
    error: "This Workforce attendance add-on is not enabled for the tenant.",
    code: "TENANT_CAPABILITY_DISABLED",
    capabilityId,
    capabilityStatus: "disabled",
  }, { status: 403 })
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
  if (auth.principalType !== "session") return workforceAttendanceSecurityMfaRequired()

  try {
    const user = await prisma.user.findFirst({
      where: { id: auth.userId, organizationId, isActive: true },
      select: {
        require2fa: true,
        totpEnabled: true,
        smsAuthEnabled: true,
        verifiedPhone: true,
      },
    })
    if (!user || !user.require2fa || !resolveTwoFactorMethod(user)) {
      return workforceAttendanceSecurityMfaRequired()
    }
    return null
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
    code: "WORKFORCE_ATTENDANCE_MFA_REQUIRED",
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

/** Fail closed before any H5 management data is read or changed. */
export async function requireWorkforceAttendanceAdminAddon(
  organizationId: string,
  auth: Pick<AuthResult, "role" | "principalType">,
  addon: WorkforceAttendanceAddon,
): Promise<Response | null> {
  // A key's creator is an audit field, not an impersonation grant. QR station
  // lifecycle and trusted-device approval/revocation change an attendance
  // security factor, so they must be performed by an accountable live admin
  // session. Fail closed when a narrow legacy fixture lacks principalType.
  if (
    auth.principalType !== "session"
    || !isWorkforceAttendanceAdministrator(auth.role)
  ) return workforceAttendanceAdminDenied()
  try {
    const capabilities = await workforceAttendanceCapabilitiesForOrganization(organizationId)
    const enabled = addon === "qr" ? capabilities.qrEnabled : capabilities.deviceTrustEnabled
    return enabled ? null : workforceAttendanceAddonDisabled(addon)
  } catch (error) {
    console.error("[workforce/attendance] entitlement lookup failed", error)
    return NextResponse.json({
      error: "Unable to verify Workforce attendance entitlement.",
      code: "WORKFORCE_ATTENDANCE_CAPABILITY_UNAVAILABLE",
    }, { status: 503 })
  }
}
