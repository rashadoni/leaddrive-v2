import { Prisma } from "@prisma/client"
import { z } from "zod"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import { rankContactDuplicates, splitContactName } from "@/lib/mtm/contact-create-request"

type RouteContext = { params: Promise<{ id: string }> }
const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().max(1000).nullable().optional(),
})

class DecisionConflict extends Error {
  constructor(readonly code: string, message: string, readonly candidates?: unknown) { super(message) }
}

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !canManageFieldMasterData(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const parsed = decisionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid decision" }, { status: 400 })
  const { id } = await params
  const requestRecord = await prisma.mtmContactCreateRequest.findFirst({
    where: { id, organizationId: auth.orgId },
    include: { approvedContact: { select: { id: true, displayName: true } } },
  })
  if (!requestRecord) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (actor.scopedAgentIds !== null && !actor.scopedAgentIds.includes(requestRecord.requestedByAgentId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (actor.agentId === requestRecord.requestedByAgentId) {
    return NextResponse.json({ error: "A requester cannot review their own request", code: "MTM_SELF_REVIEW_DENIED" }, { status: 403 })
  }
  if (["APPROVED", "REJECTED", "CANCELLED"].includes(requestRecord.status)) {
    if (requestRecord.status === parsed.data.decision) return NextResponse.json({ success: true, data: requestRecord, idempotent: true })
    return NextResponse.json({ error: "Request already decided", code: "MTM_CONTACT_CREATE_ALREADY_DECIDED" }, { status: 409 })
  }

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.mtmContactCreateRequest.updateMany({
        where: { id, organizationId: auth.orgId, status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] } },
        data: { status: "IN_REVIEW", reviewedBy: auth.userId || null, decisionComment: parsed.data.comment || null },
      })
      if (claimed.count !== 1) throw new DecisionConflict("MTM_CONTACT_CREATE_CONFLICT", "Request changed concurrently")

      if (parsed.data.decision === "REJECTED") {
        return tx.mtmContactCreateRequest.update({
          where: { id },
          data: { status: "REJECTED", reviewedAt: new Date() },
        })
      }

      const contacts = await tx.mtmContact.findMany({
        where: { organizationId: auth.orgId, deletedAt: null },
        select: { id: true, displayName: true, specialtyName: true, phone: true },
        take: 5000,
      })
      const duplicates = rankContactDuplicates(requestRecord, contacts).filter((candidate) => candidate.exact)
      if (duplicates.length) throw new DecisionConflict("MTM_CONTACT_CREATE_DUPLICATE", "A matching contact already exists", duplicates)

      let customer = await tx.mtmCustomer.findFirst({
        where: { organizationId: auth.orgId, deletedAt: null, name: { equals: requestRecord.clinicName, mode: "insensitive" } },
        select: { id: true },
      })
      if (!customer) {
        customer = await tx.mtmCustomer.create({
          data: {
            organizationId: auth.orgId,
            name: requestRecord.clinicName,
            objectType: "CLINIC",
            category: "B",
            status: "ACTIVE",
            address: requestRecord.address,
            notes: `Created from approved doctor request ${requestRecord.id}`,
          },
          select: { id: true },
        })
      }
      const names = splitContactName(requestRecord.displayName)
      const contact = await tx.mtmContact.create({
        data: {
          organizationId: auth.orgId,
          ...names,
          displayName: requestRecord.displayName,
          type: "DOCTOR",
          specialtyName: requestRecord.specialtyName,
          phone: requestRecord.phone,
          mobilePhone: requestRecord.phone,
          notes: requestRecord.notes,
          source: "FIELD_APPROVED",
          workplaces: {
            create: {
              organizationId: auth.orgId,
              customerId: customer.id,
              isPrimary: true,
              phone: requestRecord.phone,
              source: "FIELD_APPROVED",
              createdBy: auth.userId || null,
            },
          },
          agentAssignments: {
            create: {
              organizationId: auth.orgId,
              agentId: requestRecord.requestedByAgentId,
              role: "PRIMARY",
              source: "CONTACT_CREATE_APPROVAL",
              assignedBy: auth.userId || null,
              reason: "Approved new doctor request",
            },
          },
        },
        select: { id: true, displayName: true },
      })
      await tx.mtmContactCreateRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedContactId: contact.id,
          approvedCustomerId: customer.id,
          reviewedAt: new Date(),
        },
      })
      return { ...requestRecord, status: "APPROVED", approvedContact: contact, approvedCustomerId: customer.id }
    })
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof DecisionConflict) {
      return NextResponse.json({ error: error.message, code: error.code, duplicateCandidates: error.candidates }, { status: 409 })
    }
    console.error("[MTM/contact-create-requests/decision]", error)
    return NextResponse.json({ error: "Failed to decide request" }, { status: 500 })
  }
})
