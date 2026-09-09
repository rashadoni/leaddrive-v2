import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const profile = await prisma.pricingProfile.findFirst({
    where: { id, organizationId: orgId },
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
      additionalSales: { where: { organizationId: orgId }, orderBy: { createdAt: "desc" } },
    },
  })

  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: profile })
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.pricingProfile.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

  try {
    const body = await req.json()
    const { companyCode, companyId, groupId, monthlyTotal, annualTotal, isActive } = body

    const profile = await prisma.pricingProfile.update({
      where: { id },
      data: {
        ...(companyCode !== undefined && { companyCode }),
        ...(companyId !== undefined && { companyId }),
        ...(groupId !== undefined && { groupId }),
        ...(monthlyTotal !== undefined && { monthlyTotal }),
        ...(annualTotal !== undefined && { annualTotal }),
        ...(isActive !== undefined && { isActive }),
      },
      include: { group: true, company: { select: { id: true, name: true } } },
    })

    return NextResponse.json({ success: true, data: profile })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.pricingProfile.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

  await prisma.pricingProfile.delete({ where: { id } })
  return NextResponse.json({ success: true, data: { deleted: true } })
})
