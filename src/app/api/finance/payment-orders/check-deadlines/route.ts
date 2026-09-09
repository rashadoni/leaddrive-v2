import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { runWithTenant } from "@/lib/rls-context"
import { prisma } from "@/lib/prisma"
import { notifyOverdueBills, notifyOverdueInvoices, notifyUpcomingDeadlines, getAdvanceDays } from "@/lib/finance/telegram-notify"
import { decimalToNumber } from "@/lib/prisma-decimal"

// POST — check and update overdue bills and invoices + send Telegram notifications
export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
  const now = new Date()

  // Find bills that will become overdue (before updating)
  const newOverdueBills = await prisma.bill.findMany({
    where: {
      organizationId: orgId,
      dueDate: { lt: now },
      status: { in: ["pending", "partially_paid"] },
      balanceDue: { gt: 0 },
    },
    select: { billNumber: true, vendorName: true, balanceDue: true, dueDate: true },
  })

  const newOverdueInvoices = await prisma.invoice.findMany({
    where: {
      organizationId: orgId,
      dueDate: { lt: now },
      status: { in: ["sent", "viewed", "partially_paid"] },
      balanceDue: { gt: 0 },
    },
    select: { invoiceNumber: true, balanceDue: true, dueDate: true, recipientName: true, company: { select: { name: true } } },
  })

  // Update statuses
  const [overdueBills, overdueInvoices] = await Promise.all([
    prisma.bill.updateMany({
      where: { organizationId: orgId, dueDate: { lt: now }, status: { in: ["pending", "partially_paid"] }, balanceDue: { gt: 0 } },
      data: { status: "overdue" },
    }),
    prisma.invoice.updateMany({
      where: { organizationId: orgId, dueDate: { lt: now }, status: { in: ["sent", "viewed", "partially_paid"] }, balanceDue: { gt: 0 } },
      data: { status: "overdue" },
    }),
  ])

  // Send Telegram notifications for newly overdue items
  if (newOverdueBills.length > 0) {
    await notifyOverdueBills(newOverdueBills.map((b: any) => ({
      billNumber: b.billNumber, vendorName: b.vendorName, amount: decimalToNumber(b.balanceDue), dueDate: b.dueDate!,
    })), orgId)
  }
  if (newOverdueInvoices.length > 0) {
    await notifyOverdueInvoices(newOverdueInvoices.map((inv: any) => ({
      invoiceNumber: inv.invoiceNumber || "N/A",
      companyName: inv.company?.name || inv.recipientName || "Unknown",
      amount: decimalToNumber(inv.balanceDue),
      dueDate: inv.dueDate!,
    })), orgId)
  }

  // Check upcoming deadlines (from settings) and notify
  const advanceDays = await getAdvanceDays(orgId)
  const deadline = new Date(now.getTime() + advanceDays * 86400000)
  const [upcomingBills, upcomingInvoices] = await Promise.all([
    prisma.bill.findMany({
      where: { organizationId: orgId, dueDate: { gte: now, lte: deadline }, status: { notIn: ["paid", "cancelled", "overdue"] }, balanceDue: { gt: 0 } },
      select: { billNumber: true, vendorName: true, balanceDue: true, dueDate: true },
      orderBy: { dueDate: "asc" },
    }),
    prisma.invoice.findMany({
      where: { organizationId: orgId, dueDate: { gte: now, lte: deadline }, status: { notIn: ["paid", "cancelled", "refunded", "overdue"] }, balanceDue: { gt: 0 } },
      select: { invoiceNumber: true, balanceDue: true, dueDate: true, recipientName: true, company: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
    }),
  ])

  if (upcomingBills.length > 0 || upcomingInvoices.length > 0) {
    await notifyUpcomingDeadlines(
      upcomingBills.map((b: any) => ({ billNumber: b.billNumber, vendorName: b.vendorName, amount: decimalToNumber(b.balanceDue), dueDate: b.dueDate! })),
      upcomingInvoices.map((inv: any) => ({
        invoiceNumber: inv.invoiceNumber || "N/A",
        companyName: inv.company?.name || inv.recipientName || "Unknown",
        amount: decimalToNumber(inv.balanceDue),
        dueDate: inv.dueDate!,
      })),
      advanceDays,
      orgId,
    )
  }

  return NextResponse.json({
    data: {
      billsUpdated: overdueBills.count,
      invoicesUpdated: overdueInvoices.count,
      upcomingBills: upcomingBills.length,
      upcomingInvoices: upcomingInvoices.length,
    },
  })
  })
}

// GET — get upcoming deadlines (bills/invoices due within N days)
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
  const { searchParams } = new URL(req.url)
  const daysAhead = parseInt(searchParams.get("days") || "7")

  const now = new Date()
  const deadline = new Date(now.getTime() + daysAhead * 86400000)

  const [upcomingBills, upcomingInvoices] = await Promise.all([
    prisma.bill.findMany({
      where: { organizationId: orgId, dueDate: { gte: now, lte: deadline }, status: { notIn: ["paid", "cancelled"] }, balanceDue: { gt: 0 } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.invoice.findMany({
      where: { organizationId: orgId, dueDate: { gte: now, lte: deadline }, status: { notIn: ["paid", "cancelled", "refunded"] }, balanceDue: { gt: 0 } },
      select: { id: true, invoiceNumber: true, totalAmount: true, balanceDue: true, dueDate: true, status: true, recipientName: true, company: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
    }),
  ])

  return NextResponse.json({ data: {
    upcomingBills,
    upcomingInvoices: upcomingInvoices.map((inv: typeof upcomingInvoices[number]) => ({
      ...inv,
      totalAmount: decimalToNumber(inv.totalAmount),
      balanceDue: decimalToNumber(inv.balanceDue),
    })),
    daysAhead,
  } })
  })
}
