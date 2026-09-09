import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"

/**
 * GET: Returns pricing data in the legacy JSON format for backward compatibility.
 * DB → { [companyCode]: { group, categories: { [catName]: { total, services } }, monthly, annual, monthly_total } }
 */
export const GET = withRls(async (_req, { orgId }) => {
  try {
    const profiles = await prisma.pricingProfile.findMany({
      where: { organizationId: orgId },
      include: {
        group: true,
        categories: {
          where: { organizationId: orgId },
          include: {
            category: true,
            services: { where: { organizationId: orgId }, orderBy: { sortOrder: "asc" } },
          },
        },
      },
      orderBy: [{ group: { sortOrder: "asc" } }, { companyCode: "asc" }],
    })

    const data: Record<string, any> = {}
    for (const profile of profiles) {
      const categories: Record<string, any> = {}
      for (const pc of profile.categories) {
        categories[pc.category.name] = {
          total: pc.total,
          services: pc.services.map((s: any) => ({
            name: s.name,
            qty: s.qty,
            price: s.price,
            total: s.total,
            unit: s.unit,
          })),
        }
      }

      data[profile.companyCode] = {
        group: profile.group.name,
        categories,
        monthly: profile.monthlyTotal,
        annual: profile.annualTotal,
        monthly_total: profile.monthlyTotal,
      }
    }

    return NextResponse.json({ success: true, data })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/**
 * PUT: Saves pricing data from the legacy editor format back to DB.
 * Accepts { [companyCode]: { categories: { [catName]: { total, services: [...] } } } }
 */
export const PUT = withRls(async (req, { orgId }) => {
  try {
    const data = await req.json()

    for (const [companyCode, companyData] of Object.entries(data) as [string, any][]) {
      const profile = await prisma.pricingProfile.findFirst({
        where: { organizationId: orgId, companyCode },
        include: {
          categories: {
            include: { category: true, services: { where: { organizationId: orgId } } },
          },
        },
      })
      if (!profile) continue

      // Update monthly/annual totals
      let monthlyTotal = 0

      for (const [catName, catVal] of Object.entries(companyData.categories || {}) as [string, any][]) {
        const pc = profile.categories.find((c: any) => c.category.name === catName)
        if (!pc) continue

        const catTotal = typeof catVal === "number" ? catVal : catVal?.total || 0
        monthlyTotal += catTotal

        // Update category total
        await prisma.pricingProfileCategory.update({
          where: { id: pc.id },
          data: { total: catTotal },
        })

        // Update services if provided
        if (catVal?.services && Array.isArray(catVal.services)) {
          // Delete old services and recreate
          await prisma.pricingService.deleteMany({ where: { profileCategoryId: pc.id } })

          for (const [idx, svc] of catVal.services.entries()) {
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

      // Update profile totals
      await prisma.pricingProfile.update({
        where: { id: profile.id },
        data: {
          monthlyTotal,
          annualTotal: monthlyTotal * 12,
        },
      })
    }

    return NextResponse.json({ success: true, data: { saved: true } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
