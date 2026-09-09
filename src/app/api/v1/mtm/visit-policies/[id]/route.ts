import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { VisitPolicyUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { overlapWhere } from "../route"
import { getMtmSettings } from "@/lib/mtm-settings"

async function isAdministrator(auth: { orgId: string; userId: string; role: string }) {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  return actor?.role === "ADMIN"
}

export const PUT = withRouteFieldWebRlsAuth("write", async (
  req,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  if (!await isAdministrator(auth)) {
    return NextResponse.json({ error: "Administrator access required", code: "MTM_POLICY_ADMIN_REQUIRED" }, { status: 403 })
  }
  const settings = await getMtmSettings(auth.orgId)
  if (!settings.visitPoliciesEnabled) return NextResponse.json({ error: "Visit policies are disabled", code: "MTM_VISIT_POLICIES_DISABLED" }, { status: 409 })
  const { id } = await params
  const existing = await prisma.mtmVisitPolicy.findFirst({
    where: { id, organizationId: auth.orgId },
    include: { actions: true },
  })
  if (!existing) return NextResponse.json({ error: "Policy not found", code: "MTM_POLICY_NOT_FOUND" }, { status: 404 })

  const parsed = parseBody(VisitPolicyUpdateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const teamId = body.teamId === undefined ? existing.teamId : body.teamId
  const visitType = (body.visitType ?? existing.visitType).toUpperCase()
  const priority = body.priority ?? existing.priority
  const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : existing.effectiveFrom
  const effectiveTo = body.effectiveTo === undefined
    ? existing.effectiveTo
    : body.effectiveTo ? new Date(body.effectiveTo) : null
  const isActive = body.isActive ?? existing.isActive

  if (teamId) {
    const team = await prisma.mtmTeam.findFirst({
      where: { id: teamId, organizationId: auth.orgId, isActive: true },
      select: { id: true },
    })
    if (!team) return NextResponse.json({ error: "Team not found", code: "MTM_POLICY_TEAM_INVALID" }, { status: 400 })
  }

  if (isActive) {
    const conflict = await prisma.mtmVisitPolicy.findFirst({
      where: overlapWhere({
        organizationId: auth.orgId,
        teamId,
        visitType,
        priority,
        effectiveFrom,
        effectiveTo,
        excludeId: id,
      }),
      select: { id: true, name: true },
    })
    if (conflict) {
      return NextResponse.json({
        error: "An active policy with the same priority overlaps this period",
        code: "MTM_POLICY_WINDOW_CONFLICT",
        conflict,
      }, { status: 409 })
    }
  }

  const policy = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (body.actions) {
      await tx.mtmVisitPolicyAction.deleteMany({ where: { policyId: id, organizationId: auth.orgId } })
    }
    return tx.mtmVisitPolicy.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        teamId,
        visitType,
        priority,
        effectiveFrom,
        effectiveTo,
        isActive,
        ...(body.actions ? {
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
        } : {}),
      },
      include: { actions: true, team: { select: { id: true, name: true } } },
    })
  })

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: null,
    action: "VISIT_POLICY_UPDATE",
    entity: "visit_policy",
    entityId: id,
    metadataKind: "visit_policy_change",
    oldData: existing,
    newData: policy,
    req,
  }).catch((error) => console.warn("[MTM/visit-policies/[id] PUT] audit failed", error))

  return NextResponse.json({ success: true, data: policy })
})

export const DELETE = withRouteFieldWebRlsAuth("write", async (
  req,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  if (!await isAdministrator(auth)) {
    return NextResponse.json({ error: "Administrator access required", code: "MTM_POLICY_ADMIN_REQUIRED" }, { status: 403 })
  }
  const settings = await getMtmSettings(auth.orgId)
  if (!settings.visitPoliciesEnabled) return NextResponse.json({ error: "Visit policies are disabled", code: "MTM_VISIT_POLICIES_DISABLED" }, { status: 409 })
  const { id } = await params
  const existing = await prisma.mtmVisitPolicy.findFirst({
    where: { id, organizationId: auth.orgId },
    include: { actions: true },
  })
  if (!existing) return NextResponse.json({ error: "Policy not found", code: "MTM_POLICY_NOT_FOUND" }, { status: 404 })

  const policy = await prisma.mtmVisitPolicy.update({
    where: { id },
    data: { isActive: false, effectiveTo: existing.effectiveTo ?? new Date() },
    include: { actions: true },
  })
  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: null,
    action: "VISIT_POLICY_DEACTIVATE",
    entity: "visit_policy",
    entityId: id,
    metadataKind: "visit_policy_change",
    oldData: existing,
    newData: policy,
    req,
  }).catch((error) => console.warn("[MTM/visit-policies/[id] DELETE] audit failed", error))

  return NextResponse.json({ success: true, data: policy })
})
