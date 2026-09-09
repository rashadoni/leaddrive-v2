import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields, filterWritableFields } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { executeWorkflows } from "@/lib/workflow-engine"
import { fireWebhooks } from "@/lib/webhooks"
import { createNotification } from "@/lib/notifications"
import { clearDeletedMentionRefs } from "@/lib/social/mention-refs"
import { clearTaskRelations } from "@/lib/tasks/clear-task-relations"
import {
  LEAD_REPORTED_CUSTOMER_STAGES,
  normalizeLeadReportedCustomerStages,
  setLeadReportedCustomerStages,
  validateLeadReportedCustomerStages,
} from "@/lib/inbox/customer-stage"
import { isPlausibleLeadPhone } from "@/lib/inbox/customer-phone"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"
import { scoreLeadNow } from "@/lib/ai/lead-scoring"

const optionalPhone = z.string().refine(
  (value) => !value.trim() || isPlausibleLeadPhone(value),
  "Phone number must contain at least 10 digits and be valid",
)

const updateLeadSchema = z.object({
  contactName: z.string().min(1).max(255).optional(),
  companyName: z.string().nullable().optional(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  phone: optionalPhone.nullable().optional(),
  phoneWhatsApp: optionalPhone.nullable().optional(),
  telegramHandle: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  sourceDetail: z.string().max(200).nullable().optional(),
  sourceProfileUrl: z.string().url().max(1000).nullable().optional().or(z.literal("")),
  interest: z.string().max(2000).nullable().optional(),
  brand: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  score: z.number().int().min(0).max(100).optional(),
  assignedTo: z.string().nullable().optional(),
  pipelineId: z.string().nullable().optional(),
  estimatedValue: nonNegativeFinancialAmountSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  customerStage: z.enum(LEAD_REPORTED_CUSTOMER_STAGES).optional(),
  salesCallOutcomes: z.array(z.enum(LEAD_REPORTED_CUSTOMER_STAGES)).max(7).optional(),
  customerStageReason: z.string().max(2000).nullable().optional(),
}).superRefine((value, ctx) => {
  const outcomes = value.salesCallOutcomes
    ?? (value.customerStage ? [value.customerStage] : undefined)
  if (outcomes && !value.customerStageReason?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["customerStageReason"],
      message: "A short lead qualification note is required",
    })
  }
  if (outcomes && !validateLeadReportedCustomerStages(normalizeLeadReportedCustomerStages(outcomes))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["salesCallOutcomes"],
      message: "Choose at least one compatible qualification signal",
    })
  }
})

