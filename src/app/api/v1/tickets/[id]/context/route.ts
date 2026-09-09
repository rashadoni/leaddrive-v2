import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const ticket = await prisma.ticket.findFirst({
    where: { id, organizationId: orgId },
    include: {
      contact: { select: { id: true, fullName: true, email: true, phone: true, position: true, avatar: true } },
      company: { select: { id: true, name: true, industry: true, leadScore: true } },
    },
  })

  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

  const [recentTickets, recentActivity, openDeals, lifetimeValue] = await Promise.all([
    // Recent tickets by same contact (excluding current)
    ticket.contactId
      ? prisma.ticket.findMany({
          where: { organizationId: orgId, contactId: ticket.contactId, id: { not: id } },
          select: { id: true, ticketNumber: true, subject: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        })
      : [],

    // Recent activities
    ticket.contactId
      ? prisma.activity.findMany({
          where: { organizationId: orgId, contactId: ticket.contactId },
          select: { id: true, type: true, subject: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 10,
        })
      : [],

    // Open deals for this company
    ticket.companyId
      ? prisma.deal.findMany({
          where: { organizationId: orgId, companyId: ticket.companyId, status: { not: "lost" } },
          select: { id: true, name: true, valueAmount: true, stage: true, currency: true }, // valueAmount normalized below
          orderBy: { createdAt: "desc" },
          take: 5,
        })
      : [],

    // Lifetime value (sum of won deals)
    ticket.companyId
      ? prisma.deal.aggregate({
          where: { organizationId: orgId, companyId: ticket.companyId, status: "won" },
          _sum: { valueAmount: true },
        })
      : null,
  ])

  return NextResponse.json({
    success: true,
    data: {
      contact: ticket.contact,
      company: ticket.company,
      recentTickets,
      recentActivity,
      openDeals: (openDeals as any[]).map((d) => ({ ...d, valueAmount: decimalToNumber(d.valueAmount) })),
      lifetimeValue: decimalToNumber(lifetimeValue?._sum?.valueAmount),
    },
  })
})
