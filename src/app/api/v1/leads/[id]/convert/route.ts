import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

const convertSchema = z.object({
  dealTitle: z.string().min(1),
  dealStage: z.string().optional(),
  dealValue: nonNegativeFinancialAmountSchema.optional(),
  createCompany: z.boolean().optional(),
  pipelineId: z.string().optional(),
})

const OMNICHANNEL_LEAD_SOURCES = new Set([
  "facebook",
  "instagram",
  "tiktok",
  "telegram",
  "vkontakte",
  "vk",
  "whatsapp",
  "web-chat",
  "webchat",
])

function isOmnichannelLeadSource(source: string | null | undefined): boolean {
  return OMNICHANNEL_LEAD_SOURCES.has(
    (source || "").trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-"),
  )
}

export const POST = withRlsAuth("leads", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, role, userId } = auth
  const { id } = await params
  const body = await req.json()
  const parsed = convertSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const leadWhere = await applyRecordFilter(orgId, userId, role, "lead", {
      id,
      organizationId: orgId,
    })
    const lead = await prisma.lead.findFirst({ where: leadWhere })
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 })
    if (lead.status === "converted") return NextResponse.json({ error: "Lead already converted" }, { status: 400 })

    // ChannelMessage.leadId is the authoritative proof that a lead originated
    // in the omni-channel Inbox. The source fallback keeps older imported Inbox
    // leads (created before message-linking was introduced) on the same route.
    const linkedInboxMessage = await prisma.channelMessage.findFirst({
      where: { organizationId: orgId, leadId: lead.id },
      select: { id: true },
    })
    const isOmnichannelLead = Boolean(linkedInboxMessage) || isOmnichannelLeadSource(lead.source)

    // Omni-channel handoffs belong to the SMM sales category. This is enforced
    // server-side so a stale browser or a direct API call cannot silently put
    // the converted deal back into Default Sales.
    let pipeline = isOmnichannelLead
      ? await prisma.pipeline.findFirst({
          where: {
            organizationId: orgId,
            isActive: true,
            name: { equals: "SMM", mode: "insensitive" },
          },
          include: {
            stages: {
              where: { isActive: true, isWon: false, isLost: false },
              orderBy: { sortOrder: "asc" },
            },
          },
        })
      : null

    const selectedPipelineId = parsed.data.pipelineId || lead.pipelineId
    if (!pipeline && selectedPipelineId) {
      pipeline = await prisma.pipeline.findFirst({
        where: {
          id: selectedPipelineId,
          organizationId: orgId,
          isActive: true,
        },
        include: {
          stages: {
            where: { isActive: true, isWon: false, isLost: false },
            orderBy: { sortOrder: "asc" },
          },
        },
      })
      if (!pipeline) {
        return NextResponse.json({ error: "Invalid pipelineId" }, { status: 400 })
      }
    }

    if (!pipeline) {
      pipeline = await prisma.pipeline.findFirst({
        where: { organizationId: orgId, isDefault: true, isActive: true },
        include: {
          stages: {
            where: { isActive: true, isWon: false, isLost: false },
            orderBy: { sortOrder: "asc" },
          },
        },
      })
    }

    const requestedStage = parsed.data.dealStage
      ? pipeline?.stages.find((stage) => stage.name === parsed.data.dealStage)
      : null
    const conversionStage = requestedStage
      ?? pipeline?.stages[Math.min(1, Math.max(0, pipeline.stages.length - 1))]
      ?? null

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Create company if companyName exists and requested
      let companyId: string | undefined
      if (lead.companyName && parsed.data.createCompany !== false) {
        const company = await tx.company.findFirst({
          where: {
            organizationId: orgId,
            name: { equals: lead.companyName, mode: "insensitive" },
          },
          select: { id: true },
        }) ?? await tx.company.create({
          data: { organizationId: orgId, name: lead.companyName, status: "active" },
          select: { id: true },
        })
        companyId = company.id
      }

      // 2. Reuse an existing contact when the lead has an exact email or phone.
      // This keeps converted records visible under the original CRM customer.
      const existingContact = lead.email || lead.phone
        ? await tx.contact.findFirst({
            where: {
              organizationId: orgId,
              OR: [
                ...(lead.email ? [{ email: { equals: lead.email, mode: "insensitive" } }] : []),
                ...(lead.phone ? [{ phone: lead.phone }] : []),
              ],
            },
          })
        : null
      const contact = existingContact ?? await tx.contact.create({
        data: {
          organizationId: orgId,
          fullName: lead.contactName,
          email: lead.email || undefined,
          phone: lead.phone || undefined,
          source: lead.source || undefined,
          companyId: companyId,
        },
      })
      if (existingContact && companyId && !existingContact.companyId) {
        await tx.contact.update({
          where: { id: existingContact.id },
          data: { companyId },
        })
      }

      // 3. Create deal
      const deal = await tx.deal.create({
        data: {
          organizationId: orgId,
          name: parsed.data.dealTitle,
          stage: conversionStage?.name || parsed.data.dealStage || "QUALIFIED",
          valueAmount: parsed.data.dealValue ?? lead.estimatedValue ?? 0,
          contactId: contact.id,
          companyId: companyId,
          pipelineId: pipeline?.id ?? null,
          probability: conversionStage?.probability ?? 25,
          customerNeed: lead.interest || lead.notes || null,
          assignedTo: lead.assignedTo || userId || null,
        },
      })

      // 4. Update lead status to converted
      await tx.lead.update({
        where: { id },
        data: {
          status: "converted",
          convertedAt: new Date(),
        },
      })

      return {
        company: companyId ? { id: companyId } : null,
        contact,
        deal,
        pipeline: pipeline ? { id: pipeline.id, name: pipeline.name } : null,
      }
    })

    // Fire surveys configured for the lead-converted trigger.
    if (result.contact?.id) {
      const { triggerSurveysOnLeadConverted } = await import("@/lib/survey-triggers")
      triggerSurveysOnLeadConverted(orgId, result.contact.id).catch(e =>
        console.error("[leads/convert] survey trigger failed:", e),
      )
    }

    return NextResponse.json({ success: true, data: result }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
