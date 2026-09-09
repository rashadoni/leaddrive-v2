import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { enrichComplaintInBackground } from "@/lib/complaint-ai"
import { resolveTicketCategoryForWrite } from "@/lib/ticketing/category-service"

const metaSchema = z.object({
  complaintType: z.enum(["complaint", "suggestion"]).default("complaint"),
  brand: z.string().max(200).optional().nullable(),
  productionArea: z.string().max(200).optional().nullable(),
  productCategory: z.string().max(200).optional().nullable(),
  complaintObject: z.string().max(300).optional().nullable(),
  complaintObjectDetail: z.string().max(300).optional().nullable(),
  responsibleDepartment: z.string().max(200).optional().nullable(),
  riskLevel: z.enum(["low", "medium", "high"]).optional().nullable(),
  externalRegistryNumber: z.number().int().positive().optional().nullable(),
})

export const POST = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = metaSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const d = parsed.data

  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, subject: true, complaintMeta: { select: { id: true } } },
    })
    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

    const complaintCategory = await resolveTicketCategoryForWrite(orgId, {
      category: "complaint",
      scope: "complaint",
    })

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.ticket.update({
        where: { id },
        data: { category: "complaint", categoryId: complaintCategory.categoryId },
      })
      if (ticket.complaintMeta) {
        await tx.complaintMeta.update({
          where: { ticketId: id },
          data: {
            complaintType: d.complaintType,
            brand: d.brand ?? null,
            productionArea: d.productionArea ?? null,
            productCategory: d.productCategory ?? null,
            complaintObject: d.complaintObject ?? null,
            complaintObjectDetail: d.complaintObjectDetail ?? null,
            responsibleDepartment: d.responsibleDepartment ?? null,
            riskLevel: d.riskLevel ?? null,
            externalRegistryNumber: d.externalRegistryNumber ?? null,
          },
        })
      } else {
        await tx.complaintMeta.create({
          data: {
            ticketId: id,
            organizationId: orgId,
            complaintType: d.complaintType,
            brand: d.brand ?? null,
            productionArea: d.productionArea ?? null,
            productCategory: d.productCategory ?? null,
            complaintObject: d.complaintObject ?? null,
            complaintObjectDetail: d.complaintObjectDetail ?? null,
            responsibleDepartment: d.responsibleDepartment ?? null,
            riskLevel: d.riskLevel ?? null,
            externalRegistryNumber: d.externalRegistryNumber ?? null,
          },
        })
      }
    })

    logAudit(orgId, "convert", "complaint", id, ticket.subject, { newValue: d })
    // Background AI enrichment only when user didn't fill risk/department
    if (!d.riskLevel || !d.responsibleDepartment) {
      enrichComplaintInBackground(id, orgId).catch(() => {})
    }

    const updated = await prisma.ticket.findFirst({
      where: { id, organizationId: orgId },
      include: { complaintMeta: true },
    })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("Ticket convert-to-complaint error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
