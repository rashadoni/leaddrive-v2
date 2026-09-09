import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields, filterWritableFields } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { applyLeadAssignmentRules } from "@/lib/lead-assignment"
import { fireWebhooks } from "@/lib/webhooks"
import { refreshProfileForSource } from "@/lib/unified-profile/profile-builder"
import { findSalesPipeline } from "@/lib/pipeline-routing"
import { isPlausibleLeadPhone } from "@/lib/inbox/customer-phone"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"
import { scoreLeadNow } from "@/lib/ai/lead-scoring"

const optionalPhone = z.string().max(50).refine(
  (value) => !value.trim() || isPlausibleLeadPhone(value),
  "Phone number must contain at least 10 digits and be valid",
)

const createLeadSchema = z.object({
  contactName: z.string().min(1).max(200),
  companyName: z.string().max(200).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: optionalPhone.optional(),
  phoneWhatsApp: optionalPhone.optional(),
  telegramHandle: z.string().max(100).optional(),
  source: z.string().max(50).optional(),
  sourceDetail: z.string().max(200).optional(),
  sourceProfileUrl: z.string().url().max(1000).optional().or(z.literal("")),
  interest: z.string().max(2000).optional(),
  brand: z.string().max(100).optional(),
  category: z.string().max(50).optional(),
  status: z.enum(["new", "contacted", "qualified", "converted", "lost"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  estimatedValue: nonNegativeFinancialAmountSchema.optional(),
  assignedTo: z.string().min(1).optional(),
  pipelineId: z.string().min(1).optional(),
  notes: z.string().max(5000).optional(),
})

export const GET = withRlsAuth("leads", "read", async (req, auth) => {
  const { orgId, role, userId } = auth

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")

  const status = searchParams.get("status")
  const includeConverted = searchParams.get("includeConverted") === "true"

  try {
    let where: Prisma.LeadWhereInput = {
      organizationId: orgId,
      ...(search ? {
        OR: [
          { contactName: { contains: search, mode: "insensitive" as const } },
          { companyName: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      } : {}),
      ...(status ? { status } : includeConverted ? {} : { status: { not: "converted" } }),
    }

    where = await applyRecordFilter(orgId, userId, role, "lead", where)

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.lead.count({ where }),
    ])

    const fieldPerms = await getFieldPermissions(orgId, role, "lead")
    const assigneeIds = [...new Set(leads.map((lead) => lead.assignedTo).filter((id): id is string => Boolean(id)))]
    const assignees = assigneeIds.length
      ? await prisma.user.findMany({
          where: { id: { in: assigneeIds }, organizationId: orgId },
          select: { id: true, name: true, email: true },
        })
      : []
    const assigneeById = new Map(assignees.map((user) => [user.id, user.name || user.email]))
    const filteredLeads = leads.map((lead) => ({
      ...filterEntityFields(lead, fieldPerms, role),
      assignedToName: lead.assignedTo ? assigneeById.get(lead.assignedTo) ?? null : null,
    }))

    return NextResponse.json({ success: true, data: { leads: filteredLeads, total, page, limit } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("leads", "write", async (req, auth) => {
  const { orgId, role, userId } = auth
  const body = await req.json()
  const parsed = createLeadSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const writableData = filterWritableFields(parsed.data, await getFieldPermissions(orgId, role, "lead"), role)
    let assignedTo = userId || null
    if (parsed.data.assignedTo) {
      const seller = await prisma.user.findFirst({
        where: {
          id: parsed.data.assignedTo,
          organizationId: orgId,
          role: "sales",
          isActive: true,
        },
        select: { id: true },
      })
      if (!seller) {
        return NextResponse.json(
          { error: "Selected seller is inactive or does not belong to this organization" },
          { status: 400 },
        )
      }
      assignedTo = seller.id
    }

    const activePipelines = await prisma.pipeline.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, isDefault: true },
    })
    let pipelineId = parsed.data.pipelineId
    if (pipelineId && !activePipelines.some((pipeline) => pipeline.id === pipelineId)) {
      return NextResponse.json({ error: "Invalid pipelineId" }, { status: 400 })
    }
    if (!pipelineId && role === "sales") {
      pipelineId = findSalesPipeline(activePipelines)?.id
    }

    const lead = await prisma.lead.create({
      data: {
        organizationId: orgId,
        contactName: writableData.contactName ?? parsed.data.contactName,
        companyName: writableData.companyName ?? parsed.data.companyName,
        email: writableData.email || parsed.data.email || null,
        phone: writableData.phone ?? parsed.data.phone,
        phoneWhatsApp: writableData.phoneWhatsApp ?? parsed.data.phoneWhatsApp,
        telegramHandle: writableData.telegramHandle ?? parsed.data.telegramHandle,
        source: writableData.source ?? parsed.data.source,
        sourceDetail: writableData.sourceDetail ?? parsed.data.sourceDetail,
        sourceProfileUrl: writableData.sourceProfileUrl || parsed.data.sourceProfileUrl || null,
        interest: writableData.interest ?? parsed.data.interest,
        brand: writableData.brand ?? parsed.data.brand,
        category: writableData.category ?? parsed.data.category,
        status: writableData.status || parsed.data.status || "new",
        priority: writableData.priority || parsed.data.priority || "medium",
        estimatedValue: writableData.estimatedValue ?? parsed.data.estimatedValue,
        notes: writableData.notes ?? parsed.data.notes,
        // Leads have no `createdBy` column. Assign a manually created lead to
        // its creator so record-level sharing immediately includes it.
        assignedTo,
        pipelineId: pipelineId ?? null,
      },
    })
    // Scored the moment it exists. A lead created between two cron passes used
    // to render as "0/100 (F)" — the product telling a salesperson the customer
    // is worthless, when in fact nothing had been calculated at all.
    await scoreLeadNow(orgId, lead.id)
    logAudit(orgId, "create", "lead", lead.id, lead.contactName)
    // An explicit human choice must win over automatic round-robin rules.
    if (!parsed.data.assignedTo && role !== "sales") applyLeadAssignmentRules(orgId, lead).catch(() => {})
    executeWorkflows(orgId, "lead", "created", lead).catch(() => {})
    // CDP: build/refresh this lead's unified profile immediately (don't wait for cron).
    refreshProfileForSource(prisma, orgId, "lead", lead.id).catch((e) =>
      console.error("[cdp-hook] lead-create profile refresh failed", e),
    )
    createNotification({
      organizationId: orgId,
      type: "info",
      title: "Новый лид",
      message: `Создан лид «${lead.contactName}»${lead.companyName ? ` (${lead.companyName})` : ""}`,
      entityType: "lead",
      entityId: lead.id,
    }).catch(() => {})
    // The org-wide notice above tells everyone a lead exists; it tells nobody
    // that it is THEIRS. A handover only counts when it reaches the person
    // holding it — including when they are not in the CRM.
    if (lead.assignedTo && lead.assignedTo !== auth.userId) {
      createNotification({
        organizationId: orgId,
        userId: lead.assignedTo,
        type: "info",
        title: "Вам назначен лид",
        message: `«${lead.contactName}»${lead.companyName ? ` (${lead.companyName})` : ""}`,
        entityType: "lead",
        entityId: lead.id,
        push: true,
        email: true,
      }).catch(() => {})
    }
    fireWebhooks(orgId, "lead.created", { id: lead.id, contactName: lead.contactName, companyName: lead.companyName }).catch(() => {})
    return NextResponse.json({ success: true, data: lead }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
