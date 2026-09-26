import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  canWriteMtmVisitPolicyTeam,
  resolveMtmVisitPolicyAccess,
  type MtmVisitPolicyAccess,
} from "@/lib/mtm/route-permissions"
import { mtmFieldScopeRequiredResponse } from "@/lib/mtm/field-access"

export async function visitPolicyAccessFor(auth: { orgId: string; userId: string; role: string }) {
  return resolveMtmVisitPolicyAccess(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
}

/** 403 for a caller who may not open visit policies at all. */
export function visitPolicyReadDenied(access: Extract<MtmVisitPolicyAccess, { kind: "none" }>): Response {
  if (access.reason === "no_field_scope") return mtmFieldScopeRequiredResponse()
  return NextResponse.json({ error: "Manager access required", code: "MTM_POLICY_ADMIN_REQUIRED" }, { status: 403 })
}

/** 403 unless the caller may write a policy bound to `teamId` (null = org-wide), else null. */
export function visitPolicyWriteDenied(access: MtmVisitPolicyAccess, teamId: string | null): Response | null {
  if (access.kind === "none") return visitPolicyReadDenied(access)
  if (canWriteMtmVisitPolicyTeam(access, teamId)) return null
  if (access.kind === "manager") {
    return NextResponse.json({
      error: teamId === null
        ? "Only an administrator can change organization-wide visit policies"
        : "This team is outside your field scope",
      code: "MTM_POLICY_SCOPE_FORBIDDEN",
    }, { status: 403 })
  }
  return visitPolicyReadOnlyResponse()
}

/** Supervisors see the rules of their team but do not change them. */
export function visitPolicyReadOnlyResponse(): Response {
  return NextResponse.json({ error: "Visit policies are read-only for supervisors", code: "MTM_POLICY_READ_ONLY" }, { status: 403 })
}

