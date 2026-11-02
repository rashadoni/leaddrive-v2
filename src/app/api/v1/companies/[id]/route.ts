import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields, filterWritableFields } from "@/lib/field-filter"
import { clearTaskRelations } from "@/lib/tasks/clear-task-relations"
import {
  leadScoreSchema,
  nonNegativeCountSchema,
  nonNegativeFinancialAmountSchema,
} from "@/lib/validation/numeric"
import { voenInput } from "@/lib/companies/az-taxpayer-registry"
import { PHARMACY_SOURCE_FIELDS } from "@/lib/pharmacy-orders/pharmacy-source"

const updateCompanySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  industry: z.string().max(100).optional(),
  website: z.string().max(500).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(["active", "inactive", "prospect"]).optional(),
  category: z.string().optional(),
  leadStatus: z.string().optional(),
  leadScore: leadScoreSchema.optional(),
  leadTemperature: z.string().optional(),
  // Two fields either side of the creditLimit that finding 14 bounded, left
  // bare. userCount is summed into the dashboard total (companies/route.ts),
  // and annualRevenue is a financial field.
  userCount: nonNegativeCountSchema.optional(),
  annualRevenue: nonNegativeFinancialAmountSchema.optional(),
  employeeCount: z.number().int().nonnegative().optional(),
  slaPolicyId: z.string().nullable().optional(),
  creditLimit: nonNegativeFinancialAmountSchema.nullable().optional(),
  creditCurrency: z.string().max(10).nullable().optional(),
  voen: z.string().max(40).nullable().optional(),
  director: z.string().max(200).nullable().optional(),
  managerId: z.string().max(64).nullable().optional(),
})

/** A change to a field the company's outside register owns (1C for a pharmacy). */
function sourceFieldChanges(current: Record<string, unknown>, data: Record<string, unknown>) {
  const same = (a: unknown, b: unknown) => (a ?? "") === (b ?? "")
  return PHARMACY_SOURCE_FIELDS.filter(field => field in data && !same(current[field], data[field]))
}

export const GET = withRlsAuth("companies", "read", async (_req, { orgId, role }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const company = await prisma.company.findFirst({
      where: { id, organizationId: orgId },
      include: {
        contacts: { where: { organizationId: orgId }, orderBy: { fullName: "asc" } },
        deals: { where: { organizationId: orgId }, orderBy: { createdAt: "desc" } },
        contracts: { where: { organizationId: orgId }, orderBy: { createdAt: "desc" } },
        activities: { where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 20 },
        slaPolicy: { select: { id: true, name: true, priority: true, resolutionHours: true, firstResponseHours: true } },
        manager: { select: { id: true, name: true } },
      },
    })
    if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const fieldPerms = await getFieldPermissions(orgId, role, "company")
    const filtered = filterEntityFields(company, fieldPerms, role)
    return NextResponse.json({ success: true, data: filtered })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRlsAuth("companies", "write", async (req, { orgId, role }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = updateCompanySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const voen = voenInput(parsed.data.voen)
  if (!voen.ok) return NextResponse.json({ error: "VÖEN is ten digits", code: "INVALID_VOEN" }, { status: 400 })
  const data: Record<string, unknown> = { ...parsed.data, voen: voen.value }
  if (voen.value === undefined) delete data.voen
  if (parsed.data.director !== undefined) data.director = parsed.data.director?.trim() || null

  try {
    const current = await prisma.company.findFirst({ where: { id, organizationId: orgId },
      select: { externalSource: true, name: true, address: true, city: true, phone: true } })
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (current.externalSource) {
      const fields = sourceFieldChanges(current, data)
      if (fields.length) return NextResponse.json({ error: "Edited in 1C", code: "SOURCE_MANAGED", fields }, { status: 409 })
    }
    if (data.managerId) {
      const manager = await prisma.user.findFirst({ where: { id: data.managerId as string, organizationId: orgId }, select: { id: true } })
      if (!manager) return NextResponse.json({ error: "Unknown manager", code: "INVALID_MANAGER" }, { status: 400 })
    }
    const fieldPerms = await getFieldPermissions(orgId, role, "company")
    const allowedData = filterWritableFields(data, fieldPerms, role)
    const company = await prisma.company.updateMany({
      where: { id, organizationId: orgId },
      data: allowedData,
    })
    if (company.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const updated = await prisma.company.findFirst({ where: { id, organizationId: orgId } })
    logAudit(orgId, "update", "company", id, updated?.name || "", { newValue: parsed.data })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// PATCH = partial-update alias of PUT (inline-edit consumers use PATCH verb).
// PUT already does partial updates; only fields in the body are written.
export const PATCH = PUT

export const DELETE = withRlsAuth("companies", "delete", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const existing = await prisma.company.findFirst({ where: { id, organizationId: orgId }, select: { name: true, externalSource: true } })
    // A pharmacy from 1C is closed in 1C: deleted here, the next load brings it back.
    if (existing?.externalSource) return NextResponse.json({ error: "Edited in 1C", code: "SOURCE_MANAGED" }, { status: 409 })
    const result = await prisma.company.deleteMany({ where: { id, organizationId: orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    // Null out tasks that linked to this now-deleted company (no FK → not auto-nulled).
    await clearTaskRelations(orgId, "company", id)
    logAudit(orgId, "delete", "company", id, existing?.name || "")
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
