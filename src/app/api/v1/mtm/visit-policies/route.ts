import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { VisitPolicyCreateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { getMtmSettings } from "@/lib/mtm-settings"
import { visitPolicyAccessFor, visitPolicyReadDenied, visitPolicyWriteDenied } from "@/lib/mtm/visit-policy-access"

function overlapWhere(input: {
  organizationId: string
  teamId: string | null
  visitType: string
  priority: number
  effectiveFrom: Date
  effectiveTo: Date | null
  excludeId?: string
}): Prisma.MtmVisitPolicyWhereInput {
  return {
    organizationId: input.organizationId,
    ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    teamId: input.teamId,
    visitType: input.visitType,
    priority: input.priority,
    isActive: true,
    ...(input.effectiveTo ? { effectiveFrom: { lte: input.effectiveTo } } : {}),
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.effectiveFrom } }],
  }
}

export const GET = withRouteFieldWebRlsAuth("read", async (_req, auth) => {
  const access = await visitPolicyAccessFor(auth)
  if (access.kind === "none") return visitPolicyReadDenied(access)
  const settings = await getMtmSettings(auth.orgId)
  if (!settings.visitPoliciesEnabled) return NextResponse.json({ success: true, data: { policies: [], featureDisabled: true } })
  // Managers and supervisors see the rules that apply to their people:
  // organization-wide rules plus rules bound to their teams.
  const scopeWhere: Prisma.MtmVisitPolicyWhereInput = access.kind === "admin"
    ? {}
    : { OR: [{ teamId: null }, ...(access.readableTeamIds.length ? [{ teamId: { in: access.readableTeamIds } }] : [])] }
  const policies = await prisma.mtmVisitPolicy.findMany({
    where: { organizationId: auth.orgId, ...scopeWhere },
    orderBy: [{ isActive: "desc" }, { priority: "asc" }, { effectiveFrom: "desc" }],
    include: {
      team: { select: { id: true, name: true } },
      actions: { orderBy: { actionKey: "asc" } },
    },
  })
  return NextResponse.json({
    success: true,
    data: {
      policies,
      access: {
        canWriteOrganizationWide: access.kind === "admin",
        writableTeamIds: access.kind === "admin" ? null : access.writableTeamIds,
      },
    },
  })
})

export const POST = withRouteFieldWebRlsAuth("write", async (req, auth) => {
  const access = await visitPolicyAccessFor(auth)
  if (access.kind === "none") return visitPolicyReadDenied(access)
  if (access.kind === "supervisor") return visitPolicyWriteDenied(access, null)
  const settings = await getMtmSettings(auth.orgId)
  if (!settings.visitPoliciesEnabled) return NextResponse.json({ error: "Visit policies are disabled", code: "MTM_VISIT_POLICIES_DISABLED" }, { status: 409 })
  const parsed = parseBody(VisitPolicyCreateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const visitType = body.visitType.toUpperCase()
  const effectiveFrom = new Date(body.effectiveFrom)
  const effectiveTo = body.effectiveTo ? new Date(body.effectiveTo) : null
  const writeDenied = visitPolicyWriteDenied(access, body.teamId ?? null)
  if (writeDenied) return writeDenied

  if (body.teamId) {
    const team = await prisma.mtmTeam.findFirst({
      where: { id: body.teamId, organizationId: auth.orgId, isActive: true },
      select: { id: true },
    })
    if (!team) return NextResponse.json({ error: "Team not found", code: "MTM_POLICY_TEAM_INVALID" }, { status: 400 })
  }
  if (body.isActive) {
    const conflict = await prisma.mtmVisitPolicy.findFirst({
      where: overlapWhere({
        organizationId: auth.orgId,
        teamId: body.teamId ?? null,
        visitType,
        priority: body.priority,
        effectiveFrom,
        effectiveTo,
      }),
      select: { id: true, name: true },
    })
    if (conflict) {
      return NextResponse.json({ error: "An active policy with the same priority overlaps this period", code: "MTM_POLICY_WINDOW_CONFLICT", conflict }, { status: 409 })
    }
  }

  const policy = await prisma.mtmVisitPolicy.create({
    data: {
      organizationId: auth.orgId,
      teamId: body.teamId ?? null,
      name: body.name,
      visitType,
      priority: body.priority,
      effectiveFrom,
      effectiveTo,
      isActive: body.isActive,
      createdBy: auth.userId,
      actions: {
        create: body.actions.map((action) => ({
          organizationId: auth.orgId,
          actionKey: action.actionKey,
          mode: action.mode,
          minCount: action.minCount,
          conditions: action.conditions ?? Prisma.JsonNull,
          allowWaiver: action.allowWaiver,
        })),
      },
    },
    include: { actions: true, team: { select: { id: true, name: true } } },
  })

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: null,
    action: "VISIT_POLICY_CREATE",
    entity: "visit_policy",
    entityId: policy.id,
    metadataKind: "visit_policy_change",
    newData: policy,
    req,
  }).catch((error) => console.warn("[MTM/visit-policies POST] audit failed", error))

  return NextResponse.json({ success: true, data: policy }, { status: 201 })
})

export { overlapWhere }
