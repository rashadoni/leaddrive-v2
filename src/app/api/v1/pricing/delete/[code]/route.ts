import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params

  const profile = await prisma.pricingProfile.findFirst({
    where: { organizationId: orgId, companyCode: code },
  })
  if (!profile) return NextResponse.json({ error: `Company '${code}' not found` }, { status: 404 })

  await prisma.pricingProfile.delete({ where: { id: profile.id } })
  return NextResponse.json({ success: true, data: { deleted: code } })
})
