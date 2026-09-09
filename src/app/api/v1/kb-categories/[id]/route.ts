import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  // Unset categoryId on articles that reference this category
  await prisma.kbArticle.updateMany({
    where: { organizationId: orgId, categoryId: id },
    data: { categoryId: null },
  })

  await prisma.kbCategory.delete({
    where: { id },
  })

  return NextResponse.json({ success: true })
})
