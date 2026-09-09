import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const serviceSchema = z.object({
  profileCategoryId: z.string().min(1).max(100),
  name: z.string().min(1).max(300),
  unit: z.string().max(100).optional(),
  qty: z.number().int().min(0).max(999999).optional(),
  price: z.number().min(0).max(999999999).optional(),
})

export const POST = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id: profileId } = await params

  const profile = await prisma.pricingProfile.findFirst({ where: { id: profileId, organizationId: orgId } })
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

  try {
    const body = await req.json()
    const parsed = serviceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const { profileCategoryId, name, unit, qty, price } = parsed.data

    const pc = await prisma.pricingProfileCategory.findFirst({
      where: { id: profileCategoryId, profileId, organizationId: orgId },
    })
    if (!pc) return NextResponse.json({ error: "Profile category not found" }, { status: 404 })

    const maxOrder = await prisma.pricingService.aggregate({
      where: { profileCategoryId },
      _max: { sortOrder: true },
    })

    const total = (qty || 0) * (price || 0)
    const service = await prisma.pricingService.create({
      data: {
        organizationId: orgId,
        profileCategoryId,
        name,
        unit: unit || "Per Device",
        qty: qty || 0,
        price: price || 0,
        total,
        sortOrder: (maxOrder._max.sortOrder || 0) + 1,
      },
    })

    // Update category total
    const catServices = await prisma.pricingService.findMany({ where: { profileCategoryId } })
    const catTotal = catServices.reduce((sum: number, s: any) => sum + s.total, 0)
    await prisma.pricingProfileCategory.update({ where: { id: profileCategoryId }, data: { total: catTotal } })

    return NextResponse.json({ success: true, data: service }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  await params // validate route

  try {
    const body = await req.json()
    const { serviceId, name, unit, qty, price } = body

    if (!serviceId) return NextResponse.json({ error: "serviceId is required" }, { status: 400 })

    const existing = await prisma.pricingService.findFirst({
      where: { id: serviceId, organizationId: orgId },
    })
    if (!existing) return NextResponse.json({ error: "Service not found" }, { status: 404 })

    const newQty = qty !== undefined ? qty : existing.qty
    const newPrice = price !== undefined ? price : existing.price
    const total = newQty * newPrice

    const service = await prisma.pricingService.update({
      where: { id: serviceId },
      data: {
        ...(name !== undefined && { name }),
        ...(unit !== undefined && { unit }),
        ...(qty !== undefined && { qty }),
        ...(price !== undefined && { price }),
        total,
      },
    })

    // Update category total
    const catServices = await prisma.pricingService.findMany({ where: { profileCategoryId: existing.profileCategoryId } })
    const catTotal = catServices.reduce((sum: number, s: any) => sum + s.total, 0)
    await prisma.pricingProfileCategory.update({ where: { id: existing.profileCategoryId }, data: { total: catTotal } })

    return NextResponse.json({ success: true, data: service })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  await params

  const { searchParams } = new URL(req.url)
  const serviceId = searchParams.get("serviceId")

  if (!serviceId) return NextResponse.json({ error: "serviceId is required" }, { status: 400 })

  const existing = await prisma.pricingService.findFirst({
    where: { id: serviceId, organizationId: orgId },
  })
  if (!existing) return NextResponse.json({ error: "Service not found" }, { status: 404 })

  await prisma.pricingService.delete({ where: { id: serviceId } })

  // Update category total
  const catServices = await prisma.pricingService.findMany({ where: { profileCategoryId: existing.profileCategoryId } })
  const catTotal = catServices.reduce((sum: number, s: any) => sum + s.total, 0)
  await prisma.pricingProfileCategory.update({ where: { id: existing.profileCategoryId }, data: { total: catTotal } })

  return NextResponse.json({ success: true, data: { deleted: true } })
})
