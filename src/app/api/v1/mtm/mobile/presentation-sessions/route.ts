import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { expandVisibleProductGroupIds } from "@/lib/mtm/product-group-access"
import {
  isPresentationTimePlausible,
  PresentationSessionOpenSchema,
} from "@/lib/mtm/presentation-session"
import { withMobileRls } from "@/lib/with-mobile-rls"

export const POST = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "FIELD_EXECUTE")
  if (forbidden) return forbidden

  const parsed = PresentationSessionOpenSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: "Invalid presentation session",
      code: "MTM_PRESENTATION_SESSION_INVALID",
      details: parsed.error.flatten(),
    }, { status: 400 })
  }

  try {
    const existing = await prisma.mtmPresentationSession.findFirst({
      where: {
        organizationId: auth.orgId,
        agentId: auth.agentId,
        clientSessionId: parsed.data.clientSessionId,
      },
    })
    if (existing) return NextResponse.json({ success: true, data: existing, idempotent: true })

    const [visit, groups, product] = await Promise.all([
      prisma.mtmVisit.findFirst({
        where: {
          id: parsed.data.visitId,
          organizationId: auth.orgId,
          agentId: auth.agentId,
          deletedAt: null,
        },
        select: { id: true, customerId: true, checkInAt: true, checkOutAt: true },
      }),
      prisma.mtmProductGroup.findMany({
        where: { organizationId: auth.orgId, isActive: true },
        select: {
          id: true,
          parentId: true,
          members: { where: { agentId: auth.agentId }, select: { id: true } },
        },
      }),
      prisma.mtmProduct.findFirst({
        where: { id: parsed.data.productId, organizationId: auth.orgId, isActive: true },
        select: {
          id: true,
          groupId: true,
          presentationVersion: true,
          document: { select: { id: true, deletedAt: true } },
        },
      }),
    ])

    if (!visit) {
      return NextResponse.json({ error: "Visit not found", code: "MTM_VISIT_NOT_FOUND" }, { status: 404 })
    }
    if (!product) {
      return NextResponse.json({ error: "Product not found", code: "MTM_PRODUCT_NOT_FOUND" }, { status: 404 })
    }

    const visibleGroupIds = expandVisibleProductGroupIds(groups.map((group) => ({
      id: group.id,
      parentId: group.parentId,
      hasDirectMembership: group.members.length > 0,
    })))
    if (!visibleGroupIds.has(product.groupId)) {
      return NextResponse.json({ error: "Product is not assigned", code: "MTM_PRODUCT_NOT_ASSIGNED" }, { status: 403 })
    }
    if (!product.document || product.document.deletedAt) {
      return NextResponse.json({ error: "Presentation file is unavailable", code: "MTM_PRESENTATION_UNAVAILABLE" }, { status: 409 })
    }

    const openedAt = new Date(parsed.data.openedAt)
    if (!isPresentationTimePlausible({
      openedAt,
      visitCheckInAt: visit.checkInAt,
      visitCheckOutAt: visit.checkOutAt,
    })) {
      return NextResponse.json({
        error: "Presentation time is outside the visit",
        code: "MTM_PRESENTATION_OUTSIDE_VISIT",
      }, { status: 422 })
    }

    const session = await prisma.mtmPresentationSession.create({
      data: {
        organizationId: auth.orgId,
        clientSessionId: parsed.data.clientSessionId,
        visitId: visit.id,
        agentId: auth.agentId,
        customerId: visit.customerId,
        productId: product.id,
        documentId: product.document.id,
        presentationVersion: product.presentationVersion,
        openedAt,
        lastViewedAt: openedAt,
        pageCount: parsed.data.pageCount ?? null,
        openLat: parsed.data.location?.latitude ?? null,
        openLng: parsed.data.location?.longitude ?? null,
      },
    })

    return NextResponse.json({ success: true, data: session }, { status: 201 })
  } catch (error) {
    console.error("[MTM/mobile/presentation-sessions POST]", error)
    return NextResponse.json({
      error: "Failed to start presentation session",
      code: "MTM_PRESENTATION_SESSION_CREATE_FAILED",
    }, { status: 500 })
  }
})
