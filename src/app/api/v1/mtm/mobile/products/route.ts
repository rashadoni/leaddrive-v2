import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { expandVisibleProductGroupIds } from "@/lib/mtm/product-group-access"
import { withMobileRls } from "@/lib/with-mobile-rls"

export const GET = withMobileRls(async (_req, auth) => {
  const forbidden = requireMobileCapability(auth, "FIELD_EXECUTE")
  if (forbidden) return forbidden

  try {
    const groups = await prisma.mtmProductGroup.findMany({
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

    // Membership on a portfolio grants its active descendants too. This keeps
    // a manager from assigning every product subgroup one by one.
    const visibleGroupIds = expandVisibleProductGroupIds(groups.map((group) => ({
      id: group.id,
      parentId: group.parentId,
      hasDirectMembership: group.members.length > 0,
    })))

    if (visibleGroupIds.size === 0) {
      return NextResponse.json({ success: true, data: { groups: [], products: [] } })
    }

    const products = await prisma.mtmProduct.findMany({
      where: {
        organizationId: auth.orgId,
        groupId: { in: [...visibleGroupIds] },
        isActive: true,
      },
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

    return NextResponse.json({
      success: true,
      data: {
        groups: groups
          .filter((group) => visibleGroupIds.has(group.id))
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
