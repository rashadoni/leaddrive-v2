import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PhotoReviewSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { canMutateMtmVisit, mutableVisitWhere } from "@/lib/mtm/visit-scope"

type MutablePhoto = {
  id: string
  status: string
  url: string
  agentId: string
  visitId: string | null
  visit: { agentId: string } | null
}

function photoMutationWhere(
  actor: MtmRouteActor,
  organizationId: string,
  photo: MutablePhoto,
): Prisma.MtmPhotoWhereInput {
  const base: Prisma.MtmPhotoWhereInput = {
    id: photo.id,
    organizationId,
    visitId: photo.visitId,
  }
  if (!photo.visitId) return { ...base, agentId: photo.agentId }
  return {
    ...base,
    visit: mutableVisitWhere(actor, organizationId, { id: photo.visitId }),
  }
}

export const PATCH = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const raw = await req.json()
    const parsed = parseBody(PhotoReviewSchema, raw)
    if (!parsed.ok) return parsed.response
    const body = parsed.data

    const actor = await resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    })
    if (!actor) return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
    if (actor.role === "AGENT") {
      return NextResponse.json({ error: "Photo review requires manager access", code: "MTM_PHOTO_REVIEW_FORBIDDEN" }, { status: 403 })
    }

    const before = await prisma.mtmPhoto.findFirst({
      where: { id, organizationId: auth.orgId },
      select: {
        id: true,
        status: true,
        url: true,
        agentId: true,
        visitId: true,
        visit: { select: { agentId: true } },
      },
    })
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const targetAgentId = before.visit?.agentId ?? before.agentId
    if (!canMutateMtmVisit(actor, targetAgentId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const data: any = {}
    if (body.status) {
      data.status = body.status
      data.reviewedAt = new Date()
      data.reviewedBy = auth.userId || actor.agentId
    }
    if (body.reviewNote !== undefined) data.reviewNote = body.reviewNote ?? null

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const changed = await tx.mtmPhoto.updateMany({
        where: photoMutationWhere(actor, auth.orgId, before),
        data,
      })
      if (changed.count === 0) return null
      return changed
    })
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const updated = await prisma.mtmPhoto.findFirst({ where: { id, organizationId: auth.orgId } })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: before.agentId,
      action: "PHOTO_REVIEW",
      entity: "photo",
      entityId: id,
      metadataKind: "photo_review",
      oldData: { status: before.status },
      newData: { status: body.status, reviewedBy: data.reviewedBy, reviewNote: body.reviewNote },
      req,
    }).catch((e) => console.warn("[MTM/photos/[id] PATCH] audit failed", e))

    return NextResponse.json({ success: true, data: updated })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to update" }, { status: 400 })
  }
})

export const DELETE = withRouteFieldRlsAuth("delete", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const actor = await resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    })
    if (!actor) return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })

    const before = await prisma.mtmPhoto.findFirst({
      where: { id, organizationId: auth.orgId },
      select: {
        id: true,
        url: true,
        agentId: true,
        status: true,
        visitId: true,
        visit: { select: { agentId: true } },
        mediaObject: { select: { id: true, state: true, legalHold: true, retentionUntil: true } },
      },
    })
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const targetAgentId = before.visit?.agentId ?? before.agentId
    if (!canMutateMtmVisit(actor, targetAgentId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (before.mediaObject) {
      // Object-backed media is retained under its dedicated policy and may be
      // under legal hold. Do not delete the business row and silently orphan
      // encrypted evidence before the approved retention/purge workflow runs.
      return NextResponse.json(
        {
          error: "Object-backed media is retained and cannot be deleted from this endpoint.",
          code: "MTM_MEDIA_RETENTION_LOCKED",
        },
        { status: 409 },
      )
    }

    const deleted = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const changed = await tx.mtmPhoto.deleteMany({
        where: photoMutationWhere(actor, auth.orgId, before),
      })
      if (changed.count === 0) return null
      return changed
    })
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: before.agentId,
      action: "PHOTO_DELETE",
      entity: "photo",
      entityId: id,
      metadataKind: "photo_delete",
      oldData: { status: before.status, visitId: before.visitId },
      req,
    }).catch((e) => console.warn("[MTM/photos/[id] DELETE] audit failed", e))

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to delete" }, { status: 400 })
  }
})
