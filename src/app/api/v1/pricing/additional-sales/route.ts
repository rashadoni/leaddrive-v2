import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const profileId = searchParams.get("profileId")
  const type = searchParams.get("type") // recurring, one_time
  const status = searchParams.get("status") // active, cancelled, completed
  const page = parseInt(searchParams.get("page") || "1", 10)
  const limit = parseInt(searchParams.get("limit") || "50", 10)

  const where: any = { organizationId: orgId }
  if (profileId) where.profileId = profileId
  if (type) where.type = type
  if (status) where.status = status

  const [sales, total] = await Promise.all([
    prisma.additionalSale.findMany({
      where,
      include: {
        profile: {
          select: { id: true, companyCode: true, company: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.additionalSale.count({ where }),
  ])

  return NextResponse.json({ success: true, data: { sales, total, page, limit } })
})

export const POST = withRls(async (req, { orgId, session }) => {
  try {
    const userId = session?.userId || null

    const body = await req.json()
    const { profileId, dealId, type, name, description, categoryName, unit, qty, price, effectiveDate, endDate } = body

    if (!profileId || !name || !type || !effectiveDate) {
      return NextResponse.json({ error: "profileId, name, type, and effectiveDate are required" }, { status: 400 })
    }

    const profile = await prisma.pricingProfile.findFirst({ where: { id: profileId, organizationId: orgId } })
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    const total = (qty || 1) * (price || 0)
    const sale = await prisma.additionalSale.create({
      data: {
        organizationId: orgId,
        profileId,
        dealId: dealId || null,
        type,
        name,
        description: description || null,
        categoryName: categoryName || null,
        unit: unit || null,
        qty: qty || 1,
        price: price || 0,
        total,
        effectiveDate: new Date(effectiveDate),
        endDate: endDate ? new Date(endDate) : null,
        status: "active",
        createdBy: userId,
      },
      include: {
        profile: {
          select: { id: true, companyCode: true, company: { select: { id: true, name: true } } },
        },
      },
    })

    return NextResponse.json({ success: true, data: sale }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
