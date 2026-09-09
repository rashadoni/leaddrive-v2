import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { mobileCommitmentStatus } from "@/lib/mtm/mobile-commitment"

const mobileCommitmentSelect = {
  id: true,
  clientCommitmentId: true,
  visitId: true,
  customerId: true,
  contactId: true,
  productExternalId: true,
  productName: true,
  brandExternalId: true,
  brandName: true,
  promisedQuantity: true,
  unit: true,
  dueAt: true,
  note: true,
  submittedAt: true,
  customer: { select: { id: true, name: true, objectType: true, address: true, city: true } },
  contact: { select: { id: true, displayName: true, type: true, specialtyName: true } },
  evidencePhoto: { select: { id: true, url: true, thumbnailUrl: true, status: true } },
  fulfillment: {
    select: {
      id: true,
      clientFulfillmentId: true,
      outcome: true,
      actualQuantity: true,
      varianceQuantity: true,
      note: true,
      fulfilledAt: true,
      evidencePhoto: { select: { id: true, url: true, thumbnailUrl: true, status: true } },
    },
  },
} satisfies Prisma.MtmCommitmentSelect

type MobileCommitmentRow = Prisma.MtmCommitmentGetPayload<{ select: typeof mobileCommitmentSelect }>

export const GET = withMobileRls(async (req, auth) => {
  const { searchParams } = new URL(req.url)
  const scope = searchParams.get("scope") === "all" ? "all" : "open"
  const visitId = searchParams.get("visitId")?.trim() || null
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit")) || 100))
  if (visitId && visitId.length > 128) {
    return NextResponse.json({ error: "Invalid visitId" }, { status: 400 })
  }

  const commitments = await prisma.mtmCommitment.findMany({
    where: {
      organizationId: auth.orgId,
      agentId: auth.agentId,
      ...(visitId ? { visitId } : {}),
      ...(scope === "open" ? { fulfillment: { is: null } } : {}),
    },
    orderBy: [{ dueAt: "asc" }, { submittedAt: "desc" }],
    take: limit,
    select: mobileCommitmentSelect,
  })

  const now = new Date()
  return NextResponse.json({
    success: true,
    data: {
      commitments: commitments.map((commitment: MobileCommitmentRow) => ({
        ...commitment,
        promisedQuantity: Number(commitment.promisedQuantity),
        status: mobileCommitmentStatus({
          dueAt: commitment.dueAt,
          fulfillment: commitment.fulfillment,
          now,
        }),
        fulfillment: commitment.fulfillment
          ? {
              ...commitment.fulfillment,
              actualQuantity: Number(commitment.fulfillment.actualQuantity),
              varianceQuantity: Number(commitment.fulfillment.varianceQuantity),
            }
          : null,
      })),
      capabilities: { create: true, fulfillOwn: true },
    },
  })
})
