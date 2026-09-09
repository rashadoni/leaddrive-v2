import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import {
  workforceAttendanceCapabilitiesFromTenant,
  type WorkforceAttendanceCapabilities,
} from "@/lib/workforce/attendance-trust"
import type { WorkforceAttendanceAuditContext } from "@/lib/workforce/attendance-management"

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
