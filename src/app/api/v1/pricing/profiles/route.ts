import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const profileSchema = z.object({
  companyCode: z.string().min(1).max(100),
  companyId: z.string().max(100).nullish(),
  groupId: z.string().min(1).max(100),
  monthlyTotal: z.number().min(0).max(999999999).optional(),
  annualTotal: z.number().min(0).max(999999999).optional(),
})

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const groupId = searchParams.get("groupId")
  const companyId = searchParams.get("companyId")
  const search = searchParams.get("search")
  const page = parseInt(searchParams.get("page") || "1", 10)
  const limit = parseInt(searchParams.get("limit") || "100", 10)
  const all = searchParams.get("all") === "true"

  const where: any = { organizationId: orgId }
  if (groupId) where.groupId = groupId
  if (companyId) where.companyId = companyId
  if (search) where.companyCode = { contains: search, mode: "insensitive" }

  const [profiles, total] = await Promise.all([
    prisma.pricingProfile.findMany({
      where,
      include: {
        group: true,
        company: { select: { id: true, name: true } },
        categories: {
          where: { organizationId: orgId },
          include: {
            category: true,
            services: { where: { organizationId: orgId }, orderBy: { sortOrder: "asc" } },
          },
          orderBy: { category: { sortOrder: "asc" } },
        },
        _count: { select: { additionalSales: true } },
      },
      orderBy: [{ group: { sortOrder: "asc" } }, { companyCode: "asc" }],
      ...(all ? {} : { skip: (page - 1) * limit, take: limit }),
    }),
    prisma.pricingProfile.count({ where }),
  ])

  return NextResponse.json({ success: true, data: { profiles, total, page, limit } })
})

export const POST = withRls(async (req, { orgId }) => {
  try {
    const body = await req.json()
    const parsed = profileSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const { companyCode, companyId, groupId, monthlyTotal, annualTotal } = parsed.data

    const profile = await prisma.pricingProfile.create({
      data: {
        organizationId: orgId,
        companyCode,
        companyId: companyId || null,
        groupId,
        monthlyTotal: monthlyTotal || 0,
        annualTotal: annualTotal || 0,
      },
      include: { group: true, company: { select: { id: true, name: true } } },
    })

    return NextResponse.json({ success: true, data: profile }, { status: 201 })
  } catch (e: any) {
    if (e.code === "P2002") {
      return NextResponse.json({ error: "Profile with this companyCode already exists" }, { status: 409 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
