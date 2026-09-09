import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  try {
    const domain = await prisma.customDomain.findFirst({
      where: { id, organizationId: orgId },
    })

    if (!domain) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json({ domain })
  } catch (error) {
    console.error("Failed to get custom domain:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  try {
    const domain = await prisma.customDomain.findFirst({
      where: { id, organizationId: orgId },
    })

    if (!domain) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    await prisma.customDomain.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete custom domain:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
