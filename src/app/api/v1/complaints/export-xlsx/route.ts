import { NextResponse } from "next/server"
import ExcelJS from "exceljs"
import { prisma } from "@/lib/prisma"
import { EXPORT_HEADERS, complaintToExportRow } from "@/lib/complaints-mapper"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId }) => {

  const tickets = await prisma.ticket.findMany({
    where: { organizationId: orgId, complaintMeta: { isNot: null } },
    include: { complaintMeta: true, comments: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  })

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("CRM hesabat")
  ws.addRow([...EXPORT_HEADERS])
  ws.getRow(1).font = { bold: true }

  for (const t of tickets) {
    const m = t.complaintMeta!
    const response = t.comments.find((c: { isInternal: boolean }) => !c.isInternal)?.comment || null
    const row = complaintToExportRow({
      externalRegistryNumber: m.externalRegistryNumber,
      customerName: null,
      requestDate: t.createdAt,
      source: t.source,
      complaintType: (m.complaintType as "complaint" | "suggestion") || "complaint",
      brand: m.brand,
      productionArea: m.productionArea,
      productCategory: m.productCategory,
      complaintObject: m.complaintObject,
      complaintObjectDetail: m.complaintObjectDetail,
      phone: null,
      content: t.description || "",
      responsibleDepartment: m.responsibleDepartment,
      response,
      status: ((t.status as "open" | "in_progress" | "resolved" | "escalated") || "open"),
      riskLevel: (m.riskLevel as "low" | "medium" | "high" | null) ?? null,
      priority: ((t.priority as "low" | "medium" | "high" | "urgent") || "medium"),
    })

    // Backfill customerName/phone from the contact if linked
    if (t.contactId) {
      const c = await prisma.contact.findFirst({
        where: { id: t.contactId },
        select: { fullName: true, phone: true },
      })
      row[1] = c?.fullName || null
      row[12] = c?.phone || null
    }

    ws.addRow(row)
  }

  ws.columns?.forEach((col) => {
    col.width = 22
  })

  const buffer = await wb.xlsx.writeBuffer()
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="CRM-hesabat-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  })
})
