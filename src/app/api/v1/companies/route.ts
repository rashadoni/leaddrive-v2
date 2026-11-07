import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { createNotification } from "@/lib/notifications"
import { routeNewCompanyToTerritories } from "@/lib/territory-routing"
import { getFieldPermissions, filterEntityFields, filterWritableFields, isFieldVisible } from "@/lib/field-filter"
import {
  LIST_IDS_MAX,
  LIST_VIEW_MAX_LIMIT,
  containsInsensitive,
  isListView,
  listPaging,
  listSearchTerm,
} from "@/lib/list-view"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"
import { voenInput } from "@/lib/companies/az-taxpayer-registry"

const createCompanySchema = z.object({
  name: z.string().min(1).max(200),
  industry: z.string().max(100).optional(),
  website: z.string().url().optional().or(z.literal("")),
  phone: z.string().max(50).optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(["active", "inactive", "prospect"]).optional(),
  slaPolicyId: z.string().nullable().optional(),
  creditLimit: nonNegativeFinancialAmountSchema.nullable().optional(),
  creditCurrency: z.string().max(10).nullable().optional(),
  voen: z.string().max(40).nullable().optional(),
  director: z.string().max(200).nullable().optional(),
})

/** What a company card on the list screen shows — and nothing else (`view=list`). */
const COMPANY_LIST_SELECT = {
  id: true,
  name: true,
  industry: true,
  city: true,
  website: true,
  status: true,
  category: true,
  leadStatus: true,
  leadScore: true,
  leadTemperature: true,
  userCount: true,
  slaPolicy: { select: { id: true, name: true } },
  _count: { select: { contacts: true, deals: true } },
} satisfies Prisma.CompanySelect

/*
 * «Hot → Cold» sorts by the score, because that is what the card's HOT / WARM /
 * COLD badge is drawn from (≥ 70 / ≥ 40 / below). The separate, hand-set
 * `leadTemperature` column has no order Postgres can sort by without a CASE.
 */
const COMPANY_LIST_SORTS: Record<string, Prisma.CompanyOrderByWithRelationInput[]> = {
  name_asc: [{ name: "asc" }],
  name_desc: [{ name: "desc" }],
  hot_cold: [{ leadScore: "desc" }, { name: "asc" }],
  cold_hot: [{ leadScore: "asc" }, { name: "asc" }],
  score: [{ leadScore: "desc" }, { name: "asc" }],
  contacts: [{ contacts: { _count: "desc" } }, { name: "asc" }],
}

const COMPANY_STATUSES = new Set(["active", "inactive", "prospect"])

/** Pickers across the app ask for up to 500 companies; nothing asks for more. */
const LEGACY_MAX_LIMIT = 500

