import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { withRls } from "@/lib/with-rls"

export const POST = withRls(async (_req, { orgId }) => {

  try {
    // Fetch the invoices that will transition so we can emit per-invoice notifications.
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        status: { in: ["sent", "viewed", "partially_paid"] },
        dueDate: { lt: new Date() },
      },
      select: { id: true, invoiceNumber: true },
    })

    const result = await prisma.invoice.updateMany({
      where: {
        organizationId: orgId,
        status: { in: ["sent", "viewed", "partially_paid"] },
        dueDate: { lt: new Date() },
      },
      data: { status: "overdue" },
    })

    // Phase 2a — best-effort notification per overdue invoice (org-wide,
    // Finance-gated). Fires after persistence; never blocks the response.
    // Org-wide = in-app only (no per-recipient push target).
    for (const inv of overdueInvoices) {
      createNotification({
        organizationId: orgId,
        userId: "",
        type: "warning",
        title: "Invoice overdue",
        message: `Invoice ${inv.invoiceNumber} is overdue`,
        entityType: "invoice",
        entityId: inv.id,
        kind: "invoice.overdue",
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, data: { updated: result.count } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