export const GET = withRlsAuth("leads", "read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, role, userId } = auth
  const { id } = await params

  try {
    const where = await applyRecordFilter(orgId, userId, role, "lead", {
      id,
      organizationId: orgId,
    })
    const lead = await prisma.lead.findFirst({
      where,
      include: { pipeline: { select: { name: true } } },
    })
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const assignee = lead.assignedTo
      ? await prisma.user.findFirst({
          where: { id: lead.assignedTo, organizationId: orgId },
          select: { name: true, email: true },
        })
      : null
    const fieldPerms = await getFieldPermissions(orgId, role, "lead")
    const filteredLead = {
      ...filterEntityFields(lead, fieldPerms, role),
      assignedToName: assignee?.name || assignee?.email || null,
    }
    if (!Object.prototype.hasOwnProperty.call(filteredLead, "customerStage")) {
      delete filteredLead.salesCallOutcomes
    }
    return NextResponse.json({ success: true, data: filteredLead })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRlsAuth("leads", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, role, userId } = auth
  const { id } = await params
  const body = await req.json()
  const parsed = updateLeadSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const visibleWhere = await applyRecordFilter(orgId, userId, role, "lead", {
      id,
      organizationId: orgId,
    })
    const visibleLead = await prisma.lead.findFirst({
      where: visibleWhere,
      select: { id: true },
    })
    if (!visibleLead) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const fieldPerms = await getFieldPermissions(orgId, role, "lead")
    const writableData = filterWritableFields(parsed.data, fieldPerms, role)
    if (parsed.data.pipelineId) {
      const pipeline = await prisma.pipeline.findFirst({
        where: {
          id: parsed.data.pipelineId,
          organizationId: orgId,
          isActive: true,
        },
        select: { id: true },
      })
      if (!pipeline) {
        return NextResponse.json({ error: "Invalid pipelineId" }, { status: 400 })
      }
    }
    const requestedOutcomes = parsed.data.salesCallOutcomes
      ?? (parsed.data.customerStage ? [parsed.data.customerStage] : undefined)
    const outcomesWritable = requestedOutcomes !== undefined
      && Object.prototype.hasOwnProperty.call(
        filterWritableFields({ customerStage: requestedOutcomes[0] }, fieldPerms, role),
        "customerStage",
      )
    const regularWritableData = { ...writableData }
    delete regularWritableData.customerStage
    delete regularWritableData.salesCallOutcomes
    delete regularWritableData.customerStageReason
    if (Object.prototype.hasOwnProperty.call(parsed.data, "pipelineId")) {
      regularWritableData.pipelineId = parsed.data.pipelineId
    }
    let updatedCount = 0
    if (Object.keys(regularWritableData).length > 0) {
      const result = await prisma.lead.updateMany({
        where: visibleWhere,
        data: regularWritableData,
      })
      updatedCount = result.count
      if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    let conversationsUpdated = 0
    if (outcomesWritable && requestedOutcomes) {
      try {
        const stageResult = await setLeadReportedCustomerStages(prisma, {
          organizationId: orgId,
          leadId: id,
          stages: normalizeLeadReportedCustomerStages(requestedOutcomes),
          changedBy: userId,
          canOverrideAssignee: ["admin", "manager", "superadmin"].includes(role),
          reason: parsed.data.customerStageReason,
        })
        conversationsUpdated = stageResult.conversationsUpdated
        updatedCount = 1
      } catch (error) {
        if (error instanceof Error && error.message === "phone-required") {
          return NextResponse.json({
            error: "Phone number is required for the potential customer stage",
            code: "phone_required",
          }, { status: 400 })
        }
        if (error instanceof Error && error.message === "lead-not-found") {
          return NextResponse.json({ error: "Not found" }, { status: 404 })
        }
        if (error instanceof Error && error.message === "sales-assignee-required") {
          return NextResponse.json({
            error: "Only the assigned salesperson can update the lead qualification",
            code: "sales_assignee_required",
          }, { status: 403 })
        }
        if (error instanceof Error && error.message === "conflicting-call-outcomes") {
          return NextResponse.json({
            error: "Choose at least one compatible qualification signal",
            code: "conflicting_call_outcomes",
          }, { status: 400 })
        }
        throw error
      }
    }
    if (updatedCount === 0) return NextResponse.json({ error: "No writable fields" }, { status: 400 })
    // The score is an opinion about this lead, and the lead just changed —
    // most importantly when the change IS the salesperson's qualification, which
    // is the strongest signal the model has. Awaited rather than fired and
    // forgotten so that the record returned below already carries the new
    // number instead of the one it is replacing.
    await scoreLeadNow(orgId, id)
    const updated = await prisma.lead.findFirst({ where: { id, organizationId: orgId } })
    logAudit(orgId, "update", "lead", id, updated?.contactName || "", { newValue: parsed.data })
    if (updated) {
      const triggerEvent = parsed.data.status ? "status_changed" : "updated"
      executeWorkflows(orgId, "lead", triggerEvent, updated).catch(() => {})

      // Handed to somebody new. Same reasoning as on creation: the person now
      // responsible has to hear it where they are, not the next time they open
      // the CRM.
      if (
        Object.prototype.hasOwnProperty.call(regularWritableData, "assignedTo")
        && updated.assignedTo
        && updated.assignedTo !== auth.userId
      ) {
        createNotification({
          organizationId: orgId,
          userId: updated.assignedTo,
          type: "info",
          title: "Вам назначен лид",
          message: `«${updated.contactName}»${updated.companyName ? ` (${updated.companyName})` : ""}`,
          entityType: "lead",
          entityId: id,
          push: true,
          email: true,
        }).catch(() => {})
      }

      if (parsed.data.status) {
        createNotification({
          organizationId: orgId,
          type: parsed.data.status === "converted" ? "success" : parsed.data.status === "lost" ? "warning" : "info",
          title: parsed.data.status === "converted" ? "Лид конвертирован!" : "Смена статуса лида",
          message: `Лид «${updated.contactName}»: статус → ${parsed.data.status}`,
          entityType: "lead",
          entityId: id,
        }).catch(() => {})
      }
    }
    if (updated) {
      fireWebhooks(orgId, "lead.updated", { id: updated.id, contactName: updated.contactName }).catch(() => {})
    }
    return NextResponse.json({
      success: true,
      data: updated,
      meta: { inboxConversationsUpdated: conversationsUpdated },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// PATCH = partial-update alias of PUT (inline-edit consumers expect PATCH verb).
// Both do partial updates — only fields present in the body are written.
export const PATCH = PUT

export const DELETE = withRlsAuth("leads", "delete", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, role, userId } = auth
  const { id } = await params

  try {
    const where = await applyRecordFilter(orgId, userId, role, "lead", {
      id,
      organizationId: orgId,
    })
    const existing = await prisma.lead.findFirst({ where, select: { contactName: true } })
    const result = await prisma.lead.deleteMany({ where })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    logAudit(orgId, "delete", "lead", id, existing?.contactName || "")
    fireWebhooks(orgId, "lead.deleted", { id, contactName: existing?.contactName }).catch(() => {})
    // Drop any social-mention back-reference so Social Monitoring stops showing
    // "view lead" for the now-deleted lead (and the row becomes convertible again).
    await clearDeletedMentionRefs(orgId, "leadId", [id])
    // Null out tasks that linked to this now-deleted lead (no FK → not auto-nulled).
    await clearTaskRelations(orgId, "lead", id)
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
