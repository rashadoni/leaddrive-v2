import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { normalizeContractRow } from "@/lib/prisma-decimal"
import { CONTRACT_STATUSES } from "@/lib/contract-lifecycle/types"
import { upsertRenewalAlerts } from "@/lib/contract-lifecycle/upsert-renewal-alerts"
import { withRlsAuth } from "@/lib/with-rls"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

const createContractSchema = z.object({
  contractNumber: z.string().min(1).max(100),
  title: z.string().min(1).max(255),
  companyId: z.string().optional(),
  dealId: z.string().optional(),
  contactId: z.string().optional(),
  type: z.string().optional(),
  status: z.literal("draft").optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  valueAmount: nonNegativeFinancialAmountSchema.optional(),
  currency: z.string().optional(),
  notes: z.string().optional(),
})

export const GET = withRlsAuth("contracts", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")
  const status = searchParams.get("status")
  const companyId = searchParams.get("companyId")
  const type = searchParams.get("type") || undefined
  const sortBy = searchParams.get("sortBy") || "date_desc"

  if (status && !(CONTRACT_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json(
      { error: `Invalid contract status filter "${status}"`, code: "INVALID_CONTRACT_STATUS" },
      { status: 400 },
    )
  }

  // tagIds: comma-separated list of ContractTag ids
  const tagIdsRaw = searchParams.get("tagIds")
  const tagIds = tagIdsRaw ? tagIdsRaw.split(",").filter(Boolean) : []

  // hasDeviations: "true" → contracts with ≥1 open (flagged) deviation
  const hasDeviationsRaw = searchParams.get("hasDeviations")
  const hasDeviations = hasDeviationsRaw === "true"

  // value range — ignore if not valid numbers
  const valueMinRaw = searchParams.get("valueMin")
  const valueMaxRaw = searchParams.get("valueMax")
  const valueMin = valueMinRaw && !isNaN(Number(valueMinRaw)) ? Number(valueMinRaw) : undefined
  const valueMax = valueMaxRaw && !isNaN(Number(valueMaxRaw)) ? Number(valueMaxRaw) : undefined

  // date range helpers — ignore invalid dates
  function parseDate(raw: string | null): Date | undefined {
    if (!raw) return undefined
    const d = new Date(raw)
    return isNaN(d.getTime()) ? undefined : d
  }
  const startFrom = parseDate(searchParams.get("startFrom"))
  const startTo = parseDate(searchParams.get("startTo"))
  const endFrom = parseDate(searchParams.get("endFrom"))
  const endTo = parseDate(searchParams.get("endTo"))

  // Sort map
  const orderBy = (() => {
    switch (sortBy) {
      case "date_asc": return { createdAt: "asc" as const }
      case "value_desc": return { valueAmount: "desc" as const }
      case "value_asc": return { valueAmount: "asc" as const }
      case "expiry": return { endDate: "asc" as const }
      case "company": return { company: { name: "asc" as const } }
      default: return { createdAt: "desc" as const } // date_desc
    }
  })()

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      organizationId: orgId,
      // Full-text: OR across title, contractNumber, notes, renderedBody, company.name
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { contractNumber: { contains: search, mode: "insensitive" } },
              { notes: { contains: search, mode: "insensitive" } },
              { renderedBody: { contains: search, mode: "insensitive" } },
              { company: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
      ...(status ? { status } : {}),
      ...(companyId ? { companyId } : {}),
      ...(type ? { type } : {}),
      // Tag filter: contract must have ANY of the specified tags
      ...(tagIds.length > 0
        ? { tags: { some: { id: { in: tagIds }, organizationId: orgId } } }
        : {}),
      // CLM Slice 4c: contracts with at least one open (flagged) deviation.
      // organizationId: orgId is defense-in-depth (mirrors the tag filter pattern).
      ...(hasDeviations
        ? { deviationFlags: { some: { status: "flagged", organizationId: orgId } } }
        : {}),
      // Value range
      ...(valueMin !== undefined || valueMax !== undefined
        ? {
            valueAmount: {
              ...(valueMin !== undefined ? { gte: valueMin } : {}),
              ...(valueMax !== undefined ? { lte: valueMax } : {}),
            },
          }
        : {}),
      // Start date range
      ...(startFrom !== undefined || startTo !== undefined
        ? {
            startDate: {
              ...(startFrom ? { gte: startFrom } : {}),
              ...(startTo ? { lte: startTo } : {}),
            },
          }
        : {}),
      // End date range
      ...(endFrom !== undefined || endTo !== undefined
        ? {
            endDate: {
              ...(endFrom ? { gte: endFrom } : {}),
              ...(endTo ? { lte: endTo } : {}),
            },
          }
        : {}),
    }

    const [contracts, total] = await Promise.all([
      prisma.contract.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          company: { select: { id: true, name: true } },
          deal: { select: { id: true, name: true } },
          contact: { select: { id: true, fullName: true } },
          // FIX 2: org-filter tag reads — defense-in-depth vs implicit m2m
          tags: { where: { organizationId: orgId }, select: { id: true, name: true, color: true } },
          // CLM Slice 4c: include open deviation flags count for list indicator
          deviationFlags: {
            where: { status: "flagged" },
            select: { id: true, severity: true },
          },
        },
      }),
      prisma.contract.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: { contracts: contracts.map(normalizeContractRow), total, page, limit, search },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("contracts", "write", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  const body = await req.json()
  const parsed = createContractSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    // Cross-tenant FK guard: validate supplied companyId/dealId/contactId belong to
    // this org BEFORE the write. Mirrors the guard in contract-templates/:id/generate.
    if (parsed.data.companyId) {
      const c = await prisma.company.findFirst({
        where: { id: parsed.data.companyId, organizationId: orgId },
        select: { id: true },
      })
      if (!c) return NextResponse.json({ error: "Company not found in this tenant" }, { status: 404 })
    }
    if (parsed.data.dealId) {
      const d = await prisma.deal.findFirst({
        where: { id: parsed.data.dealId, organizationId: orgId },
        select: { id: true },
      })
      if (!d) return NextResponse.json({ error: "Deal not found in this tenant" }, { status: 404 })
    }
    if (parsed.data.contactId) {
      const ct = await prisma.contact.findFirst({
        where: { id: parsed.data.contactId, organizationId: orgId },
        select: { id: true },
      })
      if (!ct) return NextResponse.json({ error: "Contact not found in this tenant" }, { status: 404 })
    }

    const contract = await prisma.contract.create({
      data: {
        organizationId: orgId,
        ...parsed.data,
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
      },
      include: {
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, name: true } },
        contact: { select: { id: true, fullName: true } },
      },
    })
    // Schedule renewal alerts if endDate is set. Fire-and-forget — contract
    // is already persisted; alert failure must not roll back the creation.
    if (contract.endDate) {
      upsertRenewalAlerts(orgId, contract.id, contract.endDate).catch((err) =>
        console.error("[contracts POST] upsertRenewalAlerts failed:", err),
      )
    }
    return NextResponse.json({ success: true, data: normalizeContractRow(contract) }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
