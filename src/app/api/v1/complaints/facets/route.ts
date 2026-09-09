import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

// Returns distinct values for cascading selects on the complaint form.
// Query params narrow downstream facets:
//   /facets                                   → all brands
//   /facets?brand=Çörəkçi                     → productionAreas for that brand
//   /facets?brand=X&productionArea=Y          → productCategories
//   /facets?brand=X&productionArea=Y&productCategory=Z → complaintObjects
//
// Always returns { brands, productionAreas, productCategories, complaintObjects, departments }.
export const GET = withRls(async (req, { orgId }) => {
  const sp = new URL(req.url).searchParams
  const brand = sp.get("brand") || undefined
  const productionArea = sp.get("productionArea") || undefined
  const productCategory = sp.get("productCategory") || undefined

  const baseWhere = { organizationId: orgId }

  const [brandsRaw, areasRaw, categoriesRaw, objectsRaw, departmentsRaw] = await Promise.all([
    prisma.complaintMeta.findMany({
      where: baseWhere,
      select: { brand: true },
      distinct: ["brand"],
    }),
    brand
      ? prisma.complaintMeta.findMany({
          where: { ...baseWhere, brand },
          select: { productionArea: true },
          distinct: ["productionArea"],
        })
      : Promise.resolve([]),
    brand && productionArea
      ? prisma.complaintMeta.findMany({
          where: { ...baseWhere, brand, productionArea },
          select: { productCategory: true },
          distinct: ["productCategory"],
        })
      : Promise.resolve([]),
    brand && productionArea && productCategory
      ? prisma.complaintMeta.findMany({
          where: { ...baseWhere, brand, productionArea, productCategory },
          select: { complaintObject: true },
          distinct: ["complaintObject"],
        })
      : Promise.resolve([]),
    prisma.complaintMeta.findMany({
      where: baseWhere,
      select: { responsibleDepartment: true },
      distinct: ["responsibleDepartment"],
    }),
  ])

  const pick = (arr: Array<Record<string, unknown>>, key: string): string[] =>
    [...new Set(arr.map((r) => r[key]).filter((v): v is string => typeof v === "string" && v.length > 0))].sort()

  return NextResponse.json({
    success: true,
    data: {
      brands: pick(brandsRaw, "brand"),
      productionAreas: pick(areasRaw, "productionArea"),
      productCategories: pick(categoriesRaw, "productCategory"),
      complaintObjects: pick(objectsRaw, "complaintObject"),
      departments: pick(departmentsRaw, "responsibleDepartment"),
    },
  })
})
