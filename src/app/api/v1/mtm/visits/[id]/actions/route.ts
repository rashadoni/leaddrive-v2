import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { VisitActionResultSchema, parseBody } from "@/lib/mtm-validators"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { mutableVisitWhere, scopedVisitWhere } from "@/lib/mtm/visit-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"

type ScopedRequirement = { id: string; actionKey: string; mode: string; allowWaiver: boolean }
type ScopedActionResult = { id: string }

async function getScopedVisit(
  id: string,
  auth: MtmRlsAuth,
  access: "read" | "mutate",
) {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return null
  const visit = await prisma.mtmVisit.findFirst({
    where: access === "mutate"
      ? mutableVisitWhere(actor, auth.orgId, { id })
      : scopedVisitWhere(actor, auth.orgId, { id }),
    select: {
      id: true,
      agentId: true,
      status: true,
      requirementSnapshot: {
        select: {
          id: true,
          sourcePolicyId: true,
          resolvedAt: true,
          requirements: { orderBy: { actionKey: "asc" } },
        },
      },
      actionResults: { orderBy: { createdAt: "asc" } },
    },
  })
  if (!visit) return null
  return { actor, visit }
}

export const GET = withRouteFieldRlsAuth("read", async (
  _req,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params
  const scoped = await getScopedVisit(id, auth, "read")
  if (!scoped) return NextResponse.json({ error: "Visit not found", code: "MTM_VISIT_NOT_FOUND" }, { status: 404 })
  return NextResponse.json({
    success: true,
    data: {
      snapshot: scoped.visit.requirementSnapshot,
      results: scoped.visit.actionResults,
    },
  })
})

export const POST = withRouteFieldRlsAuth("write", async (
  req,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params
  const parsed = parseBody(VisitActionResultSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const scoped = await getScopedVisit(id, auth, "mutate")
  if (!scoped) return NextResponse.json({ error: "Visit not found", code: "MTM_VISIT_NOT_FOUND" }, { status: 404 })
  if (scoped.visit.status !== "CHECKED_IN") {
    return NextResponse.json({ error: "Visit is not active", code: "MTM_VISIT_NOT_ACTIVE" }, { status: 409 })
  }

  const requirement = scoped.visit.requirementSnapshot?.requirements.find(
    (item: ScopedRequirement) => item.actionKey === parsed.data.actionKey,
  )
  if (!requirement || requirement.mode === "HIDDEN") {
    return NextResponse.json({ error: "Action is not available for this visit", code: "MTM_VISIT_ACTION_HIDDEN" }, { status: 403 })
  }
  if (parsed.data.status === "WAIVED" && !requirement.allowWaiver) {
    return NextResponse.json({ error: "This action cannot be waived", code: "MTM_VISIT_ACTION_WAIVER_FORBIDDEN" }, { status: 422 })
  }

  if (parsed.data.id) {
    const existing = scoped.visit.actionResults.find((result: ScopedActionResult) => result.id === parsed.data.id)
    if (existing) return NextResponse.json({ success: true, data: existing, idempotent: true })
    const conflicting = await prisma.mtmVisitActionResult.findFirst({
      where: { id: parsed.data.id, organizationId: auth.orgId },
      select: { id: true },
    })
    if (conflicting) {
      return NextResponse.json({ error: "Action result id is already in use", code: "MTM_VISIT_ACTION_ID_CONFLICT" }, { status: 409 })
    }
  }

  const completedByAgentId = scoped.actor.agentId ?? scoped.visit.agentId
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Lock the visit through a tenant + current-primary-scope predicate. Setting
    // the already-validated status to itself gives updateMany an atomic WHERE
    // fence, so a concurrent checkout/reassignment cannot leave an action
    // result on a visit that is no longer mutable by this actor.
    const locked = await tx.mtmVisit.updateMany({
      where: mutableVisitWhere(scoped.actor, auth.orgId, { id, status: "CHECKED_IN" }),
      data: { status: "CHECKED_IN" },
    })
    if (locked.count !== 1) return null

    const created = await tx.mtmVisitActionResult.create({
      data: {
        ...(parsed.data.id ? { id: parsed.data.id } : {}),
        organizationId: auth.orgId,
        visitId: id,
        requirementId: requirement.id,
        actionKey: parsed.data.actionKey,
        status: parsed.data.status,
        evidence: parsed.data.evidence ?? Prisma.JsonNull,
        completedByAgentId,
        completedAt: new Date(),
      },
    })
    return created
  })
  if (!result) {
    return NextResponse.json({ error: "Visit changed while saving", code: "MTM_VISIT_MUTATION_CONFLICT" }, { status: 409 })
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: completedByAgentId,
    action: "VISIT_ACTION_COMPLETE",
    entity: "visit_action_result",
    entityId: result.id,
    metadataKind: "visit_action_result",
    newData: { visitId: id, actionKey: result.actionKey, status: result.status },
    req,
  }).catch((error) => console.warn("[MTM/visits/[id]/actions POST] audit failed", error))

  return NextResponse.json({ success: true, data: result }, { status: 201 })
})