export const GET = withRlsAuth("companies", "read", async (req, auth) => {
  const { orgId, role, userId } = auth

  const { searchParams } = new URL(req.url)
  const listView = isListView(searchParams)
  const search = listSearchTerm(searchParams)
  const { page, limit, skip } = listPaging(searchParams, {
    defaultLimit: 50,
    maxLimit: listView ? LIST_VIEW_MAX_LIMIT : LEGACY_MAX_LIMIT,
  })
  const category = searchParams.get("category") // client, partner, prospect, all
  const status = searchParams.get("status") || ""
  if (status && !COMPANY_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  try {
    const categoryWhere = category && category !== "all" ? { category } : { category: { not: "partner" } }

    // The screen's tabs count every status of the chosen category, whatever
    // is typed in the search box — the same set the "All" tab shows.
    const tabsWhere = (await applyRecordFilter(orgId, userId, role, "company", {
      organizationId: orgId,
      ...categoryWhere,
    })) as Prisma.CompanyWhereInput

    let where: any = {
      organizationId: orgId,
      ...(search ? { name: containsInsensitive(search) } : {}),
      ...categoryWhere,
      ...(status ? { status } : {}),
    }

    // Apply record-level sharing rules
    where = await applyRecordFilter(orgId, userId, role, "company", where)

    if (listView && searchParams.get("idsOnly") === "1") {
      const rows = await prisma.company.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: LIST_IDS_MAX })
      return NextResponse.json({ success: true, data: { ids: rows.map((r) => r.id), capped: rows.length === LIST_IDS_MAX } })
    }

    // Field permissions decide the visible columns, and a sort by a hidden
    // score would leak its order — that sort falls back to the name.
    const fieldPerms = await getFieldPermissions(orgId, role, "company")

    if (listView) {
      const sortKey = searchParams.get("sort") || ""
      const scoreSort = sortKey === "hot_cold" || sortKey === "cold_hot" || sortKey === "score"
      const sort = (scoreSort && !isFieldVisible(fieldPerms, role, "leadScore") ? undefined : COMPANY_LIST_SORTS[sortKey])
        ?? COMPANY_LIST_SORTS.name_asc
      const [companies, total, byStatus] = await Promise.all([
        prisma.company.findMany({
          where,
          skip,
          take: limit,
          // id last: equal names must not swap places between two pages.
          orderBy: [...sort, { id: "asc" }],
          select: COMPANY_LIST_SELECT,
        }),
        prisma.company.count({ where }),
        prisma.company.groupBy({ by: ["status"], where: tabsWhere, _count: { _all: true } }),
      ])
      const statusCounts: Record<string, number> = {}
      for (const row of byStatus) statusCounts[row.status] = row._count._all
      const allCount = Object.values(statusCounts).reduce((n, c) => n + c, 0)
      return NextResponse.json({
        success: true,
        data: {
          companies: companies.map((c) => filterEntityFields(c, fieldPerms, role)),
          total,
          page,
          limit,
          search,
          statusCounts,
          allCount,
        },
      })
    }

    const baseWhere = { organizationId: orgId, category: { not: "partner" } }

    const [companies, total, agg] = await Promise.all([
      prisma.company.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: "asc" },
        include: {
          _count: { select: { contacts: true, deals: true, contracts: true } },
          slaPolicy: { select: { id: true, name: true, priority: true, resolutionHours: true } },
        },
      }),
      prisma.company.count({ where }),
      prisma.company.aggregate({
        where: baseWhere,
        _sum: { userCount: true },
        _count: true,
      }),
    ])

    // Apply field-level permissions
    const filteredCompanies = companies.map((c: any) => filterEntityFields(c, fieldPerms, role))

    const totalUsers = agg._sum.userCount || 0
    const totalContacts = await prisma.contact.count({ where: { organizationId: orgId } })

    return NextResponse.json({
      success: true,
      data: { companies: filteredCompanies, total, page, limit, search, totalUsers, totalContacts },
    })
  } catch (e) {
    console.error("Companies API error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("companies", "write", async (req, { orgId, role }) => {

  const body = await req.json()
  const parsed = createCompanySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const voen = voenInput(parsed.data.voen)
  if (!voen.ok) return NextResponse.json({ error: "VÖEN is ten digits", code: "INVALID_VOEN" }, { status: 400 })

  try {
    // Filter writable fields
    const fieldPerms = await getFieldPermissions(orgId, role, "company")
    const allowedData = filterWritableFields({ ...parsed.data, voen: voen.value, director: parsed.data.director?.trim() || null }, fieldPerms, role)

    const company = await prisma.company.create({
      data: { organizationId: orgId, ...allowedData },
    })
    logAudit(orgId, "create", "company", company.id, company.name)
    createNotification({
      organizationId: orgId,
      type: "info",
      title: "Новая компания",
      message: `Добавлена компания «${company.name}»`,
      entityType: "company",
      entityId: company.id,
    }).catch(() => {})
    // S4 auto-routing — notify reps of any territory whose rules match the
    // new company's profile (fire-and-forget; never blocks creation).
    routeNewCompanyToTerritories(prisma, {
      orgId,
      company: {
        id: company.id,
        name: company.name,
        country: company.country,
        industry: company.industry,
        employeeCount: company.employeeCount,
      },
    }).catch(() => {})
    return NextResponse.json({ success: true, data: company }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
