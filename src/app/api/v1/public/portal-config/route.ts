import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { getPortalUser } from "@/lib/portal-auth"
import { SUPPORT_AI_DISABLED_FEATURE } from "@/lib/ai/feature-keys"

// Returns the tenant-level feature flags and lightweight facet lists the portal UI
// needs to decide which optional fields to render (e.g. the "this is a complaint"
// toggle and its brand/product dropdowns).
export async function GET() {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // RLS: org comes from the verified portal JWT — whole handler runs tenant-scoped.
  return await runWithTenant(user.organizationId, async () => {
  const org = await prisma.organization.findFirst({
    where: { id: user.organizationId },
    select: { features: true },
  })

  const featuresRaw = org?.features
  const arr: string[] =
    typeof featuresRaw === "string"
      ? (() => {
          try {
            return JSON.parse(featuresRaw || "[]")
          } catch {
            return []
          }
        })()
      : Array.isArray(featuresRaw)
      ? (featuresRaw as string[])
      : []

  const complaintsEnabled = arr.includes("complaints_register")
  const loyaltyEnabled = arr.includes("loyalty_portal")
  const supportAiEnabled = !arr.includes(SUPPORT_AI_DISABLED_FEATURE)

  let brands: string[] = []
  let productCategories: string[] = []
  if (complaintsEnabled) {
    const [brandsRaw, catsRaw] = await Promise.all([
      prisma.complaintMeta.findMany({
        where: { organizationId: user.organizationId },
        select: { brand: true },
        distinct: ["brand"],
      }),
      prisma.complaintMeta.findMany({
        where: { organizationId: user.organizationId },
        select: { productCategory: true },
        distinct: ["productCategory"],
      }),
    ])
    const brandStrings: string[] = brandsRaw
      .map((b: { brand: string | null }) => b.brand)
      .filter((v: string | null): v is string => typeof v === "string" && v.length > 0)
    const catStrings: string[] = catsRaw
      .map((c: { productCategory: string | null }) => c.productCategory)
      .filter((v: string | null): v is string => typeof v === "string" && v.length > 0)
    brands = [...new Set(brandStrings)].sort()
    productCategories = [...new Set(catStrings)].sort()
  }

  return NextResponse.json({
    success: true,
    data: {
      features: { complaints_register: complaintsEnabled, loyalty: loyaltyEnabled, supportAi: supportAiEnabled },
      brands,
      productCategories,
    },
  })
  }) // end runWithTenant (tenant-scoped handler body)
}
