import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { voenInput } from "@/lib/companies/az-taxpayer-registry"
import { SUPPLIER_CATEGORY } from "@/lib/procurement/suppliers"

/**
 * Suppliers — companies of the category `supplier` (docs/sales-procurement/README.md,
 * decision 6.3). They live in the shared company table so a supplier keeps its
 * contacts, files and history, and the client lists leave them out
 * (`/api/v1/companies` hides the category by default).
 *
 * Reading the list is part of following a purchase (sales reads procurement);
 * adding a supplier is purchasing work (`procurement` write).
 */

const SUPPLIER_SELECT = {
  id: true,
  name: true,
  voen: true,
  director: true,
  phone: true,
  email: true,
  website: true,
  address: true,
  city: true,
  description: true,
  status: true,
  createdAt: true,
} satisfies Prisma.CompanySelect

const MAX_LIMIT = 200

export const GET = withRlsAuth("procurement", "read", async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const search = (searchParams.get("search") || "").trim().slice(0, 120)
  const status = searchParams.get("status") === "inactive" ? "inactive" : searchParams.get("status") === "all" ? null : "active"
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(searchParams.get("limit") || "100", 10) || 100))

  const where: Prisma.CompanyWhereInput = {
    organizationId: orgId,
    category: SUPPLIER_CATEGORY,
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { voen: { contains: search } },
            { phone: { contains: search } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  }

  const [suppliers, total] = await Promise.all([
    prisma.company.findMany({ where, select: SUPPLIER_SELECT, orderBy: [{ name: "asc" }, { id: "asc" }], take: limit }),
    prisma.company.count({ where }),
  ])
  return NextResponse.json({ success: true, data: { suppliers, total } })
})

const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(200),
  voen: z.string().max(40).optional().nullable(),
  director: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable().refine((v) => !v || z.string().email().safeParse(v).success, "Invalid email"),
  website: z.string().trim().max(300).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
})

const blankToNull = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null)

export const POST = withRlsAuth("procurement", "write", async (req, { orgId, userId }) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = createSupplierSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 })
  }
  const voen = voenInput(parsed.data.voen ?? undefined)
  if (!voen.ok) return NextResponse.json({ error: "VÖEN is ten digits", code: "INVALID_VOEN" }, { status: 400 })

  const supplier = await prisma.company.create({
    data: {
      organizationId: orgId,
      name: parsed.data.name,
      category: SUPPLIER_CATEGORY,
      status: "active",
      leadStatus: "converted",
      voen: voen.value,
      director: blankToNull(parsed.data.director),
      phone: blankToNull(parsed.data.phone),
      email: blankToNull(parsed.data.email),
      website: blankToNull(parsed.data.website),
      address: blankToNull(parsed.data.address),
      city: blankToNull(parsed.data.city),
      description: blankToNull(parsed.data.description),
    },
    select: SUPPLIER_SELECT,
  })
  logAudit(orgId, "create", "company", supplier.id, supplier.name, { newValue: { category: SUPPLIER_CATEGORY }, userId })
  return NextResponse.json({ success: true, data: supplier }, { status: 201 })
})
