import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { decimalToNumber, normalizeDealRow } from "@/lib/prisma-decimal"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { createDealCommand } from "@/lib/crm-commands/deal/create-deal"

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
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {
    const result = await createDealCommand(createRestActorContext({
      organizationId: orgId,
      userId: session?.userId,
      role: session?.role,
      requestId: req.headers.get("x-request-id"),
    }), body)
    return NextResponse.json({ success: true, data: result.entity }, { status: 201 })
  } catch (error) {
    if (error instanceof CrmCommandError) {
      if (error.status === 403) {
        return NextResponse.json(
          { error: "Forbidden", message: error.message, code: error.code },
          { status: error.status },
        )
      }
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[Deals POST]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
