import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const sale = await prisma.additionalSale.findFirst({
    where: { id, organizationId: orgId },
    include: {
      profile: {
        select: { id: true, companyCode: true, company: { select: { id: true, name: true } } },
      },
    },
  })

  if (!sale) return NextResponse.json({ error: "Additional sale not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: sale })
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.additionalSale.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Additional sale not found" }, { status: 404 })

  try {
    const body = await req.json()
    const { name, description, categoryName, unit, qty, price, type, effectiveDate, endDate, status } = body

    const newQty = qty !== undefined ? qty : existing.qty
    const newPrice = price !== undefined ? price : existing.price
    const total = newQty * newPrice

    const sale = await prisma.additionalSale.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(categoryName !== undefined && { categoryName }),
        ...(unit !== undefined && { unit }),
        ...(qty !== undefined && { qty }),
        ...(price !== undefined && { price }),
        total,
        ...(type !== undefined && { type }),
        ...(effectiveDate !== undefined && { effectiveDate: new Date(effectiveDate) }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
        ...(status !== undefined && { status }),
      },
      include: {
        profile: {
          select: { id: true, companyCode: true, company: { select: { id: true, name: true } } },
        },
      },
    })

    return NextResponse.json({ success: true, data: sale })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.additionalSale.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Additional sale not found" }, { status: 404 })

  await prisma.additionalSale.delete({ where: { id } })
  return NextResponse.json({ success: true, data: { deleted: true } })
})
