import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params

  const profile = await prisma.pricingProfile.findFirst({
    where: { organizationId: orgId, companyCode: code },
    include: {
      group: true,
      categories: {
        where: { organizationId: orgId },
        include: { category: true, services: { where: { organizationId: orgId } } },
      },
    },
  })
  if (!profile) return NextResponse.json({ error: `Company '${code}' not found` }, { status: 404 })

  const updates = await req.json()

  if (updates.categories) {
    let monthlyTotal = 0

    for (const [catName, val] of Object.entries(updates.categories) as [string, any][]) {
      const pc = profile.categories.find((c: any) => c.category.name === catName)
      if (!pc) continue

      const catTotal = typeof val === "number" ? val : val?.total || 0
      monthlyTotal += catTotal

      await prisma.pricingProfileCategory.update({
        where: { id: pc.id },
        data: { total: catTotal },
      })

      if (val?.services && Array.isArray(val.services)) {
        await prisma.pricingService.deleteMany({ where: { profileCategoryId: pc.id } })
        for (const [idx, svc] of val.services.entries()) {
          await prisma.pricingService.create({
            data: {
              organizationId: orgId,
              profileCategoryId: pc.id,
              name: svc.name || "Unnamed",
              unit: svc.unit || "Per Device",
              qty: typeof svc.qty === "number" ? svc.qty : 0,
              price: typeof svc.price === "number" ? svc.price : 0,
              total: typeof svc.total === "number" ? svc.total : 0,
              sortOrder: idx,
            },
          })
        }
      }
    }

    await prisma.pricingProfile.update({
      where: { id: profile.id },
      data: { monthlyTotal, annualTotal: monthlyTotal * 12 },
    })
  }

  if (updates.group) {
    const group = await prisma.pricingGroup.findFirst({
      where: { organizationId: orgId, name: updates.group },
    })
    if (group) {
      await prisma.pricingProfile.update({
        where: { id: profile.id },
        data: { groupId: group.id },
      })
    }
  }

  // Return updated profile in legacy format
  const updated = await prisma.pricingProfile.findFirst({
    where: { id: profile.id },
    include: {
      group: true,
      categories: {
        where: { organizationId: orgId },
        include: { category: true, services: { where: { organizationId: orgId }, orderBy: { sortOrder: "asc" } } },
      },
    },
  })

  const categories: Record<string, any> = {}
  for (const pc of updated!.categories) {
    categories[pc.category.name] = {
      total: pc.total,
      services: pc.services.map((s: any) => ({
        name: s.name, qty: s.qty, price: s.price, total: s.total, unit: s.unit,
      })),
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      group: updated!.group.name,
      categories,
      monthly: updated!.monthlyTotal,
      annual: updated!.annualTotal,
      monthly_total: updated!.monthlyTotal,
    },
  })
})
