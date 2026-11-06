import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import type { Prisma } from "@prisma/client"
import { getFieldPermissions, filterEntityFields, isFieldVisible } from "@/lib/field-filter"
import {
  LIST_IDS_MAX,
  LIST_VIEW_MAX_LIMIT,
  containsInsensitive,
  isListView,
  listPaging,
  listSearchTerm,
} from "@/lib/list-view"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { decimalToNumber, normalizeDealRow } from "@/lib/prisma-decimal"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { createDealCommand } from "@/lib/crm-commands/deal/create-deal"

/** What the deals screen's board and list show — and nothing else (`view=list`). */
const DEAL_LIST_SELECT = {
  id: true,
  name: true,
  meddpicc: true,
  valueAmount: true,
  currency: true,
  stage: true,
  pipelineId: true,
  assignedTo: true,
  probability: true,
  notes: true,
  expectedClose: true,
  createdAt: true,
  stageChangedAt: true,
  // The edit form opens from the row with these.
  companyId: true,
  contactId: true,
  campaignId: true,
  company: { select: { id: true, name: true } },
  _count: { select: { offers: true } },
} satisfies Prisma.DealSelect

/*
 * The MEDDPICC score lives in JSON and Postgres cannot sort by it without
 * parsing every row, so "meddpicc" comes back newest-first and the screen
 * orders what it has loaded — as it always did, on its first 200.
 */
const DEAL_LIST_SORTS: Record<string, Prisma.DealOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }],
  oldest: [{ createdAt: "asc" }],
  value_desc: [{ valueAmount: "desc" }],
  value_asc: [{ valueAmount: "asc" }],
  name: [{ name: "asc" }],
  probability: [{ probability: "desc" }],
  close_date: [{ expectedClose: { sort: "asc", nulls: "last" } }],
  meddpicc: [{ createdAt: "desc" }],
}

/** A sort by a column the role cannot see would leak its order. */
const DEAL_SORT_FIELD: Record<string, string> = {
  value_desc: "valueAmount",
  value_asc: "valueAmount",
  probability: "probability",
  close_date: "expectedClose",
}

export const GET = withRls(async (req, { orgId, session }) => {
  const role = session?.role || "admin"

  const { searchParams } = new URL(req.url)
  const listView = isListView(searchParams)
  const search = listSearchTerm(searchParams)
  const stage = searchParams.get("stage") || ""
  const hasOffer = searchParams.get("hasOffer")
  let page: number
  let limit: number
  let skip: number
  if (listView) {
    ;({ page, limit, skip } = listPaging(searchParams, { defaultLimit: 50, maxLimit: LIST_VIEW_MAX_LIMIT }))
  } else {
    page = parseInt(searchParams.get("page") || "1")
    limit = parseInt(searchParams.get("limit") || "50")
    skip = (page - 1) * limit
    // Cap raised 200 → 500 (2026-06-10): every deal-picker dropdown in the app
    // requests ?limit=500 (contract-form, from-template dialog, invoices edit,
    // pricing, project-form), so a 200 cap made all of them silently 400 and
    // render empty. 500 matches the companies/contacts list endpoints.
    if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1 || limit > 500) {
      return NextResponse.json({ error: "Invalid page or limit" }, { status: 400 })
    }
  }

  try {
    const companyId = searchParams.get("companyId")
    const pipelineId = searchParams.get("pipelineId")
    const fieldPerms = await getFieldPermissions(orgId, role, "deal")
    const visible = (field: string) => isFieldVisible(fieldPerms, role, field)

    // The screen searches what a card shows: the deal, its company, its notes
    // (notes only where the role may read them). Pickers keep the name-only search.
    const searchWhere = !search
      ? {}
      : listView
        ? {
            AND: [{
              OR: [
                { name: containsInsensitive(search) },
                { company: { name: containsInsensitive(search) } },
                ...(visible("notes") ? [{ notes: containsInsensitive(search) }] : []),
              ],
            }],
          }
        : { name: containsInsensitive(search) }

    let where: any = {
      organizationId: orgId,
      ...searchWhere,
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

    if (listView && searchParams.get("idsOnly") === "1") {
      const rows = await prisma.deal.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: LIST_IDS_MAX })
      return NextResponse.json({ success: true, data: { ids: rows.map((r: { id: string }) => r.id), capped: rows.length === LIST_IDS_MAX } })
    }

    const sortKey = searchParams.get("sort") || ""
    const sort = (DEAL_SORT_FIELD[sortKey] && !visible(DEAL_SORT_FIELD[sortKey]) ? undefined : DEAL_LIST_SORTS[sortKey])
      ?? DEAL_LIST_SORTS.newest

    const [deals, total] = await Promise.all([
      listView
        ? prisma.deal.findMany({
            where,
            skip,
            take: limit,
            // id last: equal values must not swap places between two pages.
            orderBy: [...sort, { id: "asc" }],
            select: DEAL_LIST_SELECT,
          })
        : prisma.deal.findMany({
            where,
            skip,
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

    const normalizedDeals = deals.map((d: any) => normalizeDealRow(d))
    const filteredDeals = normalizedDeals.map((d: any) => filterEntityFields(d, fieldPerms, role))

    // Every stage of the board — closed ones too — by currency, whatever the
    // screen's search and filters. The legend under the summary, the Won card
    // and the deal count in the heading read this, so they describe the whole
    // pipeline and not the page of deals that happens to be loaded.
    let stageTotals: { stage: string; currency: string; count: number; value: number | null }[] | undefined
    if (listView) {
      let boardWhere: any = { organizationId: orgId, ...(pipelineId ? { pipelineId } : {}) }
      boardWhere = await applyRecordFilter(orgId, session?.userId || "", role, "deal", boardWhere)
      const groups = await prisma.deal.groupBy({
        by: ["stage", "currency"],
        where: boardWhere,
        _count: { _all: true },
        _sum: { valueAmount: true },
      })
      const showValue = visible("valueAmount")
      stageTotals = groups.map((g: any) => ({
        stage: g.stage,
        currency: (g.currency || DEFAULT_CURRENCY).toUpperCase(),
        count: g._count._all,
        value: showValue ? Math.round(decimalToNumber(g._sum.valueAmount)) : null,
      }))
    }

    return NextResponse.json({
      success: true,
      data: { deals: filteredDeals, total, page, limit, pipelineSummary, ...(stageTotals ? { stageTotals } : {}) },
    })
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
