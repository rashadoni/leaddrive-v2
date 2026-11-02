import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { mtmPhoneProductWhere } from "@/lib/mtm/product-visibility"
import { withMobileRls } from "@/lib/with-mobile-rls"

export const GET = withMobileRls(async (_req, auth) => {
  const forbidden = requireMobileCapability(auth, "FIELD_EXECUTE")
  if (forbidden) return forbidden

  try {
    // Each presentation has its own list of who sees it (`mtmPhoneProductWhere`).
    const products = await prisma.mtmProduct.findMany({
      where: mtmPhoneProductWhere({ orgId: auth.orgId, agentId: auth.agentId }),
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        groupId: true,
        name: true,
        description: true,
        presentationVersion: true,
        updatedAt: true,
        document: {
          select: {
            id: true,
            title: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            checksumSha256: true,
            deletedAt: true,
          },
        },
      },
    })

    if (products.length === 0) {
      return NextResponse.json({ success: true, data: { groups: [], products: [] } })
    }

    const groups: Array<{
      id: string
      parentId: string | null
      name: string
      description: string | null
      sortOrder: number
      members: Array<{ role: string }>
    }> = await prisma.mtmProductGroup.findMany({
      where: { organizationId: auth.orgId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        parentId: true,
        name: true,
        description: true,
        sortOrder: true,
        members: {
          where: { agentId: auth.agentId },
          select: { role: true },
        },
      },
    })
    // The groups holding a presentation the phone gets, and the groups above
    // them, so the app can still name the portfolio a group belongs to.
    const byId = new Map(groups.map((group) => [group.id, group]))
    const shownGroupIds = new Set<string>()
    for (const product of products) {
      let current = byId.get(product.groupId)
      while (current && !shownGroupIds.has(current.id)) {
        shownGroupIds.add(current.id)
        current = current.parentId ? byId.get(current.parentId) : undefined
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        groups: groups
          .filter((group) => shownGroupIds.has(group.id))
          .map(({ members, ...group }) => ({ ...group, directMembership: members[0]?.role ?? null })),
        products: products.map((product) => ({
          ...product,
          document: product.document?.deletedAt ? null : product.document,
          downloadUrl: product.document && !product.document.deletedAt
            ? `/api/v1/mtm/mobile/documents/${product.document.id}/download?view=inline`
            : null,
        })),
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/products GET]", error)
    return NextResponse.json({ error: "Failed to load products", code: "MTM_PRODUCTS_LOAD_FAILED" }, { status: 500 })
  }
})
