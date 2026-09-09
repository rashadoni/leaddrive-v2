import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const current = await prisma.ticket.findFirst({
    where: { id, organizationId: orgId },
    select: { createdAt: true, assignedTo: true },
  })

  if (!current) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  const assignedTo = searchParams.get("assignedTo")

  const baseWhere: any = {
    organizationId: orgId,
    ...(status ? { status } : {}),
    ...(assignedTo ? { assignedTo } : {}),
  }

  const [prev, next] = await Promise.all([
    prisma.ticket.findFirst({
      where: { ...baseWhere, createdAt: { lt: current.createdAt } },
      select: { id: true, ticketNumber: true, subject: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.ticket.findFirst({
      where: { ...baseWhere, createdAt: { gt: current.createdAt } },
      select: { id: true, ticketNumber: true, subject: true },
      orderBy: { createdAt: "asc" },
    }),
  ])

  return NextResponse.json({ success: true, data: { prev, next } })
})
