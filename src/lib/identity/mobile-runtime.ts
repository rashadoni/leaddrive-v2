import jwt from "jsonwebtoken"
import type { NextRequest } from "next/server"
import type { RegistryClient } from "./registry"
import { officeAttendanceMobilePath } from "@/lib/mtm/attendance-employee-contract"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { resolveWorkforceExceptionResponseRecording } from "@/lib/workforce/exception-response-rollout"
import { identityRuntimeKeys } from "./runtime-keys"
import { readVerifiedIdentityMobileClaims } from "./mobile-session"
import { authorizeIdentityMobileSession } from "./mobile-session-contract"
import { readIdentityMobileState, withIdentityMobileReadSnapshot } from "./mobile-session-resolver"
import { readIdentityMobileTenantPolicy } from "./tenant-policy"

/** Routing hint only. An identity-shaped token must never fall back to the
 * legacy verifier, even when malformed, expired, revoked or unconfigured. */
export function isIdentityMobileToken(token: string): boolean {
  if (token.length > 4096) return false
  try { return jwt.decode(token, { complete: true })?.header.typ === "leaddrive-mobile+jwt" } catch { return false }
}
export function readIdentityMobileRuntimeClaims(token: string) {
  try {
    const ring = identityRuntimeKeys().mobile
    if (!ring) return null
    // Shared mobile endpoints admit either pinned audience, never an arbitrary
    // issuer/application from a body or an unverified payload.
    return readVerifiedIdentityMobileClaims(token, "TIME", ring.resolve, new Date())
      ?? readVerifiedIdentityMobileClaims(token, "ROUTE_FIELD", ring.resolve, new Date())
  } catch { return null }
}

/** Fresh canonical admission and legacy transport adaptation in one snapshot.
 * Separate reviewed actors preserve historical scope/queues; application is
 * carried onward and Time never inherits Field capabilities or manager role. */
export async function resolveIdentityMobileRuntime(req: NextRequest, token: string, client: RegistryClient) {
  const claims = readIdentityMobileRuntimeClaims(token)
  if (!claims) return null
  const path = req.nextUrl.pathname
  if (claims.application === "TIME" && !officeAttendanceMobilePath(req.method, path)) return null
  try {
    const snapshot = await withIdentityMobileReadSnapshot(client, claims.organizationId, async tx => {
      const state = await readIdentityMobileState(tx, claims.organizationId, claims.sub, claims.application, readIdentityMobileTenantPolicy)
      if (!state) return null
      const [card, company] = await Promise.all([
        tx.mtmAgent.findFirst({ where: { organizationId: claims.organizationId, id: claims.actorId }, select: {
          name: true, email: true, role: true, fieldDeletedAt: true, attendanceParticipant: true, attendanceExcluded: true,
        } }),
        tx.organization.findFirst({ where: { id: claims.organizationId }, select: { plan: true, addons: true, features: true, modules: true } }),
      ])
      if (!card || !company || card.role !== state.grant?.role) return null
      if (claims.application === "TIME" && (card.role !== "EMPLOYEE" || !card.attendanceParticipant || card.attendanceExcluded)) return null
      if (claims.application === "ROUTE_FIELD" && (card.role === "EMPLOYEE" || card.fieldDeletedAt)) return null
      return { state, card, company }
    })
    if (!snapshot.value) return null
    const { state, card, company } = snapshot.value
    const admitted = authorizeIdentityMobileSession(claims, claims.application, state, snapshot.now)
    if (!admitted) return null
    const field = claims.application === "ROUTE_FIELD"
    const workforceHrm = isTenantCapabilityEnabled("workforce-hrm", company)
    return { agentId: admitted.actorId, userId: admitted.userId, orgId: admitted.organizationId,
      name: card.name, email: card.email ?? "", role: admitted.role, identityApplication: admitted.application,
      tenantCapabilities: {
        routeField: field && isTenantCapabilityEnabled("route-field", company), personnel: !field && isTenantCapabilityEnabled("personnel", company),
        workforceHrm, attendanceQr: workforceHrm && isTenantCapabilityEnabled("attendance-qr", company),
        attendanceDeviceTrust: workforceHrm && isTenantCapabilityEnabled("attendance-device-trust", company),
        workforceExceptionResponse: workforceHrm && resolveWorkforceExceptionResponseRecording(company.features) === "AVAILABLE",
      } }
  } catch { return null }
}
