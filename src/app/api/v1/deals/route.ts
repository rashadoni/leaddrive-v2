import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields, filterWritableFields } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { trackContactEvent } from "@/lib/contact-events"
import { sendSlackNotification, formatDealNotification } from "@/lib/slack"
import { decimalToNumber, normalizeDealRow } from "@/lib/prisma-decimal"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"

const createDealSchema = z.object({
  name: z.string().min(1).max(200),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  campaignId: z.string().optional(),
  stage: z.string().optional(),
  pipelineId: z.string().optional(),
  valueAmount: z.number().min(0).max(999999999).optional(),
  currency: z.string().max(5).optional(),
  probability: z.number().min(0).max(100).optional(),
  expectedClose: z.string().optional(),
  assignedTo: z.string().optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string()).optional(),
})

export const GET = withRls(async (req, { orgId, session }) => {
  const role = session?.role || "admin"

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const stage = searchParams.get("stage") || ""
  const hasOffer = searchParams.get("hasOffer")
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")
  // Cap raised 200 → 500 (2026-06-10): every deal-picker dropdown in the app
  // requests ?limit=500 (contract-form, from-template dialog, invoices edit,
  // pricing, project-form), so a 200 cap made all of them silently 400 and
  // render empty. 500 matches the companies/contacts list endpoints.
  if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1 || limit > 500) {
    return NextResponse.json({ error: "Invalid page or limit" }, { status: 400 })
  }

  try {
    const companyId = searchParams.get("companyId")
    const pipelineId = searchParams.get("pipelineId")
    let where: any = {
      organizationId: orgId,
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
      ...(stage ? { stage } : {}),
      ...(companyId ? { companyId } : {}),
      ...(pipelineId ? { pipelineId } : {}),
      ...(hasOffer === "true"
        ? { offers: { some: {} } }
        : hasOffer === "false"
          ? { offers: { none: {} } }
          : {}),
    }
    where = await applyRecordFilter(orgId, session?.userId || "", role, "deal", where)

    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          company: { select: { id: true, name: true } },
          campaign: { select: { id: true, name: true } },
          _count: { select: { offers: true } },
        },
      }),
      prisma.deal.count({ where }),
    ])

    // Weighted pipeline summary — computed from every deal visible to this
    // user, not just the paginated page. This keeps seller totals aligned with
    // the cards they are allowed to open.
    /*
     * Открытая воронка = не закрытая ни в одном из написаний. С двумя литералами
     * сумма «В воронке» над списком включала уже выигранную сделку.
     */
    const { closedStages } = await orgStageVocabulary(orgId)
    let activeDealsWhere: any = {
      organizationId: orgId,
      stage: { notIn: closedStages },
      ...(pipelineId ? { pipelineId } : {}),
    }
    activeDealsWhere = await applyRecordFilter(
      orgId,
      session?.userId || "",
      role,
      "deal",
      activeDealsWhere,
    )
    const allActiveDeals = await prisma.deal.findMany({
      where: activeDealsWhere,
      select: { stage: true, valueAmount: true, probability: true, currency: true },
    })
    const totalPipeline = allActiveDeals.reduce((s: number, d: any) => s + decimalToNumber(d.valueAmount), 0)
    const weightedPipeline = allActiveDeals.reduce((s: number, d: any) => s + decimalToNumber(d.valueAmount) * ((d.probability || 0) / 100), 0)

    // Group by stage
    const stageMap: Record<string, { count: number; value: number; weighted: number }> = {}
    for (const d of allActiveDeals) {
      if (!stageMap[d.stage]) stageMap[d.stage] = { count: 0, value: 0, weighted: 0 }
      stageMap[d.stage].count++
      const v = decimalToNumber(d.valueAmount)
      stageMap[d.stage].value += v
      stageMap[d.stage].weighted += v * ((d.probability || 0) / 100)
    }

    // Same open deals, grouped by the currency they are actually denominated
    // in. `total` above adds every valueAmount regardless of currency and the
    // screen then prints one symbol on the result, so on a mixed board that
    // number is not money in any currency. The client leads with the largest
    // bucket and names the rest; see `src/lib/deal-money.ts` for why we group
    // instead of converting.
    const currencyMap: Record<string, { count: number; value: number; weighted: number }> = {}
    for (const d of allActiveDeals) {
      const code = (d.currency || DEFAULT_CURRENCY).toUpperCase()
      if (!currencyMap[code]) currencyMap[code] = { count: 0, value: 0, weighted: 0 }
      const v = decimalToNumber(d.valueAmount)
      currencyMap[code].count++
      currencyMap[code].value += v
      currencyMap[code].weighted += v * ((d.probability || 0) / 100)
    }

    const pipelineSummary = {
      total: totalPipeline,
      weighted: Math.round(weightedPipeline),
      byStage: Object.entries(stageMap).map(([name, data]) => ({
        name,
        ...data,
        weighted: Math.round(data.weighted),
      })),
      byCurrency: Object.entries(currencyMap)
        .map(([currency, data]) => ({
          currency,
          count: data.count,
          value: Math.round(data.value),
          weighted: Math.round(data.weighted),
        }))
        .sort((a, b) => b.value - a.value || b.count - a.count || a.currency.localeCompare(b.currency)),
    }

    const fieldPerms = await getFieldPermissions(orgId, role, "deal")
    const normalizedDeals = deals.map((d: any) => normalizeDealRow(d))
    const filteredDeals = normalizedDeals.map((d: any) => filterEntityFields(d, fieldPerms, role))

    return NextResponse.json({ success: true, data: { deals: filteredDeals, total, page, limit, pipelineSummary } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId, session }) => {
  const role = session?.role || "admin"

  const body = await req.json()
  const fieldPerms = await getFieldPermissions(orgId, role, "deal")
  const filtered = filterWritableFields(body, fieldPerms, role)
  const parsed = createDealSchema.safeParse(filtered)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    // Org-ownership guard: Deal.contactId/companyId have NO DB foreign key, so
    // a forged POST with a cross-tenant id would write a dangling reference
    // under the wrong org. Validate both belong to this org before create.
    if (parsed.data.contactId) {
      const c = await prisma.contact.findFirst({
        where: { id: parsed.data.contactId, organizationId: orgId },
        select: { id: true },
      })
      if (!c) return NextResponse.json({ error: "Invalid contactId" }, { status: 400 })
    }
    if (parsed.data.companyId) {
      const co = await prisma.company.findFirst({
        where: { id: parsed.data.companyId, organizationId: orgId },
        select: { id: true },
      })
      if (!co) return NextResponse.json({ error: "Invalid companyId" }, { status: 400 })
    }

    // Resolve pipeline/category: a supplied id must belong to this tenant.
    let pipelineId = parsed.data.pipelineId || null
    if (pipelineId) {
      const selectedPipeline = await prisma.pipeline.findFirst({
        where: { id: pipelineId, organizationId: orgId, isActive: true },
        select: { id: true },
      })
      if (!selectedPipeline) {
        return NextResponse.json({ error: "Invalid pipelineId" }, { status: 400 })
      }
    } else {
      const defaultPipeline = await prisma.pipeline.findFirst({
        where: { organizationId: orgId, isDefault: true, isActive: true },
        select: { id: true },
      })
      pipelineId = defaultPipeline?.id || null
    }

    // Get probability from pipeline stage if not explicitly set
    let probability = parsed.data.probability
    if (probability === undefined && pipelineId) {
      const stageData = await prisma.pipelineStage.findFirst({
        where: { pipelineId, name: parsed.data.stage || "LEAD" },
        select: { probability: true },
      })
      probability = stageData?.probability ?? 10
    }

    const deal = await prisma.deal.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        companyId: parsed.data.companyId || null,
        contactId: parsed.data.contactId || null,
        campaignId: parsed.data.campaignId || null,
        pipelineId,
        stage: parsed.data.stage || "LEAD",
        valueAmount: parsed.data.valueAmount || 0,
        currency: parsed.data.currency || DEFAULT_CURRENCY,
        probability: probability ?? 10,
        expectedClose: parsed.data.expectedClose ? new Date(parsed.data.expectedClose) : null,
        // A newly created deal must be visible to its creator immediately.
        // Explicit assignment still wins; otherwise make the creator owner.
        assignedTo: parsed.data.assignedTo || session?.userId || null,
        notes: parsed.data.notes,
      },
      include: {
        company: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
      },
    })
    const dealValueNum = decimalToNumber(deal.valueAmount)
    logAudit(orgId, "create", "deal", deal.id, deal.name)
    executeWorkflows(orgId, "deal", "created", deal).catch(() => {})
    createNotification({
      organizationId: orgId,
      type: "success",
      title: "Новая сделка",
      message: `Создана сделка «${deal.name}»${dealValueNum ? ` на ${dealValueNum} ${deal.currency}` : ""}`,
      entityType: "deal",
      entityId: deal.id,
    }).catch(() => {})
    fireWebhooks(orgId, "deal.created", { id: deal.id, name: deal.name, valueAmount: dealValueNum, stage: deal.stage }).catch(() => {})
    if (deal.contactId) trackContactEvent(orgId, deal.contactId, "deal_created", { dealId: deal.id, name: deal.name }).catch(() => {})
    // Auto Slack notification
    prisma.channelConfig.findMany({ where: { organizationId: orgId, channelType: "slack", isActive: true } }).then((configs: any) => {
      const msg = formatDealNotification({ name: deal.name, value: dealValueNum, stage: deal.stage })
      for (const cfg of configs) {
        if (cfg.webhookUrl) sendSlackNotification(cfg.webhookUrl, msg).catch(() => {})
      }
    }).catch(() => {})
    return NextResponse.json({ success: true, data: { ...deal, valueAmount: dealValueNum } }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
